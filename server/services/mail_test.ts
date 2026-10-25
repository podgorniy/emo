// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals } from "@std/assert";
import type { Config } from "../config.ts";
import { createSmtpTransport, mailMode, MailService } from "./mail.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

/** A minimal SMTP server on 127.0.0.1; `silent` accepts TCP but never greets. */
function fakeSmtp(silent = false) {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  const messages: string[] = [];
  const conns: Deno.Conn[] = [];
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function serve(conn: Deno.Conn) {
    const say = (line: string) => conn.write(enc.encode(line + "\r\n"));
    await say("220 fake ESMTP");
    let buf = "";
    let inData = false;
    const chunk = new Uint8Array(4096);
    while (true) {
      const n = await conn.read(chunk).catch(() => null);
      if (n === null) return;
      buf += dec.decode(chunk.subarray(0, n));
      while (true) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) break;
          messages.push(buf.slice(0, end));
          buf = buf.slice(end + 5);
          inData = false;
          await say("250 queued");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl === -1) break;
        const line = buf.slice(0, nl).toUpperCase();
        buf = buf.slice(nl + 2);
        if (line.startsWith("EHLO")) await say("250-fake\r\n250 8BITMIME");
        else if (line.startsWith("DATA")) {
          inData = true;
          await say("354 go ahead");
        } else if (line.startsWith("QUIT")) {
          await say("221 bye");
          conn.close();
          return;
        } else await say("250 OK");
      }
    }
  }

  (async () => {
    for await (const conn of listener) {
      conns.push(conn);
      if (!silent) serve(conn).catch(() => {});
    }
  })().catch(() => {});

  return {
    port,
    messages,
    close() {
      listener.close();
      for (const c of conns) {
        try {
          c.close();
        } catch { /* already closed */ }
      }
    },
  };
}

const smtpConfig = (port: number) => ({
  smtpHost: "127.0.0.1",
  smtpPort: port,
  smtpSecure: false,
  smtpFrom: "Emo <emo@example.org>",
});

Deno.test({
  name: "mail - SMTP transport delivers the message",
  ...opts,
  fn: async () => {
    const server = fakeSmtp();
    try {
      const send = createSmtpTransport(smtpConfig(server.port));
      await send({
        to: "alice@example.org",
        subject: "Your Emo login code: 123456",
        text: "Your login code is: 123456",
      });
      assertEquals(server.messages.length, 1);
      assert(server.messages[0].includes("To: alice@example.org"));
      assert(server.messages[0].includes("Your login code is: 123456"));
    } finally {
      server.close();
    }
  },
});

Deno.test({
  name: "mail - a server that never answers times out",
  ...opts,
  fn: async () => {
    const server = fakeSmtp(true);
    try {
      const send = createSmtpTransport(smtpConfig(server.port), 300);
      const started = Date.now();
      let failed = false;
      try {
        await send({ to: "a@example.org", subject: "s", text: "t" });
      } catch {
        failed = true;
      }
      assert(failed, "send must fail");
      assert(Date.now() - started < 3000, "send must give up at the timeout");
    } finally {
      server.close();
    }
  },
});

Deno.test("mail - a failed send opens the circuit; status reports it", async () => {
  const mail = new MailService(
    {} as Config,
    () => Promise.reject(new Error("connection refused")),
  );
  assertEquals(mail.status(), "ok");
  assertEquals(await mail.sendMail("a@example.org", "s", "t"), false);
  assertEquals(mail.status(), "circuit_open");
  assertEquals(mail.isCircuitOpen().open, true);
  // While open, nothing is attempted
  assertEquals(await mail.sendMail("b@example.org", "s", "t"), false);
});

Deno.test("mail - no transport means unconfigured, and sends fail", async () => {
  const mail = new MailService({ smtpHost: "", devMode: false } as Config);
  assertEquals(mail.status(), "unconfigured");
  assertEquals(await mail.sendMail("a@example.org", "s", "t"), false);
});

Deno.test("mail - the service keeps no copy of what it sent", async () => {
  const mail = new MailService({} as Config, () => Promise.resolve());
  await mail.sendMail("a@example.org", "key", "RECOVERY-KEY-TEXT");
  assert(!JSON.stringify(mail).includes("RECOVERY-KEY-TEXT"));
});

Deno.test("mail - failures and circuit openings feed ops_counters", async () => {
  const names: string[] = [];
  const mail = new MailService(
    { smtpHost: "smtp.example", baseUrl: "https://emo.example" } as Config,
    () => Promise.reject(new Error("connection refused")),
  );
  mail.onCounter = (name) => names.push(name);
  assertEquals(await mail.sendMail("a@example.org", "s", "t"), false);
  // The circuit is open now: the next send is refused without a new failure
  assertEquals(await mail.sendMail("a@example.org", "s", "t"), false);
  mail.recordFailure();
  assertEquals(names, ["mail_failed", "mail_circuit_open", "mail_failed"]);
});

Deno.test("mail - make dev prints mail unless DEV_MAIL=smtp asks for SMTP", () => {
  const mode = (c: Partial<Config>) =>
    mailMode(
      { smtpHost: "", devMode: false, devMailSmtp: false, ...c } as Config,
    );
  assertEquals(mode({ smtpHost: "smtp.example.org" }), "smtp");
  assertEquals(mode({}), "off");
  // DEV_MODE with a real SMTP_HOST in .env: still the terminal
  assertEquals(mode({ devMode: true, smtpHost: "smtp.example.org" }), "stderr");
  assertEquals(
    mode({ devMode: true, smtpHost: "smtp.example.org", devMailSmtp: true }),
    "smtp",
  );
  // DEV_MAIL=smtp without SMTP_HOST has nowhere to send: the terminal
  assertEquals(mode({ devMode: true, devMailSmtp: true }), "stderr");
});
