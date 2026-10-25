// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Client synchronization: the `sync()` pass of architecture.md §8.3 under the
 * `emo-sync` lock — 0a epoch / restore, 1 outbox push, 2 entry pull,
 * 3 reminder journal, 4 prefs, 5 settings — plus its triggers, and deleting
 * an entry (Undo, History).
 * Specification: architecture.md §8.3–§8.4, api.md §2.6–§2.8, §3,
 * reliability.md §1.3, ui.md §15.10.
 */

import {
  apiDeleteEntry,
  ApiErrorResponse,
  apiGetReminders,
  apiGetSettings,
  apiPullEntries,
  apiPutEntry,
  apiPutSettings,
  getCompat,
  getObservedEpoch,
  lastClockSkewSec,
  setKnownEpoch,
} from "./api.ts";
import {
  applyPullPage,
  commitEntry,
  evictSyncedEntries,
  getAllEntries,
  getEntry,
  getMeta,
  getOutboxItems,
  markUploaded,
  type OutboxItem,
  putEntry,
  putOutboxItem,
  putReminders,
  releaseLease,
  removeMeta,
  removeOutboxItem,
  requeueAllEntries,
  setMeta,
  settleOutboxItem,
  type StoredEntry,
  tryTakeLease,
  writeTombstone,
} from "./db.ts";
import {
  decryptEntryLocally,
  encryptEntryLocally,
  getCachedAuthKey,
  isLocked,
} from "./crypto.ts";
import { checkEntries } from "./entryCheck.ts";
import { broadcast } from "./channel.ts";
import { getLocale } from "./i18n.ts";
import { syncPrefs } from "./prefs.ts";
import { errorCode, recordDiag } from "./diag.ts";
import type { EntryV2 } from "../../../shared/entry.ts";
import type { SettingsGetRes } from "../../../shared/protocol.ts";

/**
 * A full disk (reliability.md §1.1): entries that could not be written stay
 * here, in memory, until a write works again or the server has them. They
 * are never dropped; the sync dot shows them as waiting and Settings → Data
 * says the storage is full.
 */
const unsaved: Array<{ stored: StoredEntry; item: OutboxItem }> = [];

export function unsavedCount(): number {
  return unsaved.length;
}

/** First make room by evicting synced ciphertext; else hold it in memory. */
async function keepDespiteFullDisk(stored: StoredEntry, item: OutboxItem) {
  await recordDiag("QuotaExceededError", "save");
  if (await evictSyncedEntries().catch(() => 0)) {
    try {
      await commitEntry(stored, item);
      return;
    } catch {
      // Still full
    }
  }
  unsaved.push({ stored, item });
}

/** Each pass: write what was held, or at least get it to the server. */
async function flushUnsaved(): Promise<void> {
  for (const held of [...unsaved]) {
    if (!unsaved.includes(held)) continue; // undone meanwhile
    try {
      await commitEntry(held.stored, held.item);
    } catch {
      const { key_version, nonce_b64, ct_b64 } = held.item;
      await apiPutEntry(held.item.id, { key_version, nonce_b64, ct_b64 });
    }
    const at = unsaved.indexOf(held);
    if (at >= 0) unsaved.splice(at, 1);
  }
}

/**
 * What the Home sync dot shows (ui.md §3): everything on the
 * server, something waiting, or something waiting for more than a day
 * (architecture.md §8.5). "Signed out" is the app's own state.
 */
export type SyncStatus = "synced" | "pending" | "stale";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const statusListeners = new Set<(status: SyncStatus) => void>();

export function onSyncStatus(fn: (status: SyncStatus) => void): () => void {
  statusListeners.add(fn);
  void currentSyncStatus().then(fn).catch(() => {});
  return () => statusListeners.delete(fn);
}

export async function currentSyncStatus(now = Date.now()): Promise<SyncStatus> {
  const items = [...await getOutboxItems(), ...unsaved.map((u) => u.item)];
  if (items.length === 0) return "synced";
  const oldest = Math.min(...items.map((i) => Date.parse(i.created_at)));
  return now - oldest > STALE_AFTER_MS ? "stale" : "pending";
}

/**
 * Whether a sync pass is running in this tab: the pane bar's dot shows
 * "Sending" meanwhile (ui.md §3). Called now and on changes.
 */
const runningListeners = new Set<(running: boolean) => void>();
export function onSyncRunning(fn: (running: boolean) => void): () => void {
  runningListeners.add(fn);
  fn(running !== null);
  return () => runningListeners.delete(fn);
}
function tellRunning(value: boolean) {
  for (const fn of runningListeners) fn(value);
}

/** When the last sync pass ended well (`meta.last_sync_ok_at`), or null. */
export async function lastSyncOk(): Promise<Date | null> {
  const at = await getMeta<string>("last_sync_ok_at").catch(() => null);
  return at ? new Date(at) : null;
}

async function announceStatus(): Promise<void> {
  if (statusListeners.size === 0) return;
  const status = await currentSyncStatus();
  for (const fn of statusListeners) fn(status);
}

let running: Promise<void> | null = null;
let passRequested = false;
const TAB_ID = crypto.randomUUID();

/**
 * Runs `fn` under the `emo-sync` lock, so it never interleaves with a pass:
 * Web Locks, or a 30 s lease in IndexedDB where they are missing. Either way
 * a second tab waits for the holder (reliability.md §1.3).
 */
async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return await navigator.locks.request("emo-sync", fn);
  }
  while (!(await tryTakeLease(TAB_ID))) {
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    return await fn();
  } finally {
    await releaseLease(TAB_ID);
  }
}

/**
 * Resolves once no sync pass is writing (this tab's or another's), or after
 * `timeoutMs` — before a restart into a new version (reliability.md §3).
 */
export async function whenSyncIdle(timeoutMs = 4000): Promise<void> {
  await Promise.race([
    withSyncLock(() => Promise.resolve()).catch(() => {}),
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryBackoffMs = 1000;
const MAX_BACKOFF_MS = 30000;

export function clearSyncRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryBackoffMs = 1000;
}

function scheduleSyncRetry(accountId: string) {
  if (retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryBackoffMs = Math.min(retryBackoffMs * 2, MAX_BACKOFF_MS);
    runSync(accountId).catch((err) =>
      console.warn("Retried background sync failed:", err)
    );
  }, retryBackoffMs);
  // Under `deno test` a pending retry never keeps the process alive
  const deno = (globalThis as {
    Deno?: { unrefTimer?(timer: unknown): void };
  }).Deno;
  if (typeof deno?.unrefTimer === "function") deno.unrefTimer(retryTimer);
}

/**
 * Runs one sync pass under the `emo-sync` lock. Another tab's pass is waited
 * for, then this one runs: it pushes what this tab saved meanwhile, and its
 * pull starts at the cursor, so it costs little. A call while this tab's pass
 * is running does not start a second one: it asks for one more pass (so work
 * queued meanwhile is not left behind) and resolves when that one has
 * finished too.
 */
export function runSync(accountId: string): Promise<void> {
  // Outside the compatibility window nothing is sent (reliability.md §3)
  if (getCompat() !== "ok") return running ?? Promise.resolve();
  passRequested = true;
  clearSyncRetry();
  if (running) return running;

  running = (async () => {
    try {
      while (passRequested) {
        passRequested = false;
        await withSyncLock(() => pass(accountId));
        clearSyncRetry();
      }
    } catch (err) {
      passRequested = true;
      // Signed out: a retry would only get 401 again. The next sign-in
      // syncs; nothing queued is lost meanwhile
      const signedOut = err instanceof ApiErrorResponse && err.status === 401;
      if (!signedOut) scheduleSyncRetry(accountId);
      throw err;
    } finally {
      running = null;
      tellRunning(false);
      void announceStatus().catch(() => {});
    }
  })();
  tellRunning(true);
  return running;
}

/**
 * One pass. A server restore — a new `X-Emo-Epoch`, or `max_seq` below our
 * cursor — puts every local entry back into the outbox and pulls from 0; the
 * new epoch is stored only once that round completed (api.md §3).
 */
async function pass(accountId: string): Promise<void> {
  const known = await getMeta<string>("server_epoch");
  setKnownEpoch(known);
  let restoring = false;

  for (let round = 0; round < 3; round++) {
    if (
      !restoring && known && getObservedEpoch() && getObservedEpoch() !== known
    ) {
      restoring = true;
    }
    if (restoring) await requeueAllEntries();

    await flushUnsaved();
    await pushOutbox(accountId);
    const pulled = await pullStream();
    const seen = getObservedEpoch();
    if (
      !restoring && (pulled === "restore" || (known && seen && seen !== known))
    ) {
      restoring = true;
      continue;
    }

    // reliability.md §1.2, data.md §8.1: pulled entries are decrypted and checked;
    // a failure here never stops the sync
    await checkEntries(accountId).catch((err) =>
      console.warn("Entry check failed:", err)
    );
    await pullReminders();
    await syncPrefs(accountId);
    await syncSettings();
    await noteClockSkew();

    if (seen && seen !== known) {
      await setMeta("server_epoch", seen);
      setKnownEpoch(seen);
    }
    // The tooltip's "Synced · {time}" (ui.md §3)
    await setMeta("last_sync_ok_at", new Date().toISOString());
    return;
  }
}

/** The request failed for a reason a later pass may not have (offline, 5xx, 429). */
function isTransient(err: unknown): boolean {
  return !(err instanceof ApiErrorResponse) || err.status >= 500 ||
    err.status === 429 || err.status === 401;
}

/**
 * Step 1: uploads the outbox, one at a time, in order. An Undo or a History
 * delete runs alongside (it never waits for this lock): it may replace an
 * item with its `delete` op while that item is being sent, so every write
 * back to the outbox here applies only while the item is still the one
 * queued (`settleOutboxItem`, `markUploaded`), and the `delete` goes on the
 * next pass, which the Undo asked for.
 */
async function pushOutbox(accountId: string): Promise<void> {
  const items = (await getOutboxItems())
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const item of items) {
    if (item.op === "delete") {
      await pushDelete(item);
      continue;
    }
    const localEntry = await getEntry(item.id);
    if (!localEntry || localEntry.deleted) {
      // Deleted locally before upload (a delete queued since stays)
      await settleOutboxItem(item, null);
      continue;
    }

    try {
      const res = await apiPutEntry(item.id, {
        key_version: item.key_version,
        nonce_b64: item.nonce_b64,
        ct_b64: item.ct_b64,
      });
      // The seq is kept on the row; the cursor only moves by pulling (ui.md §2)
      await markUploaded(item, res.seq, res.received_at);
    } catch (err) {
      const retry = { ...item, attempt_count: item.attempt_count + 1 };
      if (err instanceof ApiErrorResponse && err.code === "entry_deleted") {
        // Deleted on another device: drop it, keep a tombstone, never re-key
        await removeOutboxItem(item.id);
        await putEntry({
          ...localEntry,
          deleted: true,
          nonce_b64: null,
          ct_b64: null,
        });
      } else if (
        err instanceof ApiErrorResponse && err.code === "entry_blob_mismatch"
      ) {
        await rekeyCollision(item, localEntry, accountId);
      } else if (isTransient(err)) {
        // Offline, server trouble or signed out: the rest waits for the next pass
        await settleOutboxItem(item, retry);
        throw err;
      } else {
        await settleOutboxItem(item, retry);
      }
    }
  }
}

/** A queued Undo: `DELETE /api/entries/:id` with the proof (idempotent). */
async function pushDelete(item: OutboxItem): Promise<void> {
  const proof = getCachedAuthKey();
  if (!proof) return; // locked: it waits for the next unlocked pass
  try {
    await apiDeleteEntry(item.id, proof);
    await settleOutboxItem(item, null);
  } catch (err) {
    await settleOutboxItem(item, {
      ...item,
      attempt_count: item.attempt_count + 1,
    });
    if (isTransient(err)) throw err;
  }
}

/**
 * `409 entry_blob_mismatch`: the id is taken by different bytes (a UUID v4
 * collision, practically impossible). The entry is re-encrypted under a new
 * id — the AAD binds the id — and queued again (architecture.md §8.3).
 * Not when an Undo deleted it meanwhile: that would bring it back.
 */
async function rekeyCollision(
  item: OutboxItem,
  local: StoredEntry,
  accountId: string,
): Promise<void> {
  if (isLocked() || !local.nonce_b64 || !local.ct_b64) return;
  if ((await getEntry(item.id))?.deleted) return;
  const entry = await decryptEntryLocally(
    local.nonce_b64,
    local.ct_b64,
    accountId,
    local.id,
    local.key_version,
  );
  const renamed: EntryV2 = { ...entry, id: crypto.randomUUID() };
  const enc = await encryptEntryLocally(renamed, accountId, item.key_version);
  await putEntry({ ...local, id: renamed.id, seq: 0, ...enc });
  await putOutboxItem({ ...item, id: renamed.id, ...enc, attempt_count: 0 });
  await removeOutboxItem(item.id);
  await setMeta("renamed", ((await getMeta<number>("renamed")) ?? 0) + 1);
  await recordDiag("sync.conflict", "sync");
  await putEntry({ ...local, deleted: true, nonce_b64: null, ct_b64: null });
}

/** A pull from seq 0 is running: a new device, or after a restore. */
let fullPull = false;

/** History's end line says "Syncing…" meanwhile (ui.md §15.14). */
export function isFullPullRunning(): boolean {
  return fullPull;
}

/** Step 2: pulls the entry stream page by page; "restore" when the server is behind. */
async function pullStream(): Promise<"ok" | "restore"> {
  let cursorSeq = (await getMeta<number>("cursor_seq")) || 0;
  fullPull = cursorSeq === 0;
  try {
    while (true) {
      const res = await apiPullEntries(cursorSeq, 500);
      if (res.max_seq < cursorSeq) return "restore";
      await applyPullPage(res.items, res.next_seq);
      cursorSeq = res.next_seq;
      if (!res.has_more) return "ok";
    }
  } finally {
    fullPull = false;
  }
}

/**
 * The fields the journal's rows carry: 2 since `tz` and `reason`
 * (2026-10-10). Rows pulled before have neither, so the journal is pulled
 * once more from the start, which `putReminders` writes over them.
 */
const REMINDER_FIELDS = 2;

/** Step 3: the reminder journal (past rows only), by `updated_at`. */
async function pullReminders(): Promise<void> {
  const current =
    ((await getMeta<number>("reminders_fields")) ?? 1) >= REMINDER_FIELDS;
  let since = (current ? await getMeta<string>("reminders_since") : null) ??
    "1970-01-01T00:00:00.000Z";
  while (true) {
    const res = await apiGetReminders(since);
    await putReminders(res.items);
    since = res.next_since;
    await setMeta("reminders_since", since);
    if (!res.has_more) break;
  }
  if (!current) await setMeta("reminders_fields", REMINDER_FIELDS);
}

/** The settings this device last saw (also written by Settings → Reminders). */
export async function rememberSettings(
  settings: SettingsGetRes,
): Promise<void> {
  await setMeta("settings", settings);
}

/**
 * Step 5: when this device's tz or interface language differs from what the
 * server has, send them — over a fresh copy, so another device's reminder
 * window is never overwritten with an old one. The tz only when it changed
 * since this device last sent it (meta `tz_sent`): two devices in different
 * zones then never move the account back and forth, and each move cancels
 * the reminders that no longer fit (`cancelForNewTz` on the server).
 */
async function syncSettings(): Promise<void> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = getLocale();
  const report = !!tz && tz !== (await getMeta<string>("tz_sent"));
  const differs = (s: SettingsGetRes) =>
    (report && s.tz !== tz) || s.locale !== locale;
  const cached = await getMeta<SettingsGetRes>("settings");
  if (!cached || differs(cached)) {
    const fresh = await apiGetSettings();
    await rememberSettings(fresh);
    if (differs(fresh)) {
      const {
        receiving_reminders: _r,
        reminders_paused_until: _p,
        ...rest
      } = fresh;
      await rememberSettings(
        await apiPutSettings({ ...rest, tz: report ? tz : fresh.tz, locale }),
      );
    }
  }
  if (report) await setMeta("tz_sent", tz);
}

/** reliability.md §1.1: over 5 minutes apart, the device clock is off. */
const CLOCK_SKEW_LIMIT_SEC = 300;
let clockSkewRecorded = false;

/**
 * Keeps `meta.clock_skew_sec` (Settings → Data, diagnostics) while the
 * device clock is off, recorded once per session; entries keep their device
 * `ts` either way (export carries `received_at` for analysis).
 */
async function noteClockSkew(): Promise<void> {
  const skew = lastClockSkewSec();
  if (skew === null) return;
  if (Math.abs(skew) > CLOCK_SKEW_LIMIT_SEC) {
    await setMeta("clock_skew_sec", skew);
    if (!clockSkewRecorded) {
      clockSkewRecorded = true;
      await recordDiag("clock.skew", "sync");
    }
  } else {
    await removeMeta("clock_skew_sec");
  }
}

const SYNC_EVERY_MS = 5 * 60 * 1000;

/**
 * architecture.md §8.3 triggers besides saving and opening: `online`,
 * `visibilitychange → visible`, and every 5 minutes while the app is
 * visible. Returns the function that stops them (lock, sign out).
 */
export function startSyncTriggers(accountId: string): () => void {
  const sync = () => {
    runSync(accountId).catch((err) => void recordDiag(errorCode(err), "sync"));
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") sync();
  };
  globalThis.addEventListener("online", sync);
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") sync();
  }, SYNC_EVERY_MS);
  return () => {
    globalThis.removeEventListener("online", sync);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
    clearSyncRetry();
  };
}

/** For tests and diagnostics: every local entry row. */
export async function localEntries(): Promise<StoredEntry[]> {
  return await getAllEntries();
}

/**
 * Deleting an entry (Undo: ui.md §6.5; History:
 * ui.md §15.10; api.md §2.6): the entry becomes a local
 * tombstone and a `delete` op replaces any pending upload in the outbox, in
 * one transaction (`writeTombstone`), so the `DELETE` survives being
 * offline, a failed request or a closed app. It does not wait for the
 * `emo-sync` lock: a pass may hold it for as long as a request hangs, and
 * the pass leaves an op queued meanwhile alone (`pushOutbox`). Other tabs
 * hear `entries`; a sync pass then sends it in the background: `sent` is
 * that pass, and never rejects. `before` sees the row before it goes (Undo
 * decrypts it there). No draft is written here.
 */
export async function tombstoneEntry(
  entryId: string,
  accountId: string,
  before?: (local: StoredEntry | null) => Promise<void>,
): Promise<{ sent: Promise<void> }> {
  await before?.(await getEntry(entryId));
  await writeTombstone(entryId);
  // One held in memory by a full disk is never written after this
  const held = unsaved.findIndex((u) => u.stored.id === entryId);
  if (held >= 0) unsaved.splice(held, 1);
  broadcast({ type: "entries" });
  // Send it now if possible; otherwise a later pass will
  const sent = runSync(accountId).catch((err) =>
    console.warn("Delete queued; sync failed:", err)
  );
  return { sent };
}

/**
 * Undo: `tombstoneEntry`, after decrypting the entry so the form can be
 * refilled. Returns the decrypted entry (null if unreadable)
 * once the tombstone and its `delete` op are written, without waiting for
 * the sync pass: a slow or stalled request never holds the Saved screen,
 * and the outbox sends the `DELETE` later anyway. A storage error rejects.
 */
export async function emergencyUndo(
  entryId: string,
  accountId: string,
): Promise<EntryV2 | null> {
  let decrypted: EntryV2 | null = null;
  await tombstoneEntry(entryId, accountId, async (local) => {
    if (!local?.nonce_b64 || !local.ct_b64) return;
    try {
      decrypted = await decryptEntryLocally(
        local.nonce_b64,
        local.ct_b64,
        accountId,
        local.id,
        local.key_version,
      );
    } catch (err) {
      console.warn(
        "Undo: could not decrypt the entry to refill the form:",
        err,
      );
    }
  });
  return decrypted;
}

/**
 * Saves entry locally and enqueues it in the outbox, then kicks off sync.
 */
export async function saveAndQueueEntry(
  entry: EntryV2,
  accountId: string,
  keyVersion = 1,
): Promise<void> {
  const enc = await encryptEntryLocally(entry, accountId, keyVersion);
  const stored: StoredEntry = {
    id: entry.id,
    seq: 0,
    key_version: keyVersion,
    nonce_b64: enc.nonce_b64,
    ct_b64: enc.ct_b64,
    deleted: false,
    received_at: entry.ts,
  };
  const item: OutboxItem = {
    id: entry.id,
    key_version: keyVersion,
    nonce_b64: enc.nonce_b64,
    ct_b64: enc.ct_b64,
    attempt_count: 0,
    created_at: entry.ts,
  };
  try {
    await commitEntry(stored, item);
  } catch (err) {
    if ((err as Error)?.name !== "QuotaExceededError") throw err;
    await keepDespiteFullDisk(stored, item);
  }
  broadcast({ type: "entries" });
  void announceStatus().catch(() => {});
  runSync(accountId).catch((err) =>
    console.warn("Background sync failed:", err)
  );
}
