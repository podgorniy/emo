// SPDX-License-Identifier: AGPL-3.0-or-later
/** Sign out and the offline session state (reliability.md §1.3–§1.4, §5.2). */
import "fake-indexeddb/auto";
import { assertEquals } from "@std/assert";
import { startTestServer } from "../../../server/testing/harness.ts";
import { apiPutKeyring, setDeviceAccount } from "./api.ts";
import { setupKeyring } from "./crypto.ts";
import {
  getAllEntries,
  getMeta,
  putOutboxItem,
  setMeta,
  wipeLocalDatabase,
} from "./db.ts";
import {
  cachedAccount,
  cachedKeyring,
  checkSession,
  fetchKeyring,
  isSignedOut,
  signOutDevice,
  unsyncedCount,
} from "./session.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

async function device(email: string) {
  await wipeLocalDatabase();
  setDeviceAccount(null);
  const server = startTestServer();
  const restoreFetch = server.installFetch();
  const { accountId } = await server.signUp(email);
  const setup = await setupKeyring(accountId, "a passphrase 1");
  await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
  return { server, restoreFetch, accountId };
}

Deno.test({
  name: "session - the account and keyring are kept for an offline start",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId } = await device(
      "cache@example.org",
    );
    try {
      const check = await checkSession();
      assertEquals(check.state, "ok");
      assertEquals((await cachedAccount())?.id, accountId);
      assertEquals((await fetchKeyring())?.rev, 1);
      assertEquals((await cachedKeyring())?.rev, 1);

      // The session ends on the server: signed out, local data kept
      server.db.prepare("DELETE FROM sessions").run();
      assertEquals((await checkSession()).state, "signed_out");
      assertEquals(await isSignedOut(), true);
      assertEquals((await cachedAccount())?.id, accountId);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name: "session - sign out ends the session and removes everything local",
  ...opts,
  fn: async () => {
    const { restoreFetch } = await device("out@example.org");
    try {
      await checkSession();
      await setMeta("cursor_seq", 7);
      await putOutboxItem({
        id: crypto.randomUUID(),
        key_version: 1,
        nonce_b64: "AA",
        ct_b64: "AA",
        attempt_count: 0,
        created_at: new Date().toISOString(),
      });
      localStorage.setItem("emo-theme-preset", "night");
      assertEquals(await unsyncedCount(), 1);

      await signOutDevice();
      assertEquals((await checkSession()).state, "signed_out"); // the cookie no longer works
      assertEquals(await getMeta("cursor_seq"), null);
      assertEquals(await cachedAccount(), null);
      assertEquals((await getAllEntries()).length, 0);
      assertEquals(await unsyncedCount(), 0);
      assertEquals(localStorage.getItem("emo-theme-preset"), null);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "session - a session of another account is never adopted (reliability.md §1.3)",
  ...opts,
  fn: async () => {
    const { server, restoreFetch, accountId } = await device("a@example.org");
    try {
      assertEquals((await checkSession()).state, "ok");
      // A sign-in this device refused: the cookie is b's, the data a's
      const { accountId: b } = await server.signUp("b@example.org");

      // Every request says whose data this is; the server refuses b's session
      assertEquals((await checkSession()).state, "signed_out");
      assertEquals((await cachedAccount())?.id, accountId);
      assertEquals(await isSignedOut(), true);
      assertEquals(
        server.db.prepare(
          "SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?",
        )
          .get(b),
        { n: 1 },
      );

      // Without the header too: b's account is not taken over, its session ends
      setDeviceAccount(null);
      assertEquals((await checkSession()).state, "signed_out");
      assertEquals((await cachedAccount())?.id, accountId);
      assertEquals(
        server.db.prepare(
          "SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?",
        )
          .get(b),
        { n: 0 },
      );
    } finally {
      restoreFetch();
    }
  },
});
