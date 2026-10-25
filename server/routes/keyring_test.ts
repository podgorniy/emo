// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `PUT /api/keyring/1` (api.md §1.4, §2.3): what is stored is
 * validated, a refused write does not count against the rate limit, and two
 * writers at once get a 409, not a 500.
 */
import { assertEquals } from "@std/assert";
import { encodeBase64Url } from "../../shared/crypto/encoding.ts";
import { startTestServer, TEST_ORIGIN } from "../testing/harness.ts";
import { parseKeyringPut } from "./keyring.ts";

const b64 = (n: number) =>
  encodeBase64Url(crypto.getRandomValues(new Uint8Array(n)));

function body(over: Record<string, unknown> = {}) {
  return {
    key_version: 1,
    kdf: { alg: "argon2id", m_kib: 65536, t: 3, p: 1, salt_b64: b64(16) },
    dek_wrapped_pass: { nonce_b64: b64(12), ct_b64: b64(48) },
    dek_wrapped_recovery: { nonce_b64: b64(12), ct_b64: b64(48) },
    ...over,
  };
}

async function setup() {
  const server = startTestServer();
  const restore = server.installFetch();
  await server.signUp(`keyring-${crypto.randomUUID().slice(0, 8)}@example.org`);
  const proof = b64(32);
  const put = (
    payload: unknown,
    opts: { proof?: string; ifMatch?: string } = {},
  ) =>
    fetch(`${TEST_ORIGIN}/api/keyring/1`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Emo-Auth": opts.proof ?? proof,
        ...(opts.ifMatch ? { "If-Match": opts.ifMatch } : {}),
      },
      body: JSON.stringify(payload),
    });
  const revs = () =>
    (server.db.prepare("SELECT COUNT(*) AS n FROM keyrings").get() as {
      n: number;
    }).n;
  return { server, restore, put, revs };
}

Deno.test("keyring - only well-formed keyrings are stored, unknown fields dropped", () => {
  const ok = parseKeyringPut(body({
    kdf: {
      alg: "argon2id",
      m_kib: 65536,
      t: 3,
      p: 1,
      salt_b64: b64(16),
      extra: "x",
    },
  }));
  if (typeof ok === "string") throw new Error(ok);
  assertEquals(Object.keys(JSON.parse(ok.kdfJson)), [
    "alg",
    "m_kib",
    "t",
    "p",
    "salt_b64",
  ]);
  assertEquals(ok.passBlob.length, 60);

  const kdf = body().kdf;
  for (
    const bad of [
      { kdf: { ...kdf, alg: "scrypt" } },
      { kdf: { ...kdf, m_kib: 1024 } },
      { kdf: { ...kdf, t: 0 } },
      { kdf: { ...kdf, p: 1.5 } },
      { kdf: { ...kdf, salt_b64: b64(15) } },
      { dek_wrapped_pass: { nonce_b64: b64(11), ct_b64: b64(48) } },
      { dek_wrapped_recovery: { nonce_b64: b64(12), ct_b64: b64(47) } },
      { dek_wrapped_pass: { nonce_b64: "*", ct_b64: b64(48) } },
      { kdf: undefined },
    ]
  ) {
    assertEquals(
      typeof parseKeyringPut(body(bad)),
      "string",
      JSON.stringify(bad),
    );
  }
});

Deno.test("keyring - a body over 4 KiB is refused", async () => {
  const { restore, put, revs } = await setup();
  try {
    const res = await put(body({ padding: "x".repeat(4096) }));
    assertEquals(res.status, 413);
    assertEquals(revs(), 0);
    assertEquals((await put(body())).status, 201);
  } finally {
    restore();
  }
});

Deno.test("keyring - refused proofs do not use the write limit", async () => {
  const { restore, put, revs } = await setup();
  try {
    assertEquals((await put(body())).status, 201);
    for (let i = 0; i < 11; i++) {
      const res = await put(body(), { proof: b64(32), ifMatch: '"1"' });
      assertEquals(res.status, 403);
    }
    assertEquals((await put(body(), { ifMatch: '"1"' })).status, 200);
    assertEquals(revs(), 2);
  } finally {
    restore();
  }
});

Deno.test("keyring - two writers at once: one wins, the other gets 409", async () => {
  const { restore, put, revs } = await setup();
  try {
    const first = await Promise.all([put(body()), put(body())]);
    assertEquals(first.map((r) => r.status).sort(), [201, 409]);
    assertEquals(revs(), 1);

    const next = await Promise.all([
      put(body(), { ifMatch: '"1"' }),
      put(body(), { ifMatch: '"1"' }),
    ]);
    assertEquals(next.map((r) => r.status).sort(), [200, 409]);
    assertEquals(revs(), 2);
  } finally {
    restore();
  }
});

Deno.test("keyring - no proof is 403; a stale If-Match is 409; revisions stay", async () => {
  const { server, restore, put } = await setup();
  try {
    const noProof = await fetch(`${TEST_ORIGIN}/api/keyring/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body()),
    });
    assertEquals(noProof.status, 403);
    assertEquals((await noProof.json()).error.code, "auth_proof_invalid");

    assertEquals((await put(body())).status, 201);
    const rev1 = () =>
      server.db.prepare(
        "SELECT kdf_json, dek_wrapped_pass, dek_wrapped_recovery FROM keyrings WHERE rev = 1",
      ).get();
    const before = rev1();
    assertEquals((await put(body(), { ifMatch: '"1"' })).status, 200);
    const stale = await put(body(), { ifMatch: '"1"' });
    assertEquals(stale.status, 409);
    assertEquals((await stale.json()).error.code, "keyring_conflict");
    assertEquals(rev1(), before);
  } finally {
    restore();
  }
});
