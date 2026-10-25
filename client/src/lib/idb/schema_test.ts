// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * reliability.md §1.1, data.md §8.3: a database left at each older version upgrades
 * to the current schema with its rows; another tab's upgrade closes this
 * tab's connection instead of blocking; failures reject instead of hanging.
 */
import "fake-indexeddb/auto";
import { assertEquals, assertRejects } from "@std/assert";
import { DB_NAME, DB_VERSION, MIGRATIONS } from "./schema.ts";
import {
  closeDatabase,
  deleteLocalDatabase,
  getAllEntries,
  openDatabase,
  setVersionChangeHandler,
  StorageDamagedError,
  withStore,
} from "../db.ts";

const ALL_STORES = [
  "draft",
  "entries",
  "keys",
  "meta",
  "outbox",
  "prefs",
  "reminders",
];

/** A database as an older build left it: steps 1..version, then `fill`. */
function legacyDatabase(
  version: number,
  fill: (tx: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const tx = req.transaction!;
      for (let v = 1; v <= version; v++) MIGRATIONS[v](req.result, tx);
      if (version === 1) {
        // v1 also had a plaintext `ts` index
        tx.objectStore("entries").createIndex("idx_ts", "ts");
      }
      fill(tx);
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

async function fresh() {
  closeDatabase();
  await deleteLocalDatabase();
}

const row = {
  id: "8b1f9a52-6c1d-4c3e-9f0a-1d2e3f4a5b6c",
  seq: 7,
  key_version: 1,
  nonce_b64: "n",
  ct_b64: "c",
  deleted: false,
  received_at: "2026-10-08T10:00:00.000Z",
};

Deno.test({
  name: "idb - a v1 database upgrades: plaintext gone, ciphertext kept",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await fresh();
    await legacyDatabase(1, (tx) => {
      tx.objectStore("entries").put({
        ...row,
        payload: { note: "plaintext" },
        ts: "2026-10-08T09:59:00Z",
      });
      tx.objectStore("draft").put({ key: "current", answers: {} });
    });
    const db = await openDatabase();
    assertEquals(db.version, DB_VERSION);
    assertEquals([...db.objectStoreNames].sort(), ALL_STORES);
    const entries = db.transaction("entries").objectStore("entries");
    assertEquals([...entries.indexNames], ["idx_seq"]);
    assertEquals(await getAllEntries(), [row]);
    assertEquals(
      await withStore("draft", "readonly", (s) => s.get("current")),
      undefined,
    );
  },
});

Deno.test({
  name: "idb - a v2 database gains the reminders store and keeps its rows",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await fresh();
    await legacyDatabase(2, (tx) => {
      tx.objectStore("entries").put(row);
      tx.objectStore("meta").put({ key: "cursor_seq", value: 7 });
    });
    const db = await openDatabase();
    assertEquals([...db.objectStoreNames].sort(), ALL_STORES);
    assertEquals(await getAllEntries(), [row]);
  },
});

Deno.test({
  name:
    "idb - another tab's upgrade closes this connection instead of blocking",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await fresh();
    await openDatabase();
    let notified = false;
    setVersionChangeHandler(() => (notified = true));
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION + 1);
      req.onblocked = () => reject(new Error("blocked"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    assertEquals(notified, true);
    newer.close();
    setVersionChangeHandler(() => {});
    await fresh();
  },
});

Deno.test({
  name: "idb - a failing write rejects instead of hanging",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await fresh();
    await assertRejects(() =>
      withStore("meta", "readwrite", (s) => s.put({ no_key: true }))
    );
    // And the next write works
    await withStore("meta", "readwrite", (s) => s.put({ key: "k", value: 1 }));
  },
});

Deno.test({
  name: "idb - a database that cannot be opened is StorageDamaged",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    closeDatabase();
    const real = globalThis.indexedDB;
    let attempts = 0;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        open() {
          attempts++;
          const req = {} as IDBOpenDBRequest;
          setTimeout(() => {
            Object.defineProperty(req, "error", {
              value: new DOMException("corrupt", "UnknownError"),
            });
            req.onerror?.(new Event("error"));
          }, 0);
          return req;
        },
      },
    });
    try {
      await assertRejects(() => openDatabase(), StorageDamagedError);
      assertEquals(attempts, 2);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: real,
      });
    }
  },
});
