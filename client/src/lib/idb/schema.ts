// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The IndexedDB schema (data.md §8.3): `DB_VERSION` and one upgrade
 * step per version in `MIGRATIONS`, run in order inside the upgrade
 * transaction. Migrations are additive: a store is never dropped in place; a
 * rename is create + copy + delete in the same step. Never edit a released
 * step; add the next one.
 */

export const DB_NAME = "emo";
export const DB_VERSION = 3;

type Step = (db: IDBDatabase, tx: IDBTransaction) => void;

export const MIGRATIONS: Record<number, Step> = {
  1: (db) => {
    const entries = db.createObjectStore("entries", { keyPath: "id" });
    entries.createIndex("idx_seq", "seq", { unique: false });
    const outbox = db.createObjectStore("outbox", { keyPath: "id" });
    outbox.createIndex("idx_attempts", "attempt_count", { unique: false });
    db.createObjectStore("keys", { keyPath: "id" });
    db.createObjectStore("meta", { keyPath: "key" });
    db.createObjectStore("draft", { keyPath: "key" });
    db.createObjectStore("prefs", { keyPath: "key" });
  },

  // v1 kept decrypted payloads, a plaintext `ts` index and a plaintext draft
  // on disk. Strip them; the ciphertext is kept.
  2: (_db, tx) => {
    const entries = tx.objectStore("entries");
    if (entries.indexNames.contains("idx_ts")) entries.deleteIndex("idx_ts");
    entries.openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      const { payload: _payload, ts: _ts, ...rest } = cursor.value;
      cursor.update(rest);
      cursor.continue();
    };
    tx.objectStore("draft").clear();
  },

  // The reminder journal, by id
  3: (db) => {
    db.createObjectStore("reminders", { keyPath: "id" });
  },
};

/** Runs every step after `oldVersion`, up to `DB_VERSION`. */
export function upgradeDatabase(
  db: IDBDatabase,
  tx: IDBTransaction,
  oldVersion: number,
): void {
  for (let v = oldVersion + 1; v <= DB_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No IndexedDB migration to version ${v}`);
    step(db, tx);
  }
}
