// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals } from "@std/assert";
import { loadConfig } from "../config.ts";
import { mailTest, SAMPLE_CODE } from "./mailtest.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

/** A minimal SMTP server on 127.0.0.1; `rcpt` is its answer to RCPT TO. */
function fakeSmtp(rcpt = "250 OK") {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  const messages: string[] = [];
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
        else if (line.startsWith("RCPT")) await say(rcpt);
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
    for await (const conn of listener) serve(conn).catch(() => {});
  })().catch(() => {});

  return { port, messages, close: () => listener.close() };
}

const config = (port: number, host = "127.0.0.1") =>
  loadConfig({
    BASE_URL: "https://emo.example.org",
    SMTP_HOST: host,
    SMTP_PORT: String(port),
    SMTP_FROM: "Emo <emo@example.org>",
  });

Deno.test({
  name: "mail-test - the sample sign-in mail goes out and is reported",
  ...opts,
  fn: async () => {
    const server = fakeSmtp();
    try {
      const r = await mailTest(config(server.port), "op@example.org", 2000);
      assert(r.ok, r.lines.join("\n"));
      assert(r.lines[0].includes("accepted"));
      assertEquals(server.messages.length, 1);
      assert(server.messages[0].includes("To: op@example.org"));
      assert(server.messages[0].includes(SAMPLE_CODE));
    } finally {
      server.close();
    }
  },
});

Deno.test({
  name: "mail-test - a port nothing listens on is 'cannot reach'",
  ...opts,
  fn: async () => {
    const closed = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (closed.addr as Deno.NetAddr).port;
    closed.close();
    const r = await mailTest(config(port), "op@example.org", 2000);
    assertEquals(r.ok, false);
    assert(r.lines[0].startsWith("[emo] Cannot reach 127.0.0.1:"));
  },
});

Deno.test({
  name: "mail-test - a refusal by the mail server is told apart",
  ...opts,
  fn: async () => {
    const server = fakeSmtp("550 no such sender");
    try {
      const r = await mailTest(config(server.port), "op@example.org", 2000);
      assertEquals(r.ok, false);
      assert(r.lines[0].includes("did not take the message"), r.lines[0]);
      assert(r.lines[0].includes("550"), r.lines[0]);
      assertEquals(server.messages.length, 0);
    } finally {
      server.close();
    }
  },
});

Deno.test({
  name: "mail-test - without SMTP_HOST it says so",
  ...opts,
  fn: async () => {
    const r = await mailTest(config(587, ""), "op@example.org", 2000);
    assertEquals(r, {
      ok: false,
      lines: ["[emo] SMTP_HOST is not set in .env"],
    });
  },
});
