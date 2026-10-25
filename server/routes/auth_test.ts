// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `POST /api/auth/verify` (api.md §2.1): every rejection of a code is
 * byte-identical, a single-use invite is used once, and concurrent verifies
 * neither double-spend a code nor fail with a 500. `REGISTRATION=open` (the
 * default) makes an account for any address, an invite counted when usable;
 * `invite` only with one.
 */
import { assertEquals } from "@std/assert";
import type { Config } from "../config.ts";
import { hashInviteCode } from "../crypto.ts";
import { startTestServer, TEST_ORIGIN } from "../testing/harness.ts";

const json = { "Content-Type": "application/json", Origin: TEST_ORIGIN };

function setup(registration: Config["registration"] = "open") {
  const server = startTestServer({ registration });
  const post = (path: string, body: unknown) =>
    server.app.request(path, {
      method: "POST",
      headers: json,
      body: JSON.stringify(body),
    }, server.peer);
  const addInvite = async (code: string, maxUses = 1) => {
    server.db.prepare(`
      INSERT INTO invites (code_hash, code_enc, created_by, created_at, expires_at, max_uses, uses)
      VALUES (?, x'01', NULL, ?, ?, ?, 0)
    `).run(
      await hashInviteCode(code),
      new Date().toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
      maxUses,
    );
  };
  /** Requests a code (with an invite for a new email) and returns it. */
  /** Requests a code and returns the one in the mail this request sent. */
  const requestCode = async (email: string, invite?: string) => {
    const before = server.mail.filter((m) => m.to === email).length;
    const res = await post("/api/auth/request-code", {
      email,
      invite_code: invite,
      locale: "en",
    });
    assertEquals(res.status, 202);
    for (let i = 0; i < 50; i++) {
      const sent = server.mail.filter((m) => m.to === email);
      const code = sent.length > before
        ? sent.at(-1)!.text.match(/\b\d{6}\b/)?.[0]
        : undefined;
      if (code) return code;
      await new Promise((r) => setTimeout(r, 2));
    }
    throw new Error("no code mailed");
  };
  const verify = (email: string, code: string) =>
    post("/api/auth/verify", { email, code, tz: "Europe/Kyiv", locale: "en" });
  return { server, post, addInvite, requestCode, verify };
}

const count = (server: ReturnType<typeof startTestServer>, table: string) =>
  (server.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
    n: number;
  }).n;

Deno.test("verify - invite only: a revoked invite answers exactly like a wrong code", async () => {
  const { server, addInvite, requestCode, verify } = setup("invite");
  await addInvite("REVOKEDINV01");
  const code = await requestCode("revoked@example.org", "REVOKEDINV01");
  server.db.exec("DELETE FROM invites");

  const wrong = await verify(
    "revoked@example.org",
    code === "000000" ? "111111" : "000000",
  );
  const revoked = await verify("revoked@example.org", code);
  assertEquals(revoked.status, wrong.status);
  assertEquals(await revoked.text(), await wrong.text());
});

Deno.test("verify - invite only: two sign-ups at once cannot both use a single-use invite", async () => {
  const { server, addInvite, requestCode, verify } = setup("invite");
  await addInvite("SINGLEUSE001");
  const a = await requestCode("first@example.org", "SINGLEUSE001");
  const b = await requestCode("second@example.org", "SINGLEUSE001");

  const results = await Promise.all([
    verify("first@example.org", a),
    verify("second@example.org", b),
  ]);
  assertEquals(results.map((r) => r.status).sort(), [200, 409]);
  const { uses, code_enc } = server.db.prepare(
    "SELECT uses, code_enc FROM invites",
  ).get() as { uses: number; code_enc: Uint8Array | null };
  assertEquals(uses, 1);
  // Spent: the readable copy of the code is gone (architecture.md §6.1)
  assertEquals(code_enc, null);
  const { n } = server.db.prepare("SELECT COUNT(*) AS n FROM accounts")
    .get() as {
      n: number;
    };
  assertEquals(n, 1);
});

Deno.test("request-code - invite only: a new address without an invite is mailed nothing", async () => {
  const { server, post, verify } = setup("invite");
  const res = await post("/api/auth/request-code", {
    email: "nobody@example.org",
    locale: "en",
  });
  assertEquals(res.status, 202);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(server.mail.length, 0);
  assertEquals((await verify("nobody@example.org", "123456")).status, 400);
});

Deno.test("verify - open: a new address without an invite gets an account", async () => {
  const { server, requestCode, verify } = setup();
  const code = await requestCode("anyone@example.org");
  const res = await verify("anyone@example.org", code);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).account.created, true);
  assertEquals(count(server, "accounts"), 1);
  assertEquals(count(server, "invite_uses"), 0);
});

Deno.test("verify - open: a usable invite is counted for whoever shared it", async () => {
  const { server, addInvite, requestCode, verify } = setup();
  await addInvite("OPENINVITE01");
  const code = await requestCode("invited@example.org", "OPENINVITE01");
  assertEquals((await verify("invited@example.org", code)).status, 200);
  const { uses, code_enc } = server.db.prepare(
    "SELECT uses, code_enc FROM invites",
  ).get() as { uses: number; code_enc: Uint8Array | null };
  assertEquals(uses, 1);
  assertEquals(code_enc, null);
  assertEquals(count(server, "invite_uses"), 1);
});

Deno.test("verify - open: a mistyped or revoked invite never stops a sign-up", async () => {
  const { server, addInvite, requestCode, verify } = setup();
  const typo = await requestCode("typo@example.org", "NOSUCHCODE01");
  assertEquals((await verify("typo@example.org", typo)).status, 200);

  await addInvite("REVOKEDINV02");
  const code = await requestCode("revoked2@example.org", "REVOKEDINV02");
  server.db.exec("DELETE FROM invites");
  assertEquals((await verify("revoked2@example.org", code)).status, 200);
  assertEquals(count(server, "accounts"), 2);
  assertEquals(count(server, "invite_uses"), 0);
});

Deno.test("verify - open: two sign-ups at once with a single-use invite both join, one counted", async () => {
  const { server, addInvite, requestCode, verify } = setup();
  await addInvite("SINGLEUSE002");
  const a = await requestCode("first2@example.org", "SINGLEUSE002");
  const b = await requestCode("second2@example.org", "SINGLEUSE002");

  const results = await Promise.all([
    verify("first2@example.org", a),
    verify("second2@example.org", b),
  ]);
  assertEquals(results.map((r) => r.status), [200, 200]);
  const { uses } = server.db.prepare("SELECT uses FROM invites").get() as {
    uses: number;
  };
  assertEquals(uses, 1);
  assertEquals(count(server, "invite_uses"), 1);
  assertEquals(count(server, "accounts"), 2);
});

Deno.test("verify - the same code sent twice at once: one session, no 500", async () => {
  const { server, addInvite, requestCode, verify } = setup();
  await addInvite("DOUBLETAP001");
  const code = await requestCode("double@example.org", "DOUBLETAP001");

  const results = await Promise.all([
    verify("double@example.org", code),
    verify("double@example.org", code),
  ]);
  assertEquals(results.map((r) => r.status).sort(), [200, 400]);
  const count = (table: string) =>
    (server.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    }).n;
  assertEquals(count("accounts"), 1);
  assertEquals(count("sessions"), 1);
});

Deno.test("request-code - a code whose mail failed is deleted", async () => {
  const { server, addInvite } = setup();
  await addInvite("MAILFAILS001");
  server.setMail("failing");
  const res = await server.app.request("/api/auth/request-code", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      email: "nomail@example.org",
      invite_code: "MAILFAILS001",
      locale: "en",
    }),
  }, server.peer);
  assertEquals(res.status, 202);
  const count = () =>
    (server.db.prepare("SELECT COUNT(*) AS n FROM login_codes").get() as {
      n: number;
    }).n;
  for (let i = 0; i < 50 && count() > 0; i++) {
    await new Promise((r) => setTimeout(r, 2));
  }
  assertEquals(count(), 0);
});

// --- development.md §5.1, reliability.md §6: the rest of the auth rules ------

Deno.test("verify - an expired code is refused", async () => {
  const { server, addInvite, requestCode, verify } = setup();
  await addInvite("EXPIREDCODE1");
  const code = await requestCode("expired@example.org", "EXPIREDCODE1");
  server.db.prepare("UPDATE login_codes SET expires_at = ?").run(
    new Date(Date.now() - 1000).toISOString(),
  );
  const res = await verify("expired@example.org", code);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "code_invalid");
});

Deno.test("verify - the 5th wrong attempt spends the code", async () => {
  const { server, addInvite, requestCode, verify } = setup();
  await addInvite("FIVETRIES001");
  const email = "fivetries@example.org";
  const code = await requestCode(email, "FIVETRIES001");
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) {
    assertEquals((await verify(email, wrong)).status, 400);
  }
  assertEquals(
    (server.db.prepare("SELECT COUNT(*) AS n FROM login_codes").get() as {
      n: number;
    }).n,
    0,
  );
  assertEquals((await verify(email, code)).status, 400);
});

Deno.test("request-code - a new code replaces the old one", async () => {
  const { addInvite, requestCode, verify } = setup();
  await addInvite("NEWCODE00001");
  const email = "newcode@example.org";
  const first = await requestCode(email, "NEWCODE00001");
  let second = first;
  // Codes are random; in the rare case of a repeat, ask once more
  for (let i = 0; i < 3 && second === first; i++) {
    second = await requestCode(email, "NEWCODE00001");
  }
  assertEquals((await verify(email, first)).status, 400);
  assertEquals((await verify(email, second)).status, 200);
});

Deno.test("verify - the 11th failure in a day is 429, for unknown emails too", async () => {
  const { verify } = setup();
  const email = "nobody-here@example.org";
  for (let i = 0; i < 10; i++) {
    const res = await verify(email, "123456");
    assertEquals(res.status, 400);
    await res.body?.cancel();
  }
  const res = await verify(email, "123456");
  assertEquals(res.status, 429);
  assertEquals(Number(res.headers.get("Retry-After")) > 0, true);
  assertEquals((await res.json()).error.code, "rate_limited");
});

Deno.test("request-code - answers before the mail is sent", async () => {
  const { server } = setup();
  server.setMail("hanging");
  const res = await Promise.race([
    server.app.request("/api/auth/request-code", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "slow-smtp@example.org", locale: "en" }),
    }, server.peer),
    new Promise<null>((r) => setTimeout(() => r(null), 1000)),
  ]);
  assertEquals(res?.status, 202);
});

Deno.test("request-code - an open mail circuit is 503 for every address", async () => {
  const { server, addInvite } = setup();
  await addInvite("CIRCUIT00001");
  server.setMail("failing");
  const ask = (email: string, invite?: string) =>
    server.app.request("/api/auth/request-code", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email, invite_code: invite, locale: "en" }),
    }, server.peer);
  assertEquals(
    (await ask("first-fail@example.org", "CIRCUIT00001")).status,
    202,
  );
  // The background send fails and opens the circuit
  for (let i = 0; i < 50 && server.mailStatus() !== "circuit_open"; i++) {
    await new Promise((r) => setTimeout(r, 2));
  }
  const res = await ask("someone-else@example.org");
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error.code, "mail_unavailable");
  assertEquals(Number(res.headers.get("Retry-After")) > 0, true);
  server.setMail("ok");
});

Deno.test("request-code - with no language named, the mail is in DEFAULT_LOCALE", async () => {
  const prev = Deno.env.get("DEFAULT_LOCALE");
  // The harness builds its config from the environment at start
  Deno.env.set("DEFAULT_LOCALE", "uk");
  try {
    const s2 = startTestServer();
    s2.db.prepare(`
      INSERT INTO invites (code_hash, code_enc, created_by, created_at, expires_at, max_uses, uses)
      VALUES (?, NULL, NULL, ?, ?, 1, 0)
    `).run(
      await hashInviteCode("DEFAULTLANG2"),
      new Date().toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
    );
    const res = await s2.app.request("/api/auth/request-code", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        email: "default-lang@example.org",
        invite_code: "DEFAULTLANG2",
      }),
    }, s2.peer);
    assertEquals(res.status, 202);
    for (let i = 0; i < 50 && !s2.mail.length; i++) {
      await new Promise((r) => setTimeout(r, 2));
    }
    // The Ukrainian subject, not the English one
    assertEquals(
      /[А-Яа-яІіЇїЄєҐґ]/.test(s2.mail[0].subject),
      true,
      s2.mail[0].subject,
    );
  } finally {
    if (prev === undefined) Deno.env.delete("DEFAULT_LOCALE");
    else Deno.env.set("DEFAULT_LOCALE", prev);
  }
});

Deno.test("verify - an account keeps at most 20 sessions; the least recently used go", async () => {
  const { server, addInvite, requestCode, verify } = setup();
  await addInvite("SESSIONCAP01");
  const email = "many-devices@example.org";
  assertEquals(
    (await verify(email, await requestCode(email, "SESSIONCAP01"))).status,
    200,
  );
  const { id: accountId } = server.db.prepare("SELECT id FROM accounts")
    .get() as { id: string };
  // 20 older devices; the one signed in above is the newest
  const insert = server.db.prepare(`
    INSERT INTO sessions (id, token_hash, account_id, user_agent, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, 'old device', ?, ?, '2099-01-01T00:00:00.000Z')
  `);
  for (let i = 0; i < 20; i++) {
    const at = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    insert.run(`old-${i}`, `hash-${i}`, accountId, at, at);
  }
  // One more sign-in: 22 would be over the cap
  assertEquals((await verify(email, await requestCode(email))).status, 200);
  const ids = (server.db.prepare(
    "SELECT id FROM sessions WHERE account_id = ? ORDER BY last_seen_at",
  ).all(accountId) as Array<{ id: string }>).map((r) => r.id);
  assertEquals(ids.length, 20);
  // old-0 and old-1 (least recently used) are gone
  assertEquals(ids.includes("old-0") || ids.includes("old-1"), false);
  assertEquals(ids.includes("old-2"), true);
});

Deno.test("auth - a session of another account than X-Emo-Account is refused, logout is not", async () => {
  const server = startTestServer();
  const restoreFetch = server.installFetch();
  try {
    const { accountId: a } = await server.signUp("a@example.org");
    // The jar now holds b's session, as after a sign-in refused on a's device
    const { accountId: b } = await server.signUp("b@example.org");
    const session = (claimed?: string) =>
      fetch("/api/session", {
        headers: claimed ? { "X-Emo-Account": claimed } : {},
      });

    assertEquals((await session()).status, 200);
    assertEquals((await session(b)).status, 200);
    const refused = await session(a);
    assertEquals(refused.status, 401);
    assertEquals((await refused.json()).error.code, "unauthenticated");
    // The session itself is untouched: b can still be chosen
    assertEquals((await session(b)).status, 200);

    // a's device can end it
    const out = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "X-Emo-Account": a },
    });
    assertEquals(out.status, 204);
    assertEquals((await session()).status, 401);
  } finally {
    restoreFetch();
  }
});
