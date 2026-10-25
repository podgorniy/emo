// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Test harness: the real Hono app on in-memory SQLite, with a recording mail
 * transport, and a `fetch` shim so client modules (`client/src/lib/*`) talk to
 * it exactly as a browser would — relative URLs, session cookie, `Origin`.
 * Test-only; never imported by production code.
 */

import { DatabaseSync } from "node:sqlite";
import { createApp } from "../app.ts";
import type { Config } from "../config.ts";
import { hashInviteCode } from "../crypto.ts";
import { runMigrations } from "../db/index.ts";
import { MailService, type OutgoingMail } from "../services/mail.ts";

export const TEST_ORIGIN = "http://localhost:8080";

export interface TestServer {
  db: DatabaseSync;
  app: ReturnType<typeof createApp>;
  /**
   * The connection info this server's requests carry: one client address per
   * test server, so per-IP rate limits (a process-wide singleton) never leak
   * between tests. Pass it as `app.request(path, init, peer)`.
   */
  peer: Deno.ServeHandlerInfo<Deno.NetAddr>;
  mail: OutgoingMail[];
  /** Routes global `fetch` to the app; returns a function that restores it. */
  installFetch(): () => void;
  /** Invite → request-code → verify through the shim; the jar keeps the cookie. */
  signUp(email: string): Promise<{ accountId: string }>;
  /**
   * SMTP delivers (`ok`, which also closes the mail circuit), refuses every
   * message (`failing`), or never answers (`hanging`).
   */
  setMail(mode: "ok" | "failing" | "hanging"): void;
  /** What `/healthz` would report for mail. */
  mailStatus(): string;
}

let servers = 0;

/** `config`: settings over the test defaults (`registration`, …). */
export function startTestServer(config: Partial<Config> = {}): TestServer {
  servers++;
  const peer = {
    remoteAddr: {
      transport: "tcp",
      // 198.18.0.0/15: a benchmarking range, never a trusted proxy
      hostname: `198.18.${(servers >> 8) & 255}.${servers & 255}`,
      port: 40000,
    },
    completed: Promise.resolve(),
  } as Deno.ServeHandlerInfo<Deno.NetAddr>;
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const mail: OutgoingMail[] = [];
  let mailMode: "ok" | "failing" | "hanging" = "ok";
  const mailService = new MailService({} as Config, (m) => {
    if (mailMode === "failing") {
      return Promise.reject(new Error("connection refused"));
    }
    if (mailMode === "hanging") return new Promise<void>(() => {});
    mail.push(m);
    return Promise.resolve();
  });
  const app = createApp(db, {
    serverSecret: "a3f1".repeat(16),
    baseUrl: TEST_ORIGIN,
    invitesByUsers: true,
    invitesPerUser: 5,
    recoveryMailEnabled: true,
    ...config,
  }, { mailService });

  let cookie: string | null = null;

  const shim = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const headers = new Headers(init.headers);
    headers.set("Origin", TEST_ORIGIN);
    if (cookie) headers.set("Cookie", cookie);
    const res = await app.request(url, { ...init, headers }, peer);
    const setCookie = res.headers.get("set-cookie");
    const m = setCookie?.match(/emo_session=([^;]*)/);
    if (m) cookie = m[1] ? `emo_session=${m[1]}` : null;
    return res;
  };

  return {
    db,
    app,
    peer,
    mail,
    mailStatus: () => mailService.status(),
    setMail(mode) {
      mailMode = mode;
      if (mode === "ok") mailService.recordSuccess();
    },
    installFetch() {
      const original = globalThis.fetch;
      globalThis.fetch = shim as typeof fetch;
      return () => {
        globalThis.fetch = original;
      };
    },
    async signUp(email) {
      const invite = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        .toUpperCase();
      db.prepare(
        `INSERT INTO invites (code_hash, code_enc, created_by, created_at, expires_at, max_uses, uses)
         VALUES (?, NULL, NULL, ?, ?, 1, 0)`,
      ).run(
        await hashInviteCode(invite),
        new Date().toISOString(),
        new Date(Date.now() + 86_400_000).toISOString(),
      );
      const json = { "Content-Type": "application/json" };
      const req = await shim("/api/auth/request-code", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ email, invite_code: invite, locale: "en" }),
      });
      if (req.status !== 202) throw new Error(`request-code ${req.status}`);
      // The mail is sent in the background; wait for it.
      for (let i = 0; i < 50 && !mail.some((m) => m.to === email); i++) {
        await new Promise((r) => setTimeout(r, 2));
      }
      const sent = [...mail].reverse().find((m) => m.to === email);
      const code = sent?.text.match(/\b\d{6}\b/)?.[0];
      if (!code) throw new Error("no login code mailed");
      const res = await shim("/api/auth/verify", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ email, code, tz: "Europe/Kyiv", locale: "en" }),
      });
      if (res.status !== 200) throw new Error(`verify ${res.status}`);
      const body = await res.json();
      return { accountId: body.account.id };
    },
  };
}
