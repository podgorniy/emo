// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `POST /api/account/recovery-mail` (reliability.md §1.7, api.md §1.3): 3 a day
 * per account, counted in `mail_log`; neither a bad request
 * nor a failed send uses one of them.
 */
import { assertEquals } from "@std/assert";
import { generateRecoveryKey } from "../../shared/crypto/recovery.ts";
import { encodeBase64Url } from "../../shared/crypto/encoding.ts";
import { setLogSink } from "../log.ts";
import { startTestServer, TEST_ORIGIN } from "../testing/harness.ts";

const HOUR = 3600_000;

async function setup() {
  const server = startTestServer();
  const restore = server.installFetch();
  const { accountId } = await server.signUp(
    `recovery-${crypto.randomUUID().slice(0, 8)}@example.org`,
  );
  const { formatted } = await generateRecoveryKey();
  const send = (body: unknown = { recovery_key: formatted }) =>
    fetch(`${TEST_ORIGIN}/api/account/recovery-mail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const logged = () =>
    (server.db.prepare("SELECT COUNT(*) AS n FROM mail_log").get() as {
      n: number;
    }).n;
  return { server, restore, accountId, send, logged };
}

Deno.test("recovery mail - bad requests and failed sends use no slot", async () => {
  const { server, restore, send, logged } = await setup();
  try {
    for (let i = 0; i < 3; i++) {
      assertEquals((await send({ recovery_key: "nonsense" })).status, 400);
    }
    server.setMail("failing");
    assertEquals((await send()).status, 503);
    assertEquals(logged(), 0);

    server.setMail("ok");
    for (let i = 0; i < 3; i++) assertEquals((await send()).status, 202);
    assertEquals(logged(), 3);
    assertEquals((await send()).status, 429);
  } finally {
    restore();
  }
});

Deno.test("recovery mail - the limit is read from mail_log, with Retry-After", async () => {
  const { server, restore, accountId, send } = await setup();
  try {
    const insert = server.db.prepare(
      "INSERT INTO mail_log (account_id, kind, sent_at) VALUES (?, 'recovery', ?)",
    );
    const now = Date.now();
    insert.run(accountId, new Date(now - 25 * HOUR).toISOString()); // expired
    insert.run(accountId, new Date(now - 20 * HOUR).toISOString());
    insert.run(accountId, new Date(now - 10 * HOUR).toISOString());
    assertEquals((await send()).status, 202); // the third in 24 h

    const res = await send();
    assertEquals(res.status, 429);
    const retry = Number(res.headers.get("Retry-After"));
    // The oldest of the three leaves the window in 4 h
    assertEquals(Math.abs(retry - 4 * 3600) <= 5, true, String(retry));
  } finally {
    restore();
  }
});

Deno.test("recovery mail - needs a session; the key is mailed, never kept or logged", async () => {
  const server = startTestServer();
  const { formatted } = await generateRecoveryKey();
  const anonymous = await server.app.request("/api/account/recovery-mail", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
    body: JSON.stringify({ recovery_key: formatted }),
  }, server.peer);
  assertEquals(anonymous.status, 401);

  const restore = server.installFetch();
  const lines: string[] = [];
  const restoreLog = setLogSink((l) => lines.push(l));
  try {
    await server.signUp("keymail@example.org");
    const res = await fetch(`${TEST_ORIGIN}/api/account/recovery-mail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recovery_key: formatted }),
    });
    assertEquals(res.status, 202);
    const mail = server.mail.at(-1)!;
    assertEquals(mail.text.includes(formatted), true);
    // No links in the mail (copy.md §2.1)
    assertEquals(/https?:\/\/|www\./i.test(mail.text), false);

    const bare = formatted.replaceAll("-", "");
    for (
      const { name } of server.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).all() as Array<{ name: string }>
    ) {
      for (const row of server.db.prepare(`SELECT * FROM "${name}"`).all()) {
        for (const value of Object.values(row as Record<string, unknown>)) {
          const text = value instanceof Uint8Array
            ? new TextDecoder().decode(value)
            : String(value);
          assertEquals(
            text.includes(bare) || text.includes(formatted),
            false,
            `the key is stored in ${name}`,
          );
        }
      }
    }
    assertEquals(
      lines.some((l) => l.includes(bare) || l.includes(formatted)),
      false,
    );
  } finally {
    restoreLog();
    restore();
  }
});

Deno.test("account - DELETE without the proof, or with a wrong one, is 403", async () => {
  const server = startTestServer();
  const restore = server.installFetch();
  try {
    const { accountId } = await server.signUp("keep-me@example.org");
    const b64 = (n: number) =>
      encodeBase64Url(crypto.getRandomValues(new Uint8Array(n)));
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
    for (
      const headers of [{}, { "X-Emo-Auth": b64(32) }] as Record<
        string,
        string
      >[]
    ) {
      const res = await fetch(`${TEST_ORIGIN}/api/account`, {
        method: "DELETE",
        headers,
      });
      assertEquals(res.status, 403);
      assertEquals((await res.json()).error.code, "auth_proof_invalid");
    }
    assertEquals(
      server.db.prepare("SELECT id FROM accounts WHERE id = ?").get(
        accountId,
      ) !==
        undefined,
      true,
    );
  } finally {
    restore();
  }
});
