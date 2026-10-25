// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The sync pass against the real server (architecture.md §8.3, development.md §5.2;
 * api.md §3): restore and epoch, tombstones, 410, the reminder
 * journal, prefs last-write-wins and the settings step.
 */
import "fake-indexeddb/auto";
import { assert, assertEquals } from "@std/assert";
import { startTestServer } from "../../../server/testing/harness.ts";
import { generateEpoch } from "../../../server/db/index.ts";
import {
  apiDeleteEntry,
  ApiErrorResponse,
  apiGetPrefs,
  apiPutKeyring,
  apiPutPrefs,
  getObservedEpoch,
} from "./api.ts";
import {
  decryptPrefsLocally,
  encryptPrefsLocally,
  getCachedAuthKey,
  setupKeyring,
} from "./crypto.ts";
import {
  getAllEntries,
  getAllReminders,
  getEntry,
  getMeta,
  getOutboxItems,
  putReminders,
  releaseLease,
  setMeta,
  tryTakeLease,
  wipeLocalDatabase,
} from "./db.ts";
import * as m from "./machine.ts";
import { openCheckIn, saveCheckIn } from "./checkin.ts";
import { forgetPrefsEmail, saveAppearance } from "./prefs.ts";
import { sessionEmail, setSessionEmail } from "./sessionEmail.ts";
import { getAppearance } from "./theme.ts";
import {
  clearSyncRetry,
  currentSyncStatus,
  emergencyUndo,
  runSync,
  unsavedCount,
} from "./sync.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const UI = {
  theme: "3f9a1c0be27d4a65",
  intensity: "slider",
  options: "grid",
  figure: "solid",
} as const;

async function device(email: string) {
  await wipeLocalDatabase();
  const server = startTestServer();
  const restoreFetch = server.installFetch();
  const { accountId } = await server.signUp(email);
  const setup = await setupKeyring(accountId, "a passphrase 1");
  await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
  const save = async (note: string) => {
    let d = await openCheckIn(accountId, 1, "manual", null);
    d = m.toggleLocation(d, "chest", Date.now());
    d = m.toggleQuality(d, "squeeze", Date.now());
    d = m.toggleContext(d, "work", Date.now());
    d = m.setNote(d, note, Date.now());
    return await saveCheckIn(accountId, 1, d, UI);
  };
  const liveOnServer = () =>
    (server.db.prepare(
      "SELECT COUNT(*) AS n FROM entries WHERE account_id = ? AND deleted = 0",
    ).get(accountId) as { n: number }).n;
  return { server, restoreFetch, accountId, save, liveOnServer };
}

/**
 * The sync pass in flight is over (an Undo's runs in the background): a call
 * while one runs resolves with it, one more pass included; a failed one is
 * left to its retry.
 */
async function passOver(accountId: string): Promise<void> {
  await runSync(accountId).catch(() => {});
}

Deno.test({
  name: "sync - a restore with a new epoch gets all 5 entries back",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId, save, liveOnServer } =
      await device("epoch@example.org");
    try {
      for (let i = 0; i < 5; i++) await save(`kitchen ${i}`);
      await runSync(accountId);
      assertEquals(liveOnServer(), 5);
      const before = await getMeta<string>("server_epoch");
      assert(before);

      // `emo restore` of a snapshot taken before any entry: rows gone, new epoch
      server.db.prepare("DELETE FROM entries").run();
      const epoch = generateEpoch();
      server.db.prepare("UPDATE meta SET value = ? WHERE key = 'epoch'").run(
        epoch,
      );

      await runSync(accountId);
      assertEquals(liveOnServer(), 5);
      assertEquals(await getMeta<string>("server_epoch"), epoch);
      assertEquals(getObservedEpoch(), epoch);
      assertEquals((await getOutboxItems()).length, 0);
      assertEquals(await getMeta<number>("cursor_seq"), 5);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - a server behind our cursor (same epoch) is refilled too",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId, save, liveOnServer } =
      await device("behind@example.org");
    try {
      for (let i = 0; i < 3; i++) await save(`desk ${i}`);
      await runSync(accountId);
      server.db.prepare("DELETE FROM entries").run();
      await runSync(accountId);
      assertEquals(liveOnServer(), 3);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "sync - deleted elsewhere: 410 drops the upload; a pulled tombstone wins",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, save } = await device("gone@example.org");
    try {
      // Another device deleted it before this one uploaded (410 on PUT)
      const offline = await save("by the window");
      await apiDeleteEntry(offline.id, getCachedAuthKey()!);
      await runSync(accountId);
      assertEquals((await getOutboxItems()).length, 0);
      assertEquals((await getEntry(offline.id))?.deleted, true);

      // Uploaded, then deleted elsewhere: the pull turns it into a tombstone
      const synced = await save("balcony");
      await runSync(accountId);
      assertEquals((await getEntry(synced.id))?.deleted, false);
      await apiDeleteEntry(synced.id, getCachedAuthKey()!);
      await runSync(accountId);
      const local = await getEntry(synced.id);
      assertEquals([local?.deleted, local?.ct_b64], [true, null]);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - the reminder journal is pulled into its store",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId } = await device(
      "journal@example.org",
    );
    try {
      const past = new Date(Date.now() - 3_600_000).toISOString();
      server.db.prepare(`
        INSERT INTO reminders (id, account_id, local_date, tz, scheduled_for, sent_at, status, updated_at)
        VALUES (?, ?, '2026-10-08', 'Europe/Kyiv', ?, ?, 'sent', ?)
      `).run(crypto.randomUUID(), accountId, past, past, past);
      await runSync(accountId);
      const rows = await getAllReminders();
      assertEquals(rows.map((r) => r.status), ["sent"]);
      assertEquals(rows.map((r) => [r.tz, r.reason]), [["Europe/Kyiv", null]]);
      assertEquals(await getMeta<string>("reminders_since"), past);

      // A journal pulled before rows had `tz`: pulled again once, from the
      // start, and then from where it ended as before
      await putReminders(rows.map(({ tz: _tz, reason: _r, ...old }) => old));
      await setMeta("reminders_fields", null);
      await runSync(accountId);
      assertEquals(
        (await getAllReminders()).map((r) => r.tz),
        ["Europe/Kyiv"],
      );
      assertEquals(await getMeta<number>("reminders_fields"), 2);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "sync - prefs: a local change is uploaded; a newer server blob is applied",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await device("prefs@example.org");
    try {
      await saveAppearance({ themeId: "night" }, accountId, 1);
      await runSync(accountId);
      assert((await apiGetPrefs()).ct_b64.length > 0);

      // Another device chose "paper" later
      const other = await encryptPrefsLocally(
        // Another device on an older build: the `{ preset }` shape
        { appearance: { preset: "paper" } },
        accountId,
        1,
      );
      await apiPutPrefs({ key_version: 1, ...other });
      await runSync(accountId);
      assertEquals(getAppearance().themeId, "paper");
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "sync - prefs: the sign-in address is written in, encrypted, after the server's appearance is taken",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await device("mail@example.org");
    try {
      // An account from before: prefs with an appearance and no address
      setSessionEmail(null);
      forgetPrefsEmail();
      const other = await encryptPrefsLocally(
        { appearance: { themeId: "paper" } },
        accountId,
        1,
      );
      await apiPutPrefs({ key_version: 1, ...other });
      // The next sign-in on this device knows the address
      setSessionEmail("  Mail@Example.org ");
      await runSync(accountId);
      const remote = await apiGetPrefs();
      const prefs = await decryptPrefsLocally<
        { appearance: { themeId: string }; email?: string }
      >(remote.nonce_b64, remote.ct_b64, accountId, remote.key_version);
      assertEquals(prefs?.email, "mail@example.org");
      // The server's appearance was kept, not this device's default
      assertEquals(prefs?.appearance.themeId, "paper");
      assertEquals(getAppearance().themeId, "paper");
      // Never in plaintext on the wire or on the device
      assert(!remote.ct_b64.includes("mail"));
      // After a restart (memory gone) the unlocked prefs name the account
      setSessionEmail(null);
      forgetPrefsEmail();
      await runSync(accountId);
      const { applyStoredPrefs } = await import("./prefs.ts");
      await applyStoredPrefs(accountId);
      assertEquals(sessionEmail(), "mail@example.org");
    } finally {
      setSessionEmail(null);
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - this device's time zone reaches the server once it differs",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId } = await device("tz@example.org");
    try {
      const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const other = deviceTz === "Pacific/Auckland"
        ? "Europe/Kyiv"
        : "Pacific/Auckland";
      server.db.prepare("UPDATE accounts SET tz = ? WHERE id = ?").run(
        other,
        accountId,
      );
      await setMeta("settings", null);
      await runSync(accountId);
      const tz = (server.db.prepare("SELECT tz FROM accounts WHERE id = ?").get(
        accountId,
      ) as {
        tz: string;
      }).tz;
      assertEquals(tz, deviceTz);

      // Another device in another zone moves the account: this one leaves
      // it there, since its own tz has not changed
      const accountTz = () =>
        (server.db.prepare("SELECT tz FROM accounts WHERE id = ?").get(
          accountId,
        ) as { tz: string }).tz;
      server.db.prepare("UPDATE accounts SET tz = ? WHERE id = ?").run(
        other,
        accountId,
      );
      await setMeta("settings", null);
      await runSync(accountId);
      assertEquals(accountTz(), other);

      // Once this device itself has moved, it says so again
      await setMeta("tz_sent", "Atlantic/Azores");
      await runSync(accountId);
      assertEquals(accountTz(), deviceTz);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - an Undo made offline still reaches the server later (H30)",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId, save } = await device(
      "undo@example.org",
    );
    try {
      const entry = await save("hallway");
      await runSync(accountId);
      const live = () =>
        (server.db.prepare("SELECT deleted FROM entries WHERE id = ?").get(
          entry.id,
        ) as {
          deleted: number;
        }).deleted === 0;
      assertEquals(live(), true);

      // Offline: the DELETE cannot go out, but it is not lost
      const online = globalThis.fetch;
      globalThis.fetch = () => Promise.reject(new TypeError("offline"));
      const { emergencyUndo } = await import("./sync.ts");
      const refill = await emergencyUndo(entry.id, accountId);
      // The Undo's own pass runs in the background: still offline
      await passOver(accountId);
      globalThis.fetch = online;
      assertEquals(refill?.note, "hallway");
      assertEquals((await getEntry(entry.id))?.deleted, true);
      const queued = await getOutboxItems();
      assertEquals(queued.map((q) => [q.id, q.op]), [[entry.id, "delete"]]);
      assertEquals(live(), true);

      // Back online: the next pass sends it; the pull does not bring it back
      await runSync(accountId);
      assertEquals(live(), false);
      assertEquals((await getOutboxItems()).length, 0);
      assertEquals((await getEntry(entry.id))?.deleted, true);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - an Undo outlives a restore from a backup taken before it",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId, save, liveOnServer } =
      await device("restore-undo@example.org");
    try {
      const entry = await save("stairs");
      await runSync(accountId);
      assertEquals(liveOnServer(), 1);

      // The nightly backup runs between the upload and the Undo
      type Row = Record<string, string | number | Uint8Array | null>;
      const backup = server.db.prepare(
        "SELECT * FROM entries WHERE account_id = ?",
      ).all(accountId) as Row[];
      await emergencyUndo(entry.id, accountId);
      await passOver(accountId);
      assertEquals(liveOnServer(), 0);

      // `emo restore` of that backup: the tombstone is gone, the entry is
      // live again, and the epoch is new
      server.db.prepare("DELETE FROM entries WHERE account_id = ?").run(
        accountId,
      );
      const insert = server.db.prepare(`
        INSERT INTO entries (id, account_id, seq, key_version, nonce, ciphertext, deleted, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of backup) {
        insert.run(
          r.id,
          r.account_id,
          r.seq,
          r.key_version,
          r.nonce,
          r.ciphertext,
          r.deleted,
          r.received_at,
        );
      }
      server.db.prepare("UPDATE meta SET value = ? WHERE key = 'epoch'").run(
        generateEpoch(),
      );
      assertEquals(liveOnServer(), 1);

      // This device still holds the Undo: the server gets it back, so no
      // other device ever sees the entry again
      await runSync(accountId);
      assertEquals(liveOnServer(), 0);
      assertEquals((await getEntry(entry.id))?.deleted, true);
      assertEquals((await getOutboxItems()).length, 0);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "sync - an Undo returns before its pass: a stalled request never holds it",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, save, liveOnServer } = await device(
      "undo-stall@example.org",
    );
    const shim = globalThis.fetch;
    let release = () => {};
    try {
      const entry = await save("porch");
      await runSync(accountId);
      assertEquals(liveOnServer(), 1);

      // The connection stalls: no request gets an answer until let go
      const gate = new Promise<void>((r) => (release = r));
      let asked = 0;
      globalThis.fetch =
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          asked++;
          await gate;
          return await shim(input, init);
        }) as typeof fetch;
      const refill = await emergencyUndo(entry.id, accountId);
      assertEquals(refill?.note, "porch");
      assertEquals((await getEntry(entry.id))?.deleted, true);
      const queued = await getOutboxItems();
      assertEquals(queued.map((q) => [q.id, q.op]), [[entry.id, "delete"]]);
      // Its pass is still waiting on the DELETE; the server has the entry
      for (let i = 0; i < 200 && asked === 0; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert(asked > 0, "the pass never asked");
      assertEquals(liveOnServer(), 1);

      // Let go: that pass sends it
      release();
      await passOver(accountId);
      assertEquals(liveOnServer(), 0);
      assertEquals((await getOutboxItems()).length, 0);
    } finally {
      release();
      globalThis.fetch = shim;
      restoreFetch();
    }
  },
});

/**
 * Saved's Undo comes within 5 s of the save, while the save's own pass is
 * still sending it. `fail` loses the PUT's reply after the server took it.
 */
async function undoDuringUpload(email: string, fail: boolean) {
  const { restoreFetch, accountId, liveOnServer } = await device(email);
  const shim = globalThis.fetch;
  let release = () => {};
  try {
    let d = await openCheckIn(accountId, 1, "manual", null);
    d = m.toggleLocation(d, "chest", Date.now());
    d = m.toggleQuality(d, "squeeze", Date.now());
    d = m.toggleContext(d, "work", Date.now());
    d = m.setNote(d, "porch", Date.now());

    // The connection stalls from here: the save's pass hangs on its PUT
    const gate = new Promise<void>((r) => (release = r));
    let asked = 0;
    globalThis.fetch =
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (++asked > 1) return await shim(input, init);
        await gate;
        const res = await shim(input, init);
        if (fail) throw new TypeError("the reply was lost");
        return res;
      }) as typeof fetch;
    const entry = await saveCheckIn(accountId, 1, d, UI);
    for (let i = 0; i < 200 && asked === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert(asked > 0, "the save's pass never asked");

    // Undo does not wait for that pass (it holds the sync lock)
    const undo = emergencyUndo(entry.id, accountId);
    const raced = await Promise.race([
      undo.then(() => "done"),
      new Promise((r) => setTimeout(() => r("waiting"), 1000)),
    ]);
    assertEquals(raced, "done", "Undo waited for the save's pass");
    assertEquals((await undo)?.note, "porch");
    assertEquals((await getEntry(entry.id))?.deleted, true);
    assertEquals(
      (await getOutboxItems()).map((q) => [q.id, q.op]),
      [[entry.id, "delete"]],
    );

    // The PUT then lands: it neither brings the row back nor drops the
    // DELETE, which the next pass sends
    release();
    await passOver(accountId);
    await passOver(accountId);
    assertEquals((await getEntry(entry.id))?.deleted, true);
    assertEquals(liveOnServer(), 0);
    assertEquals((await getOutboxItems()).length, 0);
  } finally {
    release();
    globalThis.fetch = shim;
    clearSyncRetry();
    restoreFetch();
  }
}

Deno.test({
  name: "sync - an Undo while the save's PUT is stalled returns at once",
  ...opts,
  fn: () => undoDuringUpload("undo-inflight@example.org", false),
});

Deno.test({
  name:
    "sync - an Undo while the save's PUT is stalled, its reply lost, still deletes",
  ...opts,
  fn: () => undoDuringUpload("undo-inflight-lost@example.org", true),
});

Deno.test({
  name:
    "sync - an Undo the storage refuses half-way leaves the check-in saved, never half-deleted",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, save, liveOnServer } = await device(
      "undo-half@example.org",
    );
    const proto = IDBObjectStore.prototype;
    const put = proto.put;
    try {
      const entry = await save("porch");
      await runSync(accountId);
      // The entry's row is written; the outbox's `delete` is refused
      proto.put = function (
        this: IDBObjectStore,
        ...args: [unknown, IDBValidKey?]
      ) {
        if (this.name === "outbox") {
          throw new DOMException("Connection lost", "UnknownError");
        }
        return put.apply(this, args);
      };
      let failed = false;
      await emergencyUndo(entry.id, accountId).catch(() => (failed = true));
      proto.put = put;
      // Saved then says it is still saved: so it is, here and on the server
      assert(failed, "Undo claimed a deletion");
      const row = await getEntry(entry.id);
      assertEquals(row?.deleted, false);
      assert(row?.ct_b64);
      assertEquals(await getOutboxItems(), []);
      await passOver(accountId);
      assertEquals(liveOnServer(), 1);
    } finally {
      proto.put = put;
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - a device clock 10 minutes off is noted, then cleared",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await device("clock@example.org");
    const shim = globalThis.fetch;
    let offsetMs = 10 * 60_000;
    // The server's HTTP layer adds `Date`; the test app does not
    globalThis.fetch =
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await shim(input, init);
        const headers = new Headers(res.headers);
        headers.set("Date", new Date(Date.now() + offsetMs).toUTCString());
        return new Response(res.body, { status: res.status, headers });
      }) as typeof fetch;
    try {
      await runSync(accountId);
      const skew = await getMeta<number>("clock_skew_sec");
      assert(skew !== null && Math.abs(skew - 600) <= 2, String(skew));

      offsetMs = 0;
      await runSync(accountId);
      assertEquals(await getMeta("clock_skew_sec"), null);
    } finally {
      globalThis.fetch = shim;
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - 409: an id taken by other bytes is re-encrypted under a new id",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId, save } = await device(
      "rekey@example.org",
    );
    const shim = globalThis.fetch;
    try {
      // Saved offline, so nothing is uploaded yet
      globalThis.fetch = () => Promise.reject(new TypeError("offline"));
      const entry = await save("кава, балкон");
      await new Promise((r) => setTimeout(r, 50));
      globalThis.fetch = shim;
      // Another blob already holds that id on the server (a UUID collision)
      server.db.prepare(`
        INSERT INTO entries (id, account_id, seq, key_version, nonce, ciphertext, deleted, received_at)
        VALUES (?, ?, 1, 1, randomblob(12), randomblob(2064), 0, ?)
      `).run(entry.id, accountId, new Date().toISOString());

      await runSync(accountId);
      assertEquals(await getMeta("renamed"), 1);
      assertEquals((await getEntry(entry.id))?.deleted, true);
      // Queued again under the new id (architecture.md §8.3): the next pass sends it
      await runSync(accountId);
      const ids = (server.db.prepare(
        "SELECT id FROM entries WHERE account_id = ? ORDER BY seq",
      ).all(accountId) as Array<{ id: string }>).map((r) => r.id);
      assertEquals(ids.length, 2);
      assertEquals(ids[0], entry.id);
      assertEquals((await getEntry(ids[1]))?.deleted, false);
      assertEquals(await getOutboxItems(), []);
    } finally {
      globalThis.fetch = shim;
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - a pull of more than one page gets every entry",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId } = await device(
      "pages@example.org",
    );
    try {
      const insert = server.db.prepare(`
        INSERT INTO entries (id, account_id, seq, key_version, nonce, ciphertext, deleted, received_at)
        VALUES (?, ?, ?, 1, randomblob(12), randomblob(2064), 0, ?)
      `);
      server.db.exec("BEGIN");
      for (let seq = 1; seq <= 1203; seq++) {
        insert.run(
          crypto.randomUUID(),
          accountId,
          seq,
          new Date().toISOString(),
        );
      }
      server.db.exec("COMMIT");
      await runSync(accountId);
      assertEquals(await getMeta("cursor_seq"), 1203);
      // Three pages of 500, 500 and 203
      assertEquals((await getAllEntries()).length, 1203);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "sync - a full disk keeps the check-in in memory, then writes or sends it",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, save, liveOnServer } = await device(
      "quota@example.org",
    );
    const shim = globalThis.fetch;
    const put = IDBObjectStore.prototype.put;
    let full = true;
    // As a browser does it: the write is accepted, then the transaction
    // aborts with QuotaExceededError
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (full && this.name === "entries") {
        const tx = this.transaction;
        const error = new DOMException("disk full", "QuotaExceededError");
        queueMicrotask(() => {
          Object.defineProperty(tx, "error", {
            get: () => error,
            set: () => {},
            configurable: true,
          });
          try {
            tx.abort();
          } catch {
            // Already finished
          }
        });
      }
      return put.apply(this, args);
    };
    try {
      // Offline as well: it can only wait in memory
      globalThis.fetch = () => Promise.reject(new TypeError("offline"));
      const first = await save("кава, балкон");
      await new Promise((r) => setTimeout(r, 50));
      assertEquals(unsavedCount(), 1);
      assertEquals(await getEntry(first.id), null);
      assertEquals(await currentSyncStatus(), "pending");

      // Online, room again: written locally, then uploaded
      globalThis.fetch = shim;
      full = false;
      await runSync(accountId);
      assertEquals(unsavedCount(), 0);
      assertEquals((await getEntry(first.id))?.deleted, false);
      assertEquals(liveOnServer(), 1);

      // Online but still full: sent straight to the server
      full = true;
      globalThis.fetch = () => Promise.reject(new TypeError("offline"));
      await save("by the window");
      await new Promise((r) => setTimeout(r, 50));
      globalThis.fetch = shim;
      // The upload goes first; the pull after it cannot write either
      await runSync(accountId).catch(() => {});
      assertEquals(unsavedCount(), 0);
      assertEquals(liveOnServer(), 2);
    } finally {
      IDBObjectStore.prototype.put = put;
      globalThis.fetch = shim;
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "sync - a pass held by another tab is waited for, then runs (Web Locks and lease)",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, save, liveOnServer } = await device(
      "twotabs@example.org",
    );
    const settled = async (p: Promise<void>) => {
      let done = false;
      void p.then(() => (done = true));
      await new Promise((r) => setTimeout(r, 300));
      return done;
    };
    try {
      // Another tab holds the Web Lock
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      void navigator.locks.request("emo-sync", () => held);
      await save("hall");
      const first = runSync(accountId);
      assertEquals(await settled(first), false);
      assertEquals(liveOnServer(), 0);
      release();
      await first;
      assertEquals(liveOnServer(), 1);

      // No Web Locks: the IndexedDB lease, same semantics
      const locks = Object.getOwnPropertyDescriptor(
        Navigator.prototype,
        "locks",
      )!;
      delete (Navigator.prototype as { locks?: unknown }).locks;
      try {
        assertEquals("locks" in navigator, false);
        assertEquals(await tryTakeLease("other-tab"), true);
        await save("porch");
        const second = runSync(accountId);
        assertEquals(await settled(second), false);
        assertEquals(liveOnServer(), 1);
        await releaseLease("other-tab");
        await second;
        assertEquals(liveOnServer(), 2);
      } finally {
        Object.defineProperty(Navigator.prototype, "locks", locks);
      }
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - transient network error retains pending pass and retries",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, save, liveOnServer } = await device(
      "retrysync@example.org",
    );
    const originalFetch = globalThis.fetch;
    try {
      await save("first entry offline");
      assertEquals(liveOnServer(), 0);

      // Make network throw transient error
      globalThis.fetch = () => Promise.reject(new TypeError("offline"));
      await runSync(accountId).catch(() => {});
      assertEquals(liveOnServer(), 0);

      // Restore network and trigger sync - queued mutation is pushed successfully
      globalThis.fetch = originalFetch;
      await runSync(accountId);
      assertEquals(liveOnServer(), 1);
    } finally {
      globalThis.fetch = originalFetch;
      clearSyncRetry();
      restoreFetch();
    }
  },
});

Deno.test({
  name: "sync - a 401 stops the cycle: no retry, the outbox kept",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId, save, liveOnServer } =
      await device("signedout@example.org");
    const shim = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      requests++;
      return shim(...args);
    }) as typeof fetch;
    try {
      await save("before the session ended");
      server.db.prepare("DELETE FROM sessions").run();
      const err = await runSync(accountId).then(() => null, (e) => e);
      assert(err instanceof ApiErrorResponse && err.status === 401, `${err}`);

      // The first retry would come after 1 s
      const after = requests;
      await new Promise((r) => setTimeout(r, 1500));
      assertEquals(requests, after, "a retry after the 401");
      assertEquals((await getOutboxItems()).length, 1);
      assertEquals(liveOnServer(), 0);
    } finally {
      globalThis.fetch = shim;
      clearSyncRetry();
      restoreFetch();
    }
  },
});
