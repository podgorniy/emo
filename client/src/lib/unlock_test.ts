// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Unlocking with the passphrase (reliability.md §1.2), client code against the
 * real server: wrong passphrases and the 30 s wait, a damaged keyring that
 * never reaches the KDF, and the fallback to the revision before a bad write.
 */
import "fake-indexeddb/auto";
import { assertEquals } from "@std/assert";
import { startTestServer } from "../../../server/testing/harness.ts";
import {
  argon2InThisThread,
  setArgon2,
} from "../../../shared/crypto/argon2.ts";
import { apiGetKeyring, apiPutKeyring } from "./api.ts";
import { getCachedDek, lockDevice, setupKeyring } from "./crypto.ts";
import { getMeta, wipeLocalDatabase } from "./db.ts";
import { cachedKeyring, rememberKeyring } from "./session.ts";
import { RETRY_DELAY_MS, unlockDevice } from "./unlock.ts";
import { FALLBACK_KEY, resaveKeyring } from "./keyring.ts";
import type { DiagRecord } from "./diag.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const PASS = "right passphrase 1";

async function registered() {
  await wipeLocalDatabase();
  const server = startTestServer();
  const restoreFetch = server.installFetch();
  const { accountId } = await server.signUp(
    `unlock-${crypto.randomUUID().slice(0, 8)}@example.org`,
  );
  const setup = await setupKeyring(accountId, PASS);
  await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
  await lockDevice();
  const rev1 = (await apiGetKeyring()).items[0];
  await rememberKeyring(rev1);
  return { server, restoreFetch, accountId, rev1 };
}

Deno.test({
  name: "unlock - 5 wrong passphrases, then a 30 s wait per try",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await registered();
    try {
      const t0 = Date.now();
      for (let i = 0; i < 5; i++) {
        assertEquals(await unlockDevice(accountId, "wrong one", t0), {
          kind: "wrong",
        });
      }
      assertEquals(await unlockDevice(accountId, PASS, t0 + 1000), {
        kind: "wait",
        seconds: 29,
      });
      assertEquals(getCachedDek(), null);
      const later = t0 + RETRY_DELAY_MS + 1;
      assertEquals(await unlockDevice(accountId, PASS, later), { kind: "ok" });
      assertEquals(await getMeta("unlock_failures"), null);
    } finally {
      await lockDevice();
      restoreFetch();
    }
  },
});

Deno.test({
  name: "unlock - a bad newest revision falls back to the one before",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId } = await registered();
    try {
      // Another device wrote rev 2 with the same KDF but a broken wrap
      server.db.exec(`
        INSERT INTO keyrings (account_id, key_version, rev, kdf_json, dek_wrapped_pass, dek_wrapped_recovery, auth_hash, created_at)
        SELECT account_id, key_version, 2, kdf_json, randomblob(60), dek_wrapped_recovery, auth_hash, created_at
        FROM keyrings WHERE rev = 1
      `);
      const rev2 = (await apiGetKeyring()).items[0];
      assertEquals(rev2.rev, 2);
      await rememberKeyring(rev2);

      assertEquals(await unlockDevice(accountId, PASS), { kind: "ok" });
      assertEquals((await cachedKeyring())?.rev, 1);
      const diag = (await getMeta<DiagRecord[]>("diag")) ?? [];
      assertEquals(diag.some((d) => d.code === "keyring.rev_fallback"), true);
      assertEquals(await getMeta(FALLBACK_KEY), true);

      // "Re-save keys": a fresh rev 3 from the revision that opened here
      await resaveKeyring(accountId, PASS);
      assertEquals(await getMeta(FALLBACK_KEY), null);
      const newest = (await apiGetKeyring()).items[0];
      assertEquals(newest.rev, 3);
      await lockDevice();
      await rememberKeyring(newest);
      assertEquals(await unlockDevice(accountId, PASS), { kind: "ok" });
      assertEquals((await cachedKeyring())?.rev, 3);
      assertEquals(await getMeta(FALLBACK_KEY), null);
    } finally {
      await lockDevice();
      restoreFetch();
    }
  },
});

Deno.test({
  name: "unlock - a malformed keyring is damaged and never reaches the KDF",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId } = await registered();
    let kdfRuns = 0;
    setArgon2((...args) => {
      kdfRuns++;
      return argon2InThisThread(...args);
    });
    try {
      // A wrap of the wrong length: GET splits it into a 10-byte "nonce"
      server.db.exec("UPDATE keyrings SET dek_wrapped_pass = randomblob(10)");
      const damaged = (await apiGetKeyring()).items[0];
      await rememberKeyring(damaged);

      assertEquals(await unlockDevice(accountId, PASS), { kind: "damaged" });
      assertEquals(kdfRuns, 0);
      // Not a wrong passphrase: no step towards the 30 s wait
      assertEquals(await getMeta("unlock_failures"), null);
    } finally {
      setArgon2(argon2InThisThread);
      restoreFetch();
    }
  },
});

Deno.test({
  name: "unlock - offline, the cached revision still opens",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await registered();
    restoreFetch();
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new TypeError("offline"));
    try {
      assertEquals(await unlockDevice(accountId, "wrong one"), {
        kind: "wrong",
      });
      assertEquals(await unlockDevice(accountId, PASS), { kind: "ok" });
    } finally {
      globalThis.fetch = original;
      await lockDevice();
    }
  },
});
