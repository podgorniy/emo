// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Recovery with the recovery key, client code against the real server
 * (architecture.md §5.3, api.md §2.3).
 */
import "fake-indexeddb/auto";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { startTestServer } from "../../../server/testing/harness.ts";
import { apiGetKeyring, apiPutKeyring } from "./api.ts";
import {
  getCachedDek,
  lockDevice,
  recoverAccount,
  setupKeyring,
  unlockWithRevisions,
} from "./crypto.ts";
import { recoverAndUpload } from "./keyring.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

async function registered(email = "rec@example.org") {
  const server = startTestServer();
  const restoreFetch = server.installFetch();
  const { accountId } = await server.signUp(email);
  const setup = await setupKeyring(accountId, "old passphrase 1");
  await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
  await lockDevice();
  const keyring = (await apiGetKeyring()).items[0];
  return {
    server,
    restoreFetch,
    accountId,
    oldKey: setup.recoveryKeyFormatted,
    keyring,
  };
}

Deno.test({
  name: "keyring - recovery stores a new revision, then shows the new key",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, oldKey, keyring } = await registered();
    try {
      assertEquals(keyring.rev, 1);
      const { newRecoveryKeyFormatted } = await recoverAndUpload(
        accountId,
        oldKey,
        "new passphrase 2",
        keyring,
      );
      assert(getCachedDek(), "device is unlocked after recovery");

      const latest = (await apiGetKeyring()).items[0];
      assertEquals(latest.rev, 2);
      await lockDevice();
      assertEquals(
        (await unlockWithRevisions(accountId, "new passphrase 2", [latest]))
          ?.rev,
        2,
      );
      await lockDevice();
      assertEquals(
        await unlockWithRevisions(accountId, "old passphrase 1", [latest]),
        null,
      );
      // The new key works; the old one no longer unwraps the latest revision
      await recoverAccount(
        accountId,
        newRecoveryKeyFormatted,
        "x".repeat(8),
        latest,
      );
      await assertRejects(() =>
        recoverAccount(accountId, oldKey, "x".repeat(8), latest)
      );
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name: "keyring - a stale revision (409) is re-fetched and retried once",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, oldKey, keyring } = await registered();
    try {
      // Another device changes the passphrase after we fetched rev 1
      const other = await recoverAccount(
        accountId,
        oldKey,
        "other device 3",
        keyring,
      );
      // ...keeping the same recovery wrap, as a passphrase change would
      other.newKeyringPut.dek_wrapped_recovery = keyring.dek_wrapped_recovery;
      await apiPutKeyring(1, other.newKeyringPut, other.authProofB64, 1);

      await recoverAndUpload(accountId, oldKey, "new passphrase 4", keyring);
      assertEquals((await apiGetKeyring()).items[0].rev, 3);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name: "keyring - a wrong recovery key changes nothing anywhere",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, keyring } = await registered();
    try {
      const wrong =
        (await setupKeyring(accountId, "unrelated pass")).recoveryKeyFormatted;
      await lockDevice();
      await assertRejects(() =>
        recoverAndUpload(accountId, wrong, "new passphrase 5", keyring)
      );
      assertEquals(getCachedDek(), null, "device stays locked");
      assertEquals((await apiGetKeyring()).items[0].rev, 1, "server unchanged");
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "keyring - change passphrase keeps the recovery key; a new key keeps the passphrase",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, oldKey } = await registered(
      "change@example.org",
    );
    const { changeKeyring } = await import("./keyring.ts");
    const { unwrapDekWithPassphrase, unwrapDekWithRecoveryKey } = await import(
      "../../../shared/crypto/keyring.ts"
    );
    const latest = async () => (await apiGetKeyring()).items[0];
    try {
      // A wrong current passphrase changes nothing
      await assertRejects(() =>
        changeKeyring(accountId, "not it at all", {
          newPassphrase: "x".repeat(9),
        })
      );

      await changeKeyring(accountId, "old passphrase 1", {
        newPassphrase: "new passphrase 2",
      });
      let k = await latest();
      assertEquals(k.rev, 2);
      await unwrapDekWithPassphrase(k, accountId, "new passphrase 2");
      await assertRejects(() =>
        unwrapDekWithPassphrase(k, accountId, "old passphrase 1")
      );
      await unwrapDekWithRecoveryKey(k, accountId, oldKey);

      const r = await changeKeyring(accountId, "new passphrase 2", {
        newRecoveryKey: true,
      });
      k = await latest();
      assertEquals(k.rev, 3);
      await unwrapDekWithRecoveryKey(k, accountId, r.newRecoveryKeyFormatted!);
      await assertRejects(() => unwrapDekWithRecoveryKey(k, accountId, oldKey));
      await unwrapDekWithPassphrase(k, accountId, "new passphrase 2");
    } finally {
      restoreFetch();
    }
  },
});
