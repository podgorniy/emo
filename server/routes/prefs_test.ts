// SPDX-License-Identifier: AGPL-3.0-or-later
/** Prefs (api.md §2.7): one opaque blob, last write wins, ≤ 32 KiB. */
import { assertEquals } from "@std/assert";
import { encodeBase64Url } from "../../shared/crypto/encoding.ts";
import { startTestServer, TEST_ORIGIN } from "../testing/harness.ts";

const b64 = (n: number) =>
  encodeBase64Url(crypto.getRandomValues(new Uint8Array(n)));

Deno.test("prefs - round trip, last write wins, over 32 KiB is 413", async () => {
  const server = startTestServer();
  const restore = server.installFetch();
  try {
    await server.signUp("prefs@example.org");
    // Prefs are encrypted under a key version the account has
    await fetch(`${TEST_ORIGIN}/api/keyring/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Emo-Auth": b64(32) },
      body: JSON.stringify({
        key_version: 1,
        kdf: { alg: "argon2id", m_kib: 65536, t: 3, p: 1, salt_b64: b64(16) },
        dek_wrapped_pass: { nonce_b64: b64(12), ct_b64: b64(48) },
        dek_wrapped_recovery: { nonce_b64: b64(12), ct_b64: b64(48) },
      }),
    });
    const put = (ctBytes: number) => {
      const body = { key_version: 1, nonce_b64: b64(12), ct_b64: b64(ctBytes) };
      return fetch(`${TEST_ORIGIN}/api/prefs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((res) => ({ res, body }));
    };
    const get = async () =>
      await (await fetch(`${TEST_ORIGIN}/api/prefs`)).json();

    assertEquals((await fetch(`${TEST_ORIGIN}/api/prefs`)).status, 404);
    const first = await put(300);
    assertEquals(first.res.status, 200);
    const got = await get();
    assertEquals([got.nonce_b64, got.ct_b64], [
      first.body.nonce_b64,
      first.body.ct_b64,
    ]);

    const second = await put(400);
    assertEquals(second.res.status, 200);
    assertEquals((await get()).ct_b64, second.body.ct_b64);

    const big = await put(32 * 1024 + 1);
    assertEquals(big.res.status, 413);
    assertEquals((await get()).ct_b64, second.body.ct_b64);
  } finally {
    restore();
  }
});
