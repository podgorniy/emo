// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The bundle a device exports opens with `emo decrypt-bundle` (the same
 * shared code, offline), and the readable files carry every entry.
 */
import "fake-indexeddb/auto";
import { assert, assertEquals } from "@std/assert";
import { startTestServer } from "../../../server/testing/harness.ts";
import { decryptBundle } from "../../../server/cli/decrypt_bundle.ts";
import { apiPutKeyring } from "./api.ts";
import { setupKeyring } from "./crypto.ts";
import { evictSyncedEntries, wipeLocalDatabase } from "./db.ts";
import { runSync } from "./sync.ts";
import * as m from "./machine.ts";
import { openCheckIn, saveCheckIn, stopCheckIn } from "./checkin.ts";
import { buildBundle, decryptedEntries } from "./export.ts";
import { rememberUploadedKeyring } from "./session.ts";

Deno.test({
  name: "export - the device's bundle opens offline with the passphrase",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    const server = startTestServer();
    const restoreFetch = server.installFetch();
    try {
      const { accountId } = await server.signUp("export@example.org");
      const setup = await setupKeyring(accountId, "export passphrase 1");
      const up = await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
      await rememberUploadedKeyring(setup.keyringPut, up.rev);

      let d = await openCheckIn(accountId, 1, "manual", null);
      d = m.toggleContext(
        m.toggleQuality(m.toggleLocation(d, "belly", 1), "warmth", 1),
        "home",
        1,
      );
      d = m.setNote(d, "кава, балкон", 2);
      const saved = await saveCheckIn(accountId, 1, d, null);
      const skipped = await stopCheckIn(
        accountId,
        1,
        await openCheckIn(accountId, 1, "manual", null),
      );

      const local = await decryptedEntries(accountId);
      assertEquals(local.unreadable, 0);
      assertEquals(
        local.entries.map((e) => e.id).sort(),
        [saved.id, skipped.id].sort(),
      );

      const bundle = JSON.parse(JSON.stringify(await buildBundle(accountId)));
      assertEquals(bundle.format, "emo-bundle");
      assert(
        !JSON.stringify(bundle).includes("export@example.org"),
        "no email in the bundle",
      );
      const opened = await decryptBundle(bundle, {
        passphrase: "export passphrase 1",
      });
      assertEquals(opened.undecryptable, 0);
      assertEquals(
        opened.entries.find((e) => e.id === saved.id)?.note,
        "кава, балкон",
      );
      const byKey = await decryptBundle(bundle, {
        recoveryKey: setup.recoveryKeyFormatted,
      });
      assertEquals(byKey.entries.length, 2);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "export - check-ins this device evicted come from the server; offline it says some are missing",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    const server = startTestServer();
    const restoreFetch = server.installFetch();
    try {
      const { accountId } = await server.signUp("evicted@example.org");
      const setup = await setupKeyring(accountId, "export passphrase 1");
      const up = await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
      await rememberUploadedKeyring(setup.keyringPut, up.rev);

      const ids: string[] = [];
      for (const zone of ["belly", "chest", "throat"]) {
        const d = await openCheckIn(accountId, 1, "manual", null);
        ids.push(
          (await stopCheckIn(
            accountId,
            1,
            m.next(m.toggleLocation(d, zone, 1), 1),
          ))
            .id,
        );
      }
      await runSync(accountId);
      // A full disk: only the newest stays here
      assertEquals(await evictSyncedEntries(1), 2);

      const all = await decryptedEntries(accountId);
      assertEquals(all.partial, false);
      assertEquals(all.entries.map((e) => e.id).sort(), [...ids].sort());
      const bundle = await buildBundle(accountId);
      assertEquals(bundle.entries.length, 3);

      // Offline: what is here, and the export says older ones are missing
      restoreFetch();
      globalThis.fetch = () => Promise.reject(new TypeError("offline"));
      const offline = await decryptedEntries(accountId);
      assertEquals(offline.partial, true);
      assertEquals(offline.entries.length, 1);
    } finally {
      restoreFetch();
    }
  },
});
