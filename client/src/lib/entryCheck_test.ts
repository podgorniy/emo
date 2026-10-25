// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * reliability.md §1.2, data.md §8.1: entries this device holds are decrypted, read and
 * flagged; nothing is dropped; export takes only what it may.
 */
import "fake-indexeddb/auto";
import { assertEquals } from "@std/assert";
import { startTestServer } from "../../../server/testing/harness.ts";
import { encodeBase64Url } from "../../../shared/crypto/encoding.ts";
import type { EntryV2 } from "../../../shared/entry.ts";
import { apiPutKeyring } from "./api.ts";
import { encryptEntryLocally, setupKeyring } from "./crypto.ts";
import {
  getAllEntries,
  getEntry,
  getMeta,
  putEntry,
  setEntryChecks,
  wipeLocalDatabase,
} from "./db.ts";
import { checkEntries } from "./entryCheck.ts";
import { decryptedEntries } from "./export.ts";
import { rememberUploadedKeyring } from "./session.ts";

const fixture: EntryV2 = JSON.parse(
  await Deno.readTextFile(
    new URL("../../../shared/fixtures/entry.v2.json", import.meta.url),
  ),
);

Deno.test({
  name: "entry check - valid, newer, invalid and undecryptable are told apart",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    const server = startTestServer();
    const restoreFetch = server.installFetch();
    try {
      const { accountId } = await server.signUp("checks@example.org");
      const setup = await setupKeyring(accountId, "check passphrase 1");
      const up = await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
      await rememberUploadedKeyring(setup.keyringPut, up.rev);

      const store = async (entry: EntryV2) => {
        const enc = await encryptEntryLocally(entry, accountId, 1);
        await putEntry({
          id: entry.id,
          seq: 0,
          key_version: 1,
          ...enc,
          deleted: false,
          received_at: "2026-10-08T10:00:00.000Z",
        });
      };
      const ids = {
        ok: crypto.randomUUID(),
        newer: crypto.randomUUID(),
        invalid: crypto.randomUUID(),
        broken: crypto.randomUUID(),
      };
      await store({ ...fixture, id: ids.ok });
      await store(
        { ...fixture, id: ids.newer, schema_v: 99 } as unknown as EntryV2,
      );
      await store({ ...fixture, id: ids.invalid, ts: "yesterday" });
      await putEntry({
        id: ids.broken,
        seq: 0,
        key_version: 1,
        nonce_b64: encodeBase64Url(crypto.getRandomValues(new Uint8Array(12))),
        ct_b64: encodeBase64Url(crypto.getRandomValues(new Uint8Array(2064))),
        deleted: false,
        received_at: "2026-10-08T10:00:00.000Z",
      });

      assertEquals(await checkEntries(accountId), {
        undecryptable: 1,
        invalid: 1,
        newer: 1,
      });
      const flags = Object.fromEntries(
        (await getAllEntries()).map((r) => [r.id, r.check]),
      );
      assertEquals(flags, {
        [ids.ok]: "ok",
        [ids.newer]: "newer",
        [ids.invalid]: "invalid",
        [ids.broken]: "undecryptable",
      });
      // Every row is kept, ciphertext and all
      assertEquals((await getAllEntries()).every((r) => r.ct_b64), true);
      assertEquals(await getMeta("needs_newer_app"), 1);

      const exported = await decryptedEntries(accountId);
      assertEquals(exported.entries.map((e) => e.id), [ids.ok]);
      assertEquals(exported.invalid.map((e) => [e.id, e._invalid]), [[
        ids.invalid,
        true,
      ]]);
      assertEquals([exported.newer, exported.unreadable], [1, 1]);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "entry check - one an older build flagged invalid or newer is read again, and shown, under this one",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    const server = startTestServer();
    const restoreFetch = server.installFetch();
    try {
      const { accountId } = await server.signUp("rechecks@example.org");
      const setup = await setupKeyring(accountId, "check passphrase 1");
      const up = await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
      await rememberUploadedKeyring(setup.keyringPut, up.rev);

      // Valid here; an older build (before copy 6) had flagged them
      const ids = [crypto.randomUUID(), crypto.randomUUID()];
      for (const id of ids) {
        const enc = await encryptEntryLocally({ ...fixture, id }, accountId, 1);
        await putEntry({
          id,
          seq: 1,
          key_version: 1,
          ...enc,
          deleted: false,
          received_at: "2026-10-08T10:00:00.000Z",
        });
      }
      const rows = await getAllEntries();
      await setEntryChecks([
        {
          id: ids[0],
          ct_b64: rows.find((r) => r.id === ids[0])!.ct_b64!,
          check: "invalid",
        },
        {
          id: ids[1],
          ct_b64: rows.find((r) => r.id === ids[1])!.ct_b64!,
          check: "newer",
        },
      ]);

      assertEquals(await checkEntries(accountId), {
        undecryptable: 0,
        invalid: 0,
        newer: 0,
      });
      assertEquals((await getEntry(ids[0]))?.check, "ok");
      assertEquals((await getEntry(ids[1]))?.check, "ok");
      assertEquals(await getMeta("invalid_entries"), 0);
      assertEquals(await getMeta("needs_newer_app"), 0);
    } finally {
      restoreFetch();
    }
  },
});
