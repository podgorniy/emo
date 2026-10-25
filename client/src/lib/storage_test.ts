// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * No plaintext reaches IndexedDB (architecture.md §8.1): entries and the draft
 * are stored as ciphertext, and v1 databases are stripped on upgrade.
 */
import "fake-indexeddb/auto";
import { assert, assertEquals } from "@std/assert";
import type { EntryV2 } from "../../../shared/entry.ts";
import { newDraft, setNote } from "./machine.ts";
import { getAllEntries } from "./db.ts";
import { setupKeyring } from "./crypto.ts";
import { forgetDraftInMemory, loadDraft, saveDraft } from "./draft.ts";
import { saveAndQueueEntry } from "./sync.ts";

const ACCOUNT = "0192f1c4-7b43-7000-8000-000000000001";
const SECRET_NOTE = "созвон с руководителем";
const opts = { sanitizeOps: false, sanitizeResources: false };

// The client is offline in these tests: every request fails.
globalThis.fetch = () => Promise.reject(new TypeError("offline"));

function rawRows(store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("emo");
    open.onsuccess = () => {
      const req = open.result.transaction(store, "readonly").objectStore(store)
        .getAll();
      req.onsuccess = () => {
        open.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    };
    open.onerror = () => reject(open.error);
  });
}

function sampleEntry(): EntryV2 {
  return {
    schema_v: 2,
    id: crypto.randomUUID(),
    ts: "2026-10-08T10:00:00.000Z",
    tz_offset_min: 180,
    trigger: "manual",
    reminder_id: null,
    latency_sec: 30,
    hidden_sec: 0,
    skipped: false,
    abandoned: false,
    untouched: [],
    ui: null,
    body: { locations: ["chest"], qualities: ["squeeze"], intensity: 6 },
    affect: {
      valence: -2,
      arousal: 7,
      word: "fear.anxiety",
      word_confidence: "guess",
    },
    urge: "shrink",
    head_mode: 8,
    context_tag: "work",
    context_other: null,
    note: SECRET_NOTE,
  };
}

// Runs first: creates a v1 database the way the old client did.
Deno.test({
  name: "storage - v1 database is stripped of plaintext on upgrade",
  ...opts,
  fn: async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("emo", 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        const entries = db.createObjectStore("entries", { keyPath: "id" });
        entries.createIndex("idx_seq", "seq");
        entries.createIndex("idx_ts", "ts");
        for (const s of ["outbox", "keys"]) {
          db.createObjectStore(s, { keyPath: "id" });
        }
        for (const s of ["meta", "draft", "prefs"]) {
          db.createObjectStore(s, { keyPath: "key" });
        }
        entries.put({
          id: "old",
          seq: 1,
          key_version: 1,
          nonce_b64: "n",
          ct_b64: "c",
          deleted: false,
          ts: "2026-10-01T10:00:00Z",
          payload: { note: SECRET_NOTE },
          received_at: "2026-10-01T10:00:01Z",
        });
        open.transaction!.objectStore("draft").put({
          key: "current",
          data: { entry: { note: SECRET_NOTE } },
        });
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });

    const entries = await getAllEntries(); // opens and upgrades to v2
    assertEquals(entries.length, 1);
    assertEquals(Object.keys(entries[0]).sort(), [
      "ct_b64",
      "deleted",
      "id",
      "key_version",
      "nonce_b64",
      "received_at",
      "seq",
    ]);
    assertEquals(await rawRows("draft"), []);
  },
});

Deno.test({
  name: "storage - a saved entry is ciphertext only",
  ...opts,
  fn: async () => {
    await setupKeyring(ACCOUNT, "correct horse battery");
    const entry = sampleEntry();
    await saveAndQueueEntry(entry, ACCOUNT, 1);

    for (const store of ["entries", "outbox"]) {
      const rows = await rawRows(store);
      const row = rows.find((r) => (r as { id: string }).id === entry.id);
      assert(row, `${store} has the entry`);
      const text = JSON.stringify(row);
      assert(!text.includes(SECRET_NOTE), `${store} holds plaintext`);
      assert(!text.includes("fear.anxiety"), `${store} holds plaintext`);
      assert(!("payload" in (row as object)), `${store} holds a payload`);
      assert(!("ts" in (row as object)), `${store} holds the entry time`);
    }
  },
});

Deno.test({
  name: "storage - the draft is ciphertext and survives a reload",
  ...opts,
  fn: async () => {
    const t0 = Date.parse("2026-10-08T10:00:00Z");
    const draft = setNote(newDraft("manual", null, t0), SECRET_NOTE, t0);
    await saveDraft(ACCOUNT, draft);

    const rows = await rawRows("draft");
    assertEquals(rows.length, 1);
    assertEquals(Object.keys(rows[0] as object).sort(), [
      "ct_b64",
      "key",
      "nonce_b64",
    ]);
    assert(!JSON.stringify(rows[0]).includes(SECRET_NOTE));

    forgetDraftInMemory(); // as after a reload or Lock
    assertEquals(await loadDraft(ACCOUNT), draft);
    // Another account cannot read it
    forgetDraftInMemory();
    assertEquals(await loadDraft("another-account"), null);
  },
});
