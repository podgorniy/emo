// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Authentication routes: request-code, verify, logout, session.
 * Specification: architecture.md §4.2, §4.3, api.md §2.1.
 */

import { Hono } from "@hono/hono";
import { readJson } from "../http.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.ts";
import {
  encryptServerBlob,
  generateLoginCode,
  generateSessionToken,
  generateUuidV4,
  generateUuidV7,
  hashEmail,
  hashInviteCode,
  hashLoginCode,
  normalizeEmail,
} from "../crypto.ts";
import { rateLimiter } from "../services/rate_limit.ts";
import type { MailService } from "../services/mail.ts";
import {
  type AppEnv,
  type AuthAccount,
  clearSessionCookie,
  createAuthMiddleware,
  createSessionCookie,
} from "../middleware/auth.ts";
import { tx } from "../db/index.ts";
import { logger } from "../log.ts";
import {
  AuthRequestCodeReqSchema,
  type AuthRequestCodeRes,
  AuthVerifyReqSchema,
  type AuthVerifyRes,
  type Locale,
} from "../../shared/protocol.ts";
import {
  decodeHex,
  encodeHex,
  timingSafeEqual,
} from "../../shared/crypto/encoding.ts";
import { clientIp, parseTrustedProxies } from "../client_ip.ts";
import { trackTask } from "../tasks.ts";
import type { ApiError } from "../../shared/protocol.ts";

/**
 * api.md §2.1: every rejected code gets these exact bytes, whatever
 * the reason (wrong, expired, spent, no invite for a new account).
 */
const CODE_INVALID = {
  error: { code: "code_invalid", message: "Invalid or expired login code" },
} as const satisfies ApiError;

type VerifyOutcome =
  | { account: AuthAccount; created: boolean }
  | { error: "code_invalid" | "invite_expired" | "invite_already_used" };

export function createAuthRoutes(
  db: DatabaseSync,
  config: Config,
  mailService: MailService,
) {
  const router = new Hono<AppEnv>();
  // Logout ends a session of any account (reliability.md §1.3: "Back" after
  // another account signed in on a device that holds one)
  const authMiddleware = createAuthMiddleware(db, { anyAccount: true });
  const secretBytes = decodeHex(config.serverSecret);
  const trustProxy = parseTrustedProxies(config.trustedProxies);

  // POST /api/auth/request-code
  router.post("/request-code", async (c) => {
    const circuit = mailService.isCircuitOpen();
    if (circuit.open) {
      c.header("Retry-After", String(circuit.retryAfterSec ?? 300));
      return c.json(
        {
          error: {
            code: "mail_unavailable",
            message: "Email delivery circuit is temporarily open",
            retry_after_sec: circuit.retryAfterSec ?? 300,
          },
        } satisfies ApiError,
        503,
      );
    }

    const body = await readJson(c, AuthRequestCodeReqSchema);
    if (body instanceof Response) return body;

    const email = normalizeEmail(body.email);
    if (!email || !email.includes("@")) {
      return c.json(
        {
          error: { code: "invalid_field", message: "Invalid email" },
        } satisfies ApiError,
        400,
      );
    }

    const ip = clientIp(
      (c.env as Deno.ServeHandlerInfo<Deno.NetAddr> | undefined)?.remoteAddr
        ?.hostname,
      c.req.header("x-forwarded-for"),
      trustProxy,
    );

    // Buckets are keyed by the email HMAC: no address held in memory
    const emailHmac = await hashEmail(secretBytes, email);
    const emailKey = encodeHex(emailHmac);
    const emailRate = rateLimiter.consume(
      `login_req_email:${emailKey}`,
      3,
      15 * 60,
    );
    if (!emailRate.allowed) {
      c.header("Retry-After", String(emailRate.retryAfterSec ?? 900));
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many codes requested for this email",
            retry_after_sec: emailRate.retryAfterSec ?? 900,
          },
        } satisfies ApiError,
        429,
      );
    }

    const ipRate = rateLimiter.consume(`login_req_ip:${ip}`, 10, 60 * 60);
    if (!ipRate.allowed) {
      c.header("Retry-After", String(ipRate.retryAfterSec ?? 3600));
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many requests from this IP",
            retry_after_sec: ipRate.retryAfterSec ?? 3600,
          },
        } satisfies ApiError,
        429,
      );
    }

    const existingAccount = db.prepare(
      "SELECT id, locale FROM accounts WHERE email_hmac = ?",
    ).get(emailHmac) as {
      id: string;
      locale: Locale;
    } | undefined;

    // ops.md §6.3: DEFAULT_LOCALE when neither the account nor the request
    // names a language
    const requestedLocale: Locale = body.locale ?? config.defaultLocale;
    const mailLocale: Locale = existingAccount
      ? existingAccount.locale
      : requestedLocale;

    const isDryRun = c.req.header("X-Emo-Dry-Run") === "1" &&
      email === config.smokeEmail;
    if (isDryRun) {
      const dryCode = "123456";
      mailService.renderLoginCodeMail(dryCode, mailLocale);
      const res: AuthRequestCodeRes = { ok: true, ttl_sec: 600 };
      return c.json(res, 202);
    }

    // A usable invite rides along with a new address's code; an unusable one
    // is left out (REGISTRATION=invite: then nothing is sent)
    let inviteHash: string | null = null;
    if (!existingAccount && body.invite_code) {
      const invHash = await hashInviteCode(body.invite_code);
      const invite = db.prepare(`
        SELECT code_hash, max_uses, uses, expires_at
        FROM invites
        WHERE code_hash = ?
      `).get(invHash) as {
        code_hash: string;
        max_uses: number;
        uses: number;
        expires_at: string;
      } | undefined;

      if (invite) {
        const notExpired = Date.parse(invite.expires_at) > Date.now();
        const notExhausted = invite.uses < invite.max_uses;
        if (notExpired && notExhausted) inviteHash = invHash;
      }
    }
    const shouldSendCode = !!existingAccount || inviteHash !== null ||
      config.registration === "open";

    if (shouldSendCode) {
      const code = generateLoginCode();
      const codeHash = await hashLoginCode(secretBytes, code);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      const nowIso = now.toISOString();
      const codeId = generateUuidV4();

      tx(db, () => {
        db.prepare("DELETE FROM login_codes WHERE email_hmac = ?").run(
          emailHmac,
        );
        db.prepare(`
          INSERT INTO login_codes (id, email_hmac, code_hash, attempts, invite_hash, expires_at, created_at)
          VALUES (?, ?, ?, 0, ?, ?, ?)
        `).run(
          codeId,
          emailHmac,
          codeHash,
          inviteHash,
          expiresAt,
          nowIso,
        );
      });

      // reliability.md §1.7: a code whose mail failed is deleted (only this
      // one: a newer request may have replaced it meanwhile)
      trackTask((async () => {
        let sent = false;
        try {
          const rendered = mailService.renderLoginCodeMail(code, mailLocale);
          sent = await mailService.sendMail(
            email,
            rendered.subject,
            rendered.text,
          );
        } catch (err) {
          logger.error("mail_failed", { err });
          mailService.recordFailure();
        }
        if (!sent) {
          db.prepare("DELETE FROM login_codes WHERE id = ?").run(codeId);
        }
      })());
    }

    const res: AuthRequestCodeRes = { ok: true, ttl_sec: 600 };
    return c.json(res, 202);
  });

  // POST /api/auth/verify
  router.post("/verify", async (c) => {
    const body = await readJson(c, AuthVerifyReqSchema);
    if (body instanceof Response) return body;

    const email = normalizeEmail(body.email);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const tz = typeof body.tz === "string" ? body.tz.trim() : "";
    // Required and checked by AuthVerifyReqSchema
    const locale: Locale = body.locale;

    if (!email || !code || !tz) {
      return c.json(
        {
          error: { code: "invalid_field", message: "Missing required fields" },
        } satisfies ApiError,
        400,
      );
    }

    const ip = clientIp(
      (c.env as Deno.ServeHandlerInfo<Deno.NetAddr> | undefined)?.remoteAddr
        ?.hostname,
      c.req.header("x-forwarded-for"),
      trustProxy,
    );

    const ipRate = rateLimiter.consume(`verify_ip:${ip}`, 30, 15 * 60);
    if (!ipRate.allowed) {
      c.header("Retry-After", String(ipRate.retryAfterSec ?? 900));
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many verify attempts from this IP",
            retry_after_sec: ipRate.retryAfterSec ?? 900,
          },
        } satisfies ApiError,
        429,
      );
    }

    const emailHmac = await hashEmail(secretBytes, email);
    const emailKey = encodeHex(emailHmac);
    const emailFailRate = rateLimiter.check(
      `verify_fail_email:${emailKey}`,
      10,
      24 * 3600,
    );
    if (!emailFailRate.allowed) {
      c.header("Retry-After", String(emailFailRate.retryAfterSec ?? 86400));
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many failed verifications for this email",
            retry_after_sec: emailFailRate.retryAfterSec ?? 86400,
          },
        } satisfies ApiError,
        429,
      );
    }

    const inputCodeHash = await hashLoginCode(secretBytes, code);
    const now = Date.now();

    const verification = tx(db, () => {
      const row = db.prepare(`
        SELECT id, code_hash, attempts, invite_hash, expires_at
        FROM login_codes
        WHERE email_hmac = ?
      `).get(emailHmac) as {
        id: string;
        code_hash: string;
        attempts: number;
        invite_hash: string | null;
        expires_at: string;
      } | undefined;

      if (!row) {
        return { valid: false as const };
      }

      const notExpired = Date.parse(row.expires_at) > now;
      if (!notExpired || row.attempts >= 5) {
        if (row.attempts >= 5) {
          db.prepare("DELETE FROM login_codes WHERE id = ?").run(row.id);
        }
        return { valid: false as const };
      }

      let matches = false;
      try {
        matches = timingSafeEqual(
          decodeHex(row.code_hash),
          decodeHex(inputCodeHash),
        );
      } catch {
        matches = false;
      }

      if (!matches) {
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= 5) {
          db.prepare("DELETE FROM login_codes WHERE id = ?").run(row.id);
        } else {
          db.prepare("UPDATE login_codes SET attempts = ? WHERE id = ?").run(
            nextAttempts,
            row.id,
          );
        }
        return { valid: false as const };
      }

      return { valid: true as const, codeRow: row };
    });

    if (!verification.valid) {
      rateLimiter.consume(`verify_fail_email:${emailKey}`, 10, 24 * 3600);
      return c.json(CODE_INVALID, 400);
    }

    const codeRow = verification.codeRow;

    // Everything async first; the checks and writes below then run in one
    // synchronous transaction, so concurrent verifies cannot interleave (one
    // connection, no await inside): the code is spent once, a single-use
    // invite is used once, and a second verify for a new email finds the
    // account the first one created instead of a UNIQUE violation.
    const emailEnc = await encryptServerBlob(secretBytes, email, "email");
    const { token, tokenHash } = await generateSessionToken();
    const userAgent = (c.req.header("user-agent") || "").slice(0, 256);

    const outcome = tx(db, (): VerifyOutcome => {
      const live = db.prepare("SELECT 1 FROM login_codes WHERE id = ?").get(
        codeRow!.id,
      );
      if (!live) return { error: "code_invalid" };

      const nowIso = new Date().toISOString();
      let account = db.prepare(`
        SELECT id, tz, locale, wake_start, wake_end, reminders_per_day, min_gap_min,
               reminders_paused_until, created_at
        FROM accounts
        WHERE email_hmac = ?
      `).get(emailHmac) as AuthAccount | undefined;
      let created = false;

      if (!account) {
        const invite = codeRow!.invite_hash
          ? db.prepare(`
              SELECT max_uses, uses, expires_at FROM invites WHERE code_hash = ?
            `).get(codeRow!.invite_hash) as {
            max_uses: number;
            uses: number;
            expires_at: string;
          } | undefined
          : undefined;
        const expired = !!invite && Date.parse(invite.expires_at) <= Date.now();
        const spent = !!invite && invite.uses >= invite.max_uses;
        if (config.registration === "invite") {
          // No invite with the code, or it was revoked: the same answer as a
          // wrong code
          if (!invite) return { error: "code_invalid" };
          if (expired) return { error: "invite_expired" };
          if (spent) return { error: "invite_already_used" };
        }
        // Open: the account is made either way; only a usable invite counts
        const inviteUsed = !!invite && !expired && !spent;

        account = {
          id: generateUuidV7(),
          tz,
          locale,
          wake_start: "09:00",
          wake_end: "22:00",
          reminders_per_day: 3,
          min_gap_min: 120,
          reminders_paused_until: null,
          created_at: nowIso,
        };
        db.prepare(`
          INSERT INTO accounts (id, email_enc, email_hmac, tz, locale, wake_start, wake_end, reminders_per_day, min_gap_min, created_at)
          VALUES (?, ?, ?, ?, ?, '09:00', '22:00', 3, 120, ?)
        `).run(account.id, emailEnc, emailHmac, tz, locale, nowIso);
        if (inviteUsed) {
          // The readable copy goes with the last use (architecture.md §6.1)
          db.prepare(`
            UPDATE invites SET uses = uses + 1,
              code_enc = CASE WHEN uses + 1 >= max_uses THEN NULL ELSE code_enc END
            WHERE code_hash = ?
          `).run(codeRow!.invite_hash);
          db.prepare(`
            INSERT INTO invite_uses (code_hash, account_id, used_at)
            VALUES (?, ?, ?)
          `).run(codeRow!.invite_hash, account.id, nowIso);
        }
        created = true;
      }

      db.prepare(`
        INSERT INTO sessions (id, token_hash, account_id, user_agent, created_at, last_seen_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateUuidV4(),
        tokenHash,
        account.id,
        userAgent,
        nowIso,
        nowIso,
        new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      );
      db.prepare("DELETE FROM login_codes WHERE id = ?").run(codeRow!.id);
      // reliability.md §4.2: at most 20 sessions; the least recently used go
      db.prepare(`
        DELETE FROM sessions WHERE id IN (
          SELECT id FROM sessions WHERE account_id = ?
          ORDER BY last_seen_at DESC, created_at DESC
          LIMIT -1 OFFSET 20
        )
      `).run(account.id);
      return { account, created };
    });

    if ("error" in outcome) {
      if (outcome.error === "invite_expired") {
        return c.json(
          {
            error: { code: "invite_expired", message: "Invite has expired" },
          } satisfies ApiError,
          410,
        );
      }
      if (outcome.error === "invite_already_used") {
        return c.json(
          {
            error: {
              code: "invite_already_used",
              message: "Invite limit reached",
            },
          } satisfies ApiError,
          409,
        );
      }
      return c.json(CODE_INVALID, 400);
    }
    const { account, created: isCreated } = outcome;

    const keyringRow = db.prepare(`
      SELECT key_version FROM keyrings
      WHERE account_id = ?
      ORDER BY rev DESC
      LIMIT 1
    `).get(account.id) as { key_version: number } | undefined;

    c.header("Set-Cookie", createSessionCookie(token));

    const res: AuthVerifyRes = {
      account: {
        id: account.id,
        created: isCreated,
        locale: account.locale,
        tz: account.tz,
        has_keyring: !!keyringRow,
        current_key_version: keyringRow ? keyringRow.key_version : null,
      },
    };

    return c.json(res, 200);
  });

  // POST /api/auth/logout
  router.post("/logout", authMiddleware, (c) => {
    const session = c.get("session");
    if (session) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    }
    c.header("Set-Cookie", clearSessionCookie());
    return c.body(null, 204);
  });

  return router;
}
