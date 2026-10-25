// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Session authentication middleware.
 * Specification: architecture.md §4.3, api.md §1, §1.3.
 */

import type { Context, Next } from "@hono/hono";
import type { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "../crypto.ts";
import { rateLimiter } from "../services/rate_limit.ts";
import type { Locale } from "../../shared/protocol.ts";
import type { ApiError } from "../../shared/protocol.ts";

export interface AuthAccount {
  id: string;
  tz: string;
  locale: Locale;
  wake_start: string;
  wake_end: string;
  reminders_per_day: number;
  min_gap_min: number;
  /** ISO instant; reminders are paused until then (null: not paused) */
  reminders_paused_until: string | null;
  created_at: string;
}

export interface AuthSession {
  id: string;
  token_hash: string;
  account_id: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export type AppEnv = {
  Variables: {
    /** 16 hex, also sent as `X-Request-Id` (ops.md §5.1). */
    reqId: string;
    account: AuthAccount;
    session: AuthSession;
    authProof: string;
  };
};

export function parseSessionCookie(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)emo_session=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null; // a malformed `%` sequence is no session, not a crash
  }
}

export function createSessionCookie(token: string, maxAge = 31536000): string {
  return `emo_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `emo_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * `anyAccount`: skip the `X-Emo-Account` check (logout, which ends a session
 * whichever account it belongs to).
 */
export function createAuthMiddleware(
  db: DatabaseSync,
  options: { anyAccount?: boolean } = {},
) {
  return async (c: Context<AppEnv>, next: Next) => {
    const cookieHeader = c.req.header("cookie");
    const token = parseSessionCookie(cookieHeader);

    if (!token) {
      return c.json(
        {
          error: {
            code: "unauthenticated",
            message: "Missing session cookie",
          },
        } satisfies ApiError,
        401,
      );
    }

    const tokenHash = await sha256Hex(token);

    // 1. Check if token belongs to an account that was deleted
    const gone = db.prepare(
      "SELECT token_hash FROM gone_sessions WHERE token_hash = ?",
    ).get(tokenHash);
    if (gone) {
      c.header("Set-Cookie", clearSessionCookie());
      return c.json(
        {
          error: {
            code: "account_gone",
            message:
              "The account associated with this session has been deleted",
          },
        } satisfies ApiError,
        401,
      );
    }

    // 2. Lookup session
    const session = db.prepare(`
      SELECT id, token_hash, account_id, user_agent, created_at, last_seen_at, expires_at
      FROM sessions
      WHERE token_hash = ?
    `).get(tokenHash) as unknown as AuthSession | undefined;

    if (!session) {
      c.header("Set-Cookie", clearSessionCookie());
      return c.json(
        {
          error: {
            code: "unauthenticated",
            message: "Invalid session",
          },
        } satisfies ApiError,
        401,
      );
    }

    const now = Date.now();
    const expiresMs = Date.parse(session.expires_at);
    if (isNaN(expiresMs) || expiresMs <= now) {
      // Session expired: delete row
      db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
      c.header("Set-Cookie", clearSessionCookie());
      return c.json(
        {
          error: {
            code: "unauthenticated",
            message: "Session has expired",
          },
        } satisfies ApiError,
        401,
      );
    }

    // 3. Lookup account
    const account = db.prepare(`
      SELECT id, tz, locale, wake_start, wake_end, reminders_per_day, min_gap_min,
             reminders_paused_until, created_at
      FROM accounts
      WHERE id = ?
    `).get(session.account_id) as unknown as AuthAccount | undefined;

    if (!account) {
      c.header("Set-Cookie", clearSessionCookie());
      return c.json(
        {
          error: {
            code: "unauthenticated",
            message: "Account not found",
          },
        } satisfies ApiError,
        401,
      );
    }

    // 4. The account whose data the device holds (api.md §1): a
    // session of another account never acts on it. The cookie stays, since
    // the person may still choose that account (reliability.md §1.3)
    const claimed = c.req.header("X-Emo-Account");
    if (claimed && claimed !== account.id && !options.anyAccount) {
      return c.json(
        {
          error: {
            code: "unauthenticated",
            message: "Session belongs to another account",
          },
        } satisfies ApiError,
        401,
      );
    }

    // 5. Rate limit check: 600 requests per 60s per session
    const rateCheck = rateLimiter.consume(`session:${session.id}`, 600, 60);
    if (!rateCheck.allowed) {
      c.header("Retry-After", String(rateCheck.retryAfterSec ?? 60));
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many requests for this session",
            retry_after_sec: rateCheck.retryAfterSec ?? 60,
          },
        } satisfies ApiError,
        429,
      );
    }

    // 6. Sliding session extension (if > 24 hours since last_seen_at)
    const lastSeenMs = Date.parse(session.last_seen_at);
    if (isNaN(lastSeenMs) || now - lastSeenMs > 24 * 3600 * 1000) {
      const newExpiresAt = new Date(now + 365 * 24 * 3600 * 1000).toISOString();
      const newLastSeenAt = new Date(now).toISOString();
      db.prepare(`
        UPDATE sessions
        SET last_seen_at = ?, expires_at = ?
        WHERE id = ?
      `).run(newLastSeenAt, newExpiresAt, session.id);

      c.header("Set-Cookie", createSessionCookie(token));
      session.last_seen_at = newLastSeenAt;
      session.expires_at = newExpiresAt;
    }

    c.set("account", account);
    c.set("session", session);
    return await next();
  };
}
