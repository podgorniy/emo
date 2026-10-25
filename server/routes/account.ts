// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Account router: recovery email sending and hard deletion.
 * Specification: architecture.md §4.5, §5.6, api.md §2.5.
 */

import { Hono } from "@hono/hono";
import { readJson } from "../http.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.ts";
import { decryptServerString } from "../crypto.ts";
import {
  type AppEnv,
  type AuthAccount,
  clearSessionCookie,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import { createProofMiddleware } from "../middleware/proof.ts";
import { tx } from "../db/index.ts";
import { deleteAccount } from "../services/accounts.ts";
import type { MailService } from "../services/mail.ts";
import { parseRecoveryKey } from "../../shared/crypto/recovery.ts";
import { decodeHex } from "../../shared/crypto/encoding.ts";
import { RecoveryMailReqSchema } from "../../shared/protocol.ts";
import type { ApiError } from "../../shared/protocol.ts";

const DAY_MS = 24 * 3600 * 1000;
/** api.md §1.3 */
const RECOVERY_MAILS_PER_DAY = 3;

export function createAccountRoutes(
  db: DatabaseSync,
  config: Config,
  mailService: MailService,
) {
  const router = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(db);
  const proofMiddleware = createProofMiddleware(db);
  const secretBytes = decodeHex(config.serverSecret);

  // POST /api/account/recovery-mail
  router.post("/recovery-mail", authMiddleware, async (c) => {
    if (!config.recoveryMailEnabled) {
      return c.json(
        {
          error: {
            code: "recovery_mail_disabled",
            message: "Recovery email sending is disabled on this instance",
          },
        } satisfies ApiError,
        403,
      );
    }

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

    const account = c.get("account") as AuthAccount;

    const body = await readJson(c, RecoveryMailReqSchema);
    if (body instanceof Response) return body;

    if (!body.recovery_key) {
      return c.json(
        {
          error: { code: "invalid_field", message: "Missing recovery_key" },
        } satisfies ApiError,
        400,
      );
    }

    const parsedKey = await parseRecoveryKey(body.recovery_key);
    if (!parsedKey.valid) {
      return c.json(
        {
          error: {
            code: "invalid_field",
            message: `Invalid recovery key: ${parsedKey.error}`,
          },
        } satisfies ApiError,
        400,
      );
    }

    const row = db.prepare(
      "SELECT email_enc, email_hmac FROM accounts WHERE id = ?",
    ).get(account.id) as {
      email_enc: Uint8Array;
      email_hmac: Uint8Array;
    };

    let email: string;
    try {
      email = await decryptServerString(secretBytes, row.email_enc, "email");
    } catch {
      return c.json(
        {
          error: {
            code: "internal",
            message: "Failed to decrypt account email",
          },
        } satisfies ApiError,
        500,
      );
    }

    // A key after the first one replaces it: the mail says so (copy.md §2.1)
    const { rev } = db.prepare(
      "SELECT COALESCE(MAX(rev), 1) AS rev FROM keyrings WHERE account_id = ?",
    ).get(account.id) as { rev: number };
    const rendered = mailService.renderRecoveryKeyMail(
      body.recovery_key,
      account.locale,
      rev > 1,
    );
    // reliability.md §1.7: 3 a day per account, counted in mail_log. The
    // slot is taken atomically (no await between count and insert) and given
    // back when the send fails, so neither a race nor an SMTP outage changes
    // the count.
    const now = Date.now();
    const slot = tx(db, () => {
      const recent = db.prepare(`
        SELECT sent_at FROM mail_log
        WHERE account_id = ? AND kind = 'recovery' AND sent_at > ?
        ORDER BY sent_at
      `).all(account.id, new Date(now - DAY_MS).toISOString()) as Array<{
        sent_at: string;
      }>;
      if (recent.length >= RECOVERY_MAILS_PER_DAY) {
        return {
          retryAfterSec: Math.max(
            1,
            Math.ceil((Date.parse(recent[0].sent_at) + DAY_MS - now) / 1000),
          ),
        };
      }
      return {
        id: db.prepare(`
          INSERT INTO mail_log (account_id, kind, sent_at)
          VALUES (?, 'recovery', ?)
        `).run(account.id, new Date(now).toISOString()).lastInsertRowid,
      };
    });
    if ("retryAfterSec" in slot) {
      c.header("Retry-After", String(slot.retryAfterSec));
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many recovery emails requested",
            retry_after_sec: slot.retryAfterSec,
          },
        } satisfies ApiError,
        429,
      );
    }

    const sent = await mailService.sendMail(
      email,
      rendered.subject,
      rendered.text,
    );
    if (!sent) {
      db.prepare("DELETE FROM mail_log WHERE id = ?").run(slot.id);
      c.header("Retry-After", "300");
      return c.json(
        {
          error: {
            code: "mail_unavailable",
            message: "Email delivery failed",
            retry_after_sec: 300,
          },
        } satisfies ApiError,
        503,
      );
    }

    return c.json({ ok: true }, 202);
  });

  // DELETE /api/account (requires DEK proof)
  router.delete("/", authMiddleware, proofMiddleware, (c) => {
    const account = c.get("account") as AuthAccount;
    deleteAccount(db, account.id);

    c.header("Set-Cookie", clearSessionCookie());
    return c.body(null, 204);
  });

  return router;
}
