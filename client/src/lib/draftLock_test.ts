// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §6.2, architecture.md §7.1: saving is one transaction, and one tab at a time
 * owns the draft.
 */
import "fake-indexeddb/auto";
import { assertEquals, assertRejects } from "@std/assert";
import {
  commitEntry,
  getAllEntries,
  getOutboxItems,
  getStoredDraft,
  type OutboxItem,
  putStoredDraft,
  type StoredEntry,
  wipeLocalDatabase,
} from "./db.ts";
import { holdDraftLock, holdsDraftLock } from "./draftLock.ts";

const entry: StoredEntry = {
  id: "8b1f9a52-6c1d-4c3e-9f0a-1d2e3f4a5b6c",
  seq: 0,
  key_version: 1,
  nonce_b64: "AAAAAAAAAAAAAAAA",
  ct_b64: "AAAA",
  deleted: false,
  received_at: "2026-10-08T10:00:00.000Z",
};
const item: OutboxItem = {
  id: entry.id,
  key_version: 1,
  nonce_b64: entry.nonce_b64!,
  ct_b64: entry.ct_b64!,
  attempt_count: 0,
  created_at: entry.received_at,
};

Deno.test({
  name: "save - entry, outbox item and draft removal commit together",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    await putStoredDraft({ nonce_b64: "n", ct_b64: "c" });

    // A write that fails half way leaves everything as it was
    await assertRejects(() =>
      commitEntry(entry, { ...item, id: undefined } as unknown as OutboxItem)
    );
    assertEquals(await getAllEntries(), []);
    assertEquals((await getStoredDraft())?.ct_b64, "c");

    await commitEntry(entry, item);
    assertEquals((await getAllEntries()).map((e) => e.id), [entry.id]);
    assertEquals((await getOutboxItems()).map((o) => o.id), [entry.id]);
    assertEquals(await getStoredDraft(), null);
  },
});

Deno.test("draft lock - a second tab gets null until the first lets go", async () => {
  // A minimal LockManager with `ifAvailable` (Deno has none)
  const held = new Set<string>();
  const locks = {
    request(
      name: string,
      _opts: { ifAvailable: boolean },
      cb: (lock: { name: string } | null) => unknown,
    ) {
      if (held.has(name)) return Promise.resolve(cb(null));
      held.add(name);
      return Promise.resolve(cb({ name })).finally(() => held.delete(name));
    },
  };
  const nav = globalThis.navigator as unknown as { locks?: unknown };
  const saved = Object.getOwnPropertyDescriptor(nav, "locks");
  Object.defineProperty(nav, "locks", { value: locks, configurable: true });
  try {
    assertEquals(holdsDraftLock(), false);
    const first = await holdDraftLock();
    assertEquals(typeof first, "function");
    assertEquals(holdsDraftLock(), true);
    // The tab told "open in another window" does not hold it
    assertEquals(await holdDraftLock(), null);
    assertEquals(holdsDraftLock(), true);
    first!();
    first!();
    assertEquals(holdsDraftLock(), false);
    await new Promise((r) => setTimeout(r, 0));
    const third = await holdDraftLock();
    assertEquals(typeof third, "function");
    third!();
    assertEquals(holdsDraftLock(), false);
  } finally {
    if (saved) Object.defineProperty(nav, "locks", saved);
    else delete nav.locks;
  }
});
