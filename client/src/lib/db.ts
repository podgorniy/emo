// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * IndexedDB storage layer for Emo client PWA.
 * Stores: entries, outbox, keys, meta, draft, prefs, reminders; the schema
 * and its migrations are in `idb/schema.ts`.
 * No plaintext reaches disk: entries and the draft are stored as ciphertext
 * (architecture.md §8.1); decryption happens in memory only.
 * Specification: architecture.md §8.1, data.md §8.3.
 */

import { broadcast } from "./channel.ts";
import { DB_NAME, DB_VERSION, upgradeDatabase } from "./idb/schema.ts";

/** An entry exactly as the server holds it: ciphertext only (architecture.md §8.1). */
export interface StoredEntry {
  id: string;
  seq: number;
  key_version: number;
  nonce_b64: string | null;
  ct_b64: string | null;
  deleted: boolean;
  received_at: string;
  /**
   * What decrypting it showed on this device (`entryCheck.ts`); never
   * uploaded. Absent = not checked yet.
   */
  check?: EntryCheck;
}

/** reliability.md §1.2, data.md §8.1: the local flags of an entry. */
export type EntryCheck = "ok" | "undecryptable" | "invalid" | "newer";

/** The encrypted check-in draft (ui.md §6.2, AAD `emo-draft/v1`). */
export interface StoredDraft {
  nonce_b64: string;
  ct_b64: string;
}

/** A row of the reminder journal, as `GET /api/reminders` returns it. */
export interface StoredReminder {
  id: string;
  local_date: string;
  /** Missing on rows pulled from a server before 2026-10-10 */
  tz?: string;
  scheduled_for: string;
  sent_at: string | null;
  status: string;
  /** Why a `cancelled` one was never sent; missing as `tz` */
  reason?: string | null;
  updated_at: string;
}

/** The encrypted prefs blob (architecture.md §8.1). `updated_at` is the
 * server's for the version held here; `dirty` means a local change is not
 * uploaded yet. */
export interface StoredPrefs {
  key_version: number;
  nonce_b64: string;
  ct_b64: string;
  updated_at: string | null;
  dirty: boolean;
}

export interface OutboxItem {
  id: string;
  /** `put` uploads the ciphertext; `delete` sends the Undo's `DELETE`
   * (absent on items queued before v3: a put). */
  op?: "put" | "delete";
  key_version: number;
  nonce_b64: string;
  ct_b64: string;
  attempt_count: number;
  created_at: string;
}

let dbInstance: IDBDatabase | null = null;
let onVersionChange: (() => void) | null = null;

/**
 * What to do when another tab needs a newer `DB_VERSION` (reliability.md §1.1):
 * this tab's connection is already closed; the app shows "Reloading…"
 * and reloads.
 */
export function setVersionChangeHandler(fn: () => void): void {
  onVersionChange = fn;
}

/** `open` failed twice for a reason other than the version: see App. */
export class StorageDamagedError extends Error {
  override name = "StorageDamaged";
}

function openOnce(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      upgradeDatabase(request.result, request.transaction!, event.oldVersion);
    };
    // An older tab keeps the old version open: ask it to let go
    request.onblocked = () => broadcast({ type: "db-upgrade" });
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (dbInstance === db) dbInstance = null;
        onVersionChange?.();
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * The connection, opened once. A failed open is retried once; a version
 * error (this build is older than the stored DB) is passed on as it is,
 * anything else becomes `StorageDamagedError`.
 */
export async function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;
  try {
    dbInstance = await openOnce();
  } catch (first) {
    if ((first as Error)?.name === "VersionError") throw first;
    try {
      dbInstance = await openOnce();
    } catch (err) {
      if ((err as Error)?.name === "VersionError") throw err;
      throw new StorageDamagedError(String(err));
    }
  }
  return dbInstance;
}

/**
 * One store, one request. Resolves when the transaction has committed (a
 * write is on disk then, not merely accepted) and rejects on an error or an
 * abort, such as a full quota, so no caller waits forever.
 */
export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result: T | undefined;
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    try {
      const req = fn(tx.objectStore(storeName));
      if (req) req.onsuccess = () => (result = req.result);
    } catch (err) {
      tx.abort();
      reject(err);
    }
  });
}

// -------------------------------------------------------------
// Meta Store Helpers
// -------------------------------------------------------------

export async function getMeta<T = unknown>(key: string): Promise<T | null> {
  const row = await withStore<{ key: string; value: T } | undefined>(
    "meta",
    "readonly",
    (store) => store.get(key),
  );
  return row ? row.value : null;
}

/**
 * Whether this device holds any check-in row at all (saved, skipped or
 * deleted): before the first one the check-in shows its orientation hint
 * (ui.md §6.7).
 */
export async function hasAnyEntry(): Promise<boolean> {
  return (await withStore<number>("entries", "readonly", (s) => s.count())) > 0;
}

export async function setMeta<T = unknown>(
  key: string,
  value: T,
): Promise<void> {
  await withStore("meta", "readwrite", (store) => store.put({ key, value }));
}

export async function removeMeta(key: string): Promise<void> {
  await withStore("meta", "readwrite", (store) => store.delete(key));
}

// -------------------------------------------------------------
// Keys Store Helpers
// -------------------------------------------------------------

export async function getStoredKey<T = CryptoKey | Uint8Array>(
  id: string,
): Promise<T | null> {
  const row = await withStore<{ id: string; key: T } | undefined>(
    "keys",
    "readonly",
    (store) => store.get(id),
  );
  return row ? row.key : null;
}

export async function setStoredKey<T = CryptoKey | Uint8Array>(
  id: string,
  key: T,
): Promise<void> {
  await withStore("keys", "readwrite", (store) => store.put({ id, key }));
}

export async function clearKeys(): Promise<void> {
  await withStore("keys", "readwrite", (store) => store.clear());
}

// -------------------------------------------------------------
// Entries Store Helpers
// -------------------------------------------------------------

export async function getEntry(id: string): Promise<StoredEntry | null> {
  const row = await withStore<StoredEntry | undefined>(
    "entries",
    "readonly",
    (store) => store.get(id),
  );
  return row ?? null;
}

export async function putEntry(entry: StoredEntry): Promise<void> {
  await withStore("entries", "readwrite", (store) => store.put(entry));
}

/**
 * Records check results; a row whose ciphertext changed meanwhile (a pull or
 * an Undo) keeps no stale flag.
 */
export async function setEntryChecks(
  checks: Array<{ id: string; ct_b64: string; check: EntryCheck }>,
): Promise<void> {
  await inTransaction(["entries"], (tx) => {
    const entries = tx.objectStore("entries");
    for (const { id, ct_b64, check } of checks) {
      entries.get(id).onsuccess = (e) => {
        const row = (e.target as IDBRequest<StoredEntry | undefined>).result;
        if (row && row.ct_b64 === ct_b64) entries.put({ ...row, check });
      };
    }
  });
}

export async function getAllEntries(): Promise<StoredEntry[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("entries", "readonly");
    const req = tx.objectStore("entries").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * What changed since `seq` (`ui.md` §15.13), through `idx_seq`: rows
 * pulled or uploaded after it, every row not uploaded yet (seq 0), and the
 * ids still on this device (eviction drops rows without a tombstone).
 */
export async function getEntriesChangedSince(
  seq: number,
): Promise<{ rows: StoredEntry[]; ids: Set<string> }> {
  const db = await openDatabase();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction("entries", "readonly");
    const store = tx.objectStore("entries");
    const bySeq = store.index("idx_seq");
    const rows: StoredEntry[] = [];
    let ids = new Set<string>();
    bySeq.getAll(IDBKeyRange.only(0)).onsuccess = (e) =>
      rows.push(...(e.target as IDBRequest<StoredEntry[]>).result);
    bySeq.getAll(IDBKeyRange.lowerBound(Math.max(seq, 0), true)).onsuccess = (
      e,
    ) => rows.push(...(e.target as IDBRequest<StoredEntry[]>).result);
    store.getAllKeys().onsuccess = (e) =>
      ids = new Set((e.target as IDBRequest<IDBValidKey[]>).result as string[]);
    tx.oncomplete = () => resolve({ rows, ids });
    tx.onerror = () => reject(tx.error);
  });
}

// -------------------------------------------------------------
// Outbox Store Helpers
// -------------------------------------------------------------

export async function getOutboxItems(): Promise<OutboxItem[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("outbox", "readonly");
    const store = tx.objectStore("outbox");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putOutboxItem(item: OutboxItem): Promise<void> {
  await withStore("outbox", "readwrite", (store) => store.put(item));
}

export async function removeOutboxItem(id: string): Promise<void> {
  await withStore("outbox", "readwrite", (store) => store.delete(id));
}

/**
 * Whether two outbox items are the same queued op: an Undo or a History
 * delete replaces an upload under the same id while a pass is sending it
 * (`writeTombstone`), and the pass must then leave the new op alone.
 */
function sameOp(a: OutboxItem, b: OutboxItem): boolean {
  return (a.op ?? "put") === (b.op ?? "put") &&
    a.nonce_b64 === b.nonce_b64 && a.ct_b64 === b.ct_b64;
}

/**
 * Replaces `item` with `next` (or removes it, `next` null) only while it is
 * still the op queued under its id; resolves whether it was.
 */
export async function settleOutboxItem(
  item: OutboxItem,
  next: OutboxItem | null,
): Promise<boolean> {
  let same = false;
  await inTransaction(["outbox"], (tx) => {
    const outbox = tx.objectStore("outbox");
    outbox.get(item.id).onsuccess = (e) => {
      const queued = (e.target as IDBRequest<OutboxItem | undefined>).result;
      same = !!queued && sameOp(queued, item);
      if (!same) return;
      if (next) outbox.put(next);
      else outbox.delete(item.id);
    };
  });
  return same;
}

/**
 * An upload went through (architecture.md §8.3): its outbox item goes
 * and the row keeps the server's `seq`, in one transaction, unless an Undo
 * got there first: its `delete` op stays queued and its tombstone stays a
 * tombstone (the next pass sends the `DELETE`).
 */
export async function markUploaded(
  item: OutboxItem,
  seq: number,
  receivedAt: string,
): Promise<void> {
  await inTransaction(["entries", "outbox"], (tx) => {
    const entries = tx.objectStore("entries");
    const outbox = tx.objectStore("outbox");
    outbox.get(item.id).onsuccess = (e) => {
      const queued = (e.target as IDBRequest<OutboxItem | undefined>).result;
      if (queued && sameOp(queued, item)) outbox.delete(item.id);
    };
    entries.get(item.id).onsuccess = (e) => {
      const row = (e.target as IDBRequest<StoredEntry | undefined>).result;
      if (row && !row.deleted) {
        entries.put({ ...row, seq, received_at: receivedAt });
      }
    };
  });
}

/**
 * Undo and History's delete (architecture.md §8.4, ui.md §15.10): the
 * row becomes a tombstone and a `delete` op replaces any pending upload, in
 * one transaction, so a storage error leaves neither (the entry stays
 * saved), never one without the other. Not under the `emo-sync` lock: a
 * pass in flight never holds it, and never undoes it (`markUploaded`,
 * `settleOutboxItem`).
 */
export async function writeTombstone(
  id: string,
  at = new Date().toISOString(),
): Promise<void> {
  await inTransaction(["entries", "outbox"], (tx) => {
    const entries = tx.objectStore("entries");
    entries.get(id).onsuccess = (e) => {
      const local = (e.target as IDBRequest<StoredEntry | undefined>).result;
      const keyVersion = local?.key_version ?? 1;
      try {
        entries.put(
          {
            id,
            seq: local?.seq ?? 0,
            key_version: keyVersion,
            nonce_b64: null,
            ct_b64: null,
            deleted: true,
            received_at: local?.received_at ?? at,
          } satisfies StoredEntry,
        );
        tx.objectStore("outbox").put(
          {
            id,
            op: "delete",
            key_version: keyVersion,
            nonce_b64: "",
            ct_b64: "",
            attempt_count: 0,
            created_at: at,
          } satisfies OutboxItem,
        );
      } catch {
        tx.abort(); // neither write stays
      }
    };
  });
}

// -------------------------------------------------------------
// Draft Store Helpers
// -------------------------------------------------------------

export async function getStoredDraft(): Promise<StoredDraft | null> {
  const row = await withStore<({ key: string } & StoredDraft) | undefined>(
    "draft",
    "readonly",
    (store) => store.get("current"),
  );
  return row ? { nonce_b64: row.nonce_b64, ct_b64: row.ct_b64 } : null;
}

export async function putStoredDraft(draft: StoredDraft): Promise<void> {
  await withStore(
    "draft",
    "readwrite",
    (store) => store.put({ key: "current", ...draft }),
  );
}

/**
 * Saving a check-in (architecture.md §7.1): the entry, its outbox item and the
 * draft's removal in one transaction, so a crash leaves either the draft or
 * the saved entry, never both or neither.
 */
export async function commitEntry(
  entry: StoredEntry,
  item: OutboxItem,
): Promise<void> {
  await inTransaction(["entries", "outbox", "draft"], (tx) => {
    tx.objectStore("entries").put(entry);
    tx.objectStore("outbox").put(item);
    tx.objectStore("draft").delete("current");
  });
}

/**
 * A full disk (reliability.md §1.1): drops the oldest ciphertext the server
 * already has (seq > 0, nothing queued for it), keeping the newest `keep`
 * rows and every tombstone, so a new check-in fits. `meta.evicted` then
 * tells History that older check-ins are only on the server
 * (`ui.md` §15.12). Returns how many went.
 */
export async function evictSyncedEntries(keep = 500): Promise<number> {
  const queued = new Set((await getOutboxItems()).map((o) => o.id));
  const synced = (await getAllEntries())
    .filter((e) => e.seq > 0 && !e.deleted && !queued.has(e.id))
    .sort((a, b) => a.seq - b.seq);
  const drop = synced.slice(0, Math.max(0, synced.length - keep));
  if (drop.length === 0) return 0;
  await inTransaction(["entries", "meta"], (tx) => {
    const entries = tx.objectStore("entries");
    for (const e of drop) entries.delete(e.id);
    tx.objectStore("meta").put({ key: "evicted", value: true });
  });
  return drop.length;
}

export async function deleteStoredDraft(): Promise<void> {
  await withStore("draft", "readwrite", (store) => store.delete("current"));
}

// -------------------------------------------------------------
// Complete Local Wipe (Sign out on this device)
// -------------------------------------------------------------

export async function wipeLocalDatabase(): Promise<void> {
  const db = await openDatabase();
  const storeNames = [
    "entries",
    "outbox",
    "keys",
    "meta",
    "draft",
    "prefs",
    "reminders",
  ];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeNames, "readwrite");
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// -------------------------------------------------------------
// Sync helpers (architecture.md §8.3, api.md §3)
// -------------------------------------------------------------

/** Runs `fn` over the given stores in one transaction; resolves on commit. */
async function inTransaction(
  storeNames: string[],
  fn: (tx: IDBTransaction) => void,
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeNames, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    try {
      fn(tx);
    } catch (err) {
      // A request that throws (a bad key, an uncloneable value) must take the
      // whole transaction with it, not leave the earlier writes to commit
      tx.abort();
      reject(err);
    }
  });
}

export interface PulledItem {
  id: string;
  seq: number;
  key_version: number;
  nonce_b64: string | null;
  ct_b64: string | null;
  deleted: boolean;
  received_at: string;
}

/**
 * One pulled page and its cursor in one transaction (api.md §3):
 * a tombstone always wins (also over a local live copy); a live item never
 * overwrites a local tombstone; an outbox item is dropped only when the
 * server holds the same bytes, or the entry is gone.
 */
export async function applyPullPage(
  items: PulledItem[],
  nextSeq: number,
): Promise<void> {
  await inTransaction(["entries", "outbox", "meta"], (tx) => {
    const entries = tx.objectStore("entries");
    const outbox = tx.objectStore("outbox");
    for (const item of items) {
      entries.get(item.id).onsuccess = (e) => {
        const local = (e.target as IDBRequest<StoredEntry | undefined>).result;
        if (item.deleted) {
          entries.put(
            {
              id: item.id,
              seq: item.seq,
              key_version: item.key_version,
              nonce_b64: null,
              ct_b64: null,
              deleted: true,
              received_at: item.received_at,
            } satisfies StoredEntry,
          );
          outbox.delete(item.id);
          return;
        }
        if (local?.deleted) return;
        entries.put({ ...item, deleted: false } satisfies StoredEntry);
        outbox.get(item.id).onsuccess = (o) => {
          const queued =
            (o.target as IDBRequest<OutboxItem | undefined>).result;
          if (
            queued && queued.nonce_b64 === item.nonce_b64 &&
            queued.ct_b64 === item.ct_b64
          ) {
            outbox.delete(item.id);
          }
        };
      };
    }
    tx.objectStore("meta").put({ key: "cursor_seq", value: nextSeq });
  });
}

/**
 * After a server restore (api.md §3 "Epoch change"): every local
 * live entry goes back into the outbox, every local tombstone as a `delete`
 * (the backup may predate it: the entry would be live there again), and the
 * cursor returns to 0, in one transaction.
 */
export async function requeueAllEntries(): Promise<void> {
  await inTransaction(["entries", "outbox", "meta"], (tx) => {
    const outbox = tx.objectStore("outbox");
    tx.objectStore("entries").openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      const entry = cursor.value as StoredEntry;
      if (entry.deleted) {
        outbox.put(
          {
            id: entry.id,
            op: "delete",
            key_version: entry.key_version,
            nonce_b64: "",
            ct_b64: "",
            attempt_count: 0,
            created_at: entry.received_at,
          } satisfies OutboxItem,
        );
      } else if (entry.nonce_b64 && entry.ct_b64) {
        outbox.put(
          {
            id: entry.id,
            key_version: entry.key_version,
            nonce_b64: entry.nonce_b64,
            ct_b64: entry.ct_b64,
            attempt_count: 0,
            created_at: entry.received_at,
          } satisfies OutboxItem,
        );
      }
      cursor.continue();
    };
    tx.objectStore("meta").put({ key: "cursor_seq", value: 0 });
  });
}

export async function putReminders(rows: StoredReminder[]): Promise<void> {
  if (rows.length === 0) return;
  await inTransaction(["reminders"], (tx) => {
    const store = tx.objectStore("reminders");
    for (const row of rows) store.put(row);
  });
}

export async function getAllReminders(): Promise<StoredReminder[]> {
  const db = await openDatabase();
  return await new Promise((resolve, reject) => {
    const req = db.transaction("reminders", "readonly").objectStore("reminders")
      .getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getStoredPrefs(): Promise<StoredPrefs | null> {
  const row = await withStore<({ key: string } & StoredPrefs) | undefined>(
    "prefs",
    "readonly",
    (store) => store.get("current"),
  );
  if (!row) return null;
  const { key: _key, ...prefs } = row;
  return prefs;
}

export async function putStoredPrefs(prefs: StoredPrefs): Promise<void> {
  await withStore(
    "prefs",
    "readwrite",
    (store) => store.put({ key: "current", ...prefs }),
  );
}

const LEASE_MS = 30_000;

/**
 * The `emo-sync` lock where Web Locks are missing (reliability.md §1.3): a
 * `meta.lock` row with a 30 s lease and the tab id, taken in one IndexedDB
 * transaction, so two tabs cannot both take it.
 */
export async function tryTakeLease(tabId: string): Promise<boolean> {
  let taken = false;
  await inTransaction(["meta"], (tx) => {
    const meta = tx.objectStore("meta");
    meta.get("lock").onsuccess = (e) => {
      const row = (e.target as IDBRequest<
        { key: string; value: { tab: string; expires: number } } | undefined
      >).result;
      const now = Date.now();
      if (!row || row.value.expires < now || row.value.tab === tabId) {
        meta.put({
          key: "lock",
          value: { tab: tabId, expires: now + LEASE_MS },
        });
        taken = true;
      }
    };
  });
  return taken;
}

export async function releaseLease(tabId: string): Promise<void> {
  await inTransaction(["meta"], (tx) => {
    const meta = tx.objectStore("meta");
    meta.get("lock").onsuccess = (e) => {
      const row = (e.target as IDBRequest<
        { key: string; value: { tab: string } } | undefined
      >).result;
      if (row?.value.tab === tabId) meta.delete("lock");
    };
  });
}

/** Closes this tab's connection (another tab is deleting the database). */
export function closeDatabase(): void {
  dbInstance?.close();
  dbInstance = null;
}

/**
 * Sign out (reliability.md §1.4): the whole database goes, not just its
 * rows. Other tabs were asked to close their connections; if one still
 * blocks the delete for 3 s, the stores are cleared instead.
 */
export async function deleteLocalDatabase(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  closeDatabase();
  const deleted = await new Promise<boolean>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    const timer = setTimeout(() => resolve(false), 3000);
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(true);
    };
    req.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });
  if (!deleted) await wipeLocalDatabase();
}
