// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The `emo-sync` lock where Web Locks are missing (reliability.md §1.3): one
 * tab at a time, renewable by its holder, free once released or expired.
 */
import "fake-indexeddb/auto";
import { assertEquals, assertRejects } from "@std/assert";
import {
  evictSyncedEntries,
  getAllEntries,
  getEntry,
  getMeta,
  getOutboxItems,
  markUploaded,
  type OutboxItem,
  putEntry,
  putOutboxItem,
  releaseLease,
  settleOutboxItem,
  tryTakeLease,
  wipeLocalDatabase,
  writeTombstone,
} from "./db.ts";

Deno.test({
  name: "db - the sync lease: one tab, renewable, released, expiring",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    assertEquals(await tryTakeLease("tab-a"), true);
    assertEquals(await tryTakeLease("tab-b"), false);
    assertEquals(await tryTakeLease("tab-a"), true);
    await releaseLease("tab-b"); // not the holder: nothing changes
    assertEquals(await tryTakeLease("tab-b"), false);
    await releaseLease("tab-a");
    assertEquals(await tryTakeLease("tab-b"), true);

    // A tab that died holding it: after 30 s another tab takes over
    const realNow = Date.now;
    Date.now = () => realNow() + 31_000;
    try {
      assertEquals(await tryTakeLease("tab-c"), true);
    } finally {
      Date.now = realNow;
    }
  },
});

Deno.test({
  name:
    "db - a full disk evicts the oldest synced ciphertext, never queued work",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    assertEquals(await getMeta<boolean>("evicted"), null);
    const row = (id: string, seq: number, deleted = false) => ({
      id,
      seq,
      key_version: 1,
      nonce_b64: deleted ? null : "n",
      ct_b64: deleted ? null : "c",
      deleted,
      received_at: "2026-10-08T10:00:00.000Z",
    });
    for (let seq = 1; seq <= 5; seq++) {
      await putEntry(row(`synced-${seq}`, seq));
    }
    await putEntry(row("tombstone", 6, true));
    await putEntry(row("local", 0));
    await putEntry(row("queued", 7));
    await putOutboxItem({
      id: "queued",
      key_version: 1,
      nonce_b64: "n",
      ct_b64: "c",
      attempt_count: 0,
      created_at: "2026-10-08T10:00:00.000Z",
    });

    assertEquals(await evictSyncedEntries(2), 3);
    assertEquals(
      (await getAllEntries()).map((e) => e.id).sort(),
      ["local", "queued", "synced-4", "synced-5", "tombstone"],
    );
    // History then says older check-ins are only on the server
    assertEquals(await getMeta<boolean>("evicted"), true);
    assertEquals(await evictSyncedEntries(2), 0);
  },
});

Deno.test({
  name:
    "db - a delete replaces a queued upload at once; a pass sending the upload leaves it be",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    const at = "2026-10-08T10:00:00.000Z";
    const upload: OutboxItem = {
      id: "e1",
      key_version: 2,
      nonce_b64: "n",
      ct_b64: "c",
      attempt_count: 0,
      created_at: at,
    };
    const live = {
      id: "e1",
      seq: 0,
      key_version: 2,
      nonce_b64: "n",
      ct_b64: "c",
      deleted: false,
      received_at: at,
    };
    await putEntry(live);
    await putOutboxItem(upload);

    // A pass is sending the upload; an Undo deletes it meanwhile
    await writeTombstone("e1", "2026-10-08T10:00:05.000Z");
    const tomb = await getEntry("e1");
    assertEquals(tomb?.deleted, true);
    assertEquals(tomb?.ct_b64, null);
    assertEquals(tomb?.key_version, 2);
    const queued = await getOutboxItems();
    assertEquals(queued.map((q) => [q.id, q.op, q.key_version]), [
      ["e1", "delete", 2],
    ]);

    // The pass's bookkeeping, whatever the PUT's outcome, changes nothing
    await markUploaded(upload, 7, at);
    assertEquals(await settleOutboxItem(upload, null), false);
    assertEquals(
      await settleOutboxItem(upload, { ...upload, attempt_count: 1 }),
      false,
    );
    assertEquals(await getEntry("e1"), tomb);
    assertEquals(await getOutboxItems(), queued);

    // Without an Undo the same bookkeeping applies
    await putEntry({ ...live, id: "e2" });
    await putOutboxItem({ ...upload, id: "e2" });
    await markUploaded({ ...upload, id: "e2" }, 8, at);
    assertEquals((await getEntry("e2"))?.seq, 8);
    assertEquals((await getOutboxItems()).map((q) => q.id), ["e1"]);
    assertEquals(await settleOutboxItem(queued[0], null), true);
    assertEquals(await getOutboxItems(), []);
  },
});

Deno.test({
  name:
    "db - a tombstone whose delete op cannot be written leaves the entry as it was",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    const live = {
      id: "e3",
      seq: 4,
      key_version: 1,
      nonce_b64: "n",
      ct_b64: "c",
      deleted: false,
      received_at: "2026-10-08T10:00:00.000Z",
    };
    await putEntry(live);
    // The storage refuses the outbox write (a lost connection, a full disk)
    const proto = IDBObjectStore.prototype;
    const put = proto.put;
    proto.put = function (
      this: IDBObjectStore,
      ...args: [unknown, IDBValidKey?]
    ) {
      if (this.name === "outbox") {
        throw new DOMException("lost", "UnknownError");
      }
      return put.apply(this, args);
    };
    try {
      await assertRejects(() => writeTombstone("e3"));
    } finally {
      proto.put = put;
    }
    assertEquals(await getEntry("e3"), live);
    assertEquals(await getOutboxItems(), []);
  },
});
