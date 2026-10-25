// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Invites router: list and create invite codes.
 * Specification: architecture.md §4.4, api.md §2.2.
 */

import { Hono } from "@hono/hono";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.ts";
import {
  decryptServerString,
  encryptServerBlob,
  generateInviteCode,
  hashInviteCode,
} from "../crypto.ts";
import {
  type AppEnv,
  type AuthAccount,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import type {
  InviteCreateRes,
  InviteItem,
  InvitesListRes,
  InviteStatus,
} from "../../shared/protocol.ts";
import { decodeHex } from "../../shared/crypto/encoding.ts";
import type { ApiError } from "../../shared/protocol.ts";

export function createInvitesRoutes(db: DatabaseSync, config: Config) {
  const router = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(db);
  const secretBytes = decodeHex(config.serverSecret);

  router.use("*", authMiddleware);

  // GET /api/invites
  router.get("/", async (c) => {
    if (!config.invitesByUsers) {
      return c.json(
        {
          error: {
            code: "invites_disabled",
            message: "User invites are disabled on this instance",
          },
        } satisfies ApiError,
        403,
      );
    }

    const account = c.get("account") as AuthAccount;

    const rows = db.prepare(`
      SELECT i.code_hash, i.code_enc, i.created_at, i.expires_at, i.max_uses, i.uses,
             iu.used_at as joined_at
      FROM invites i
      LEFT JOIN invite_uses iu ON i.code_hash = iu.code_hash
      WHERE i.created_by = ?
      ORDER BY i.created_at DESC
    `).all(account.id) as Array<{
      code_hash: string;
      code_enc: Uint8Array | null;
      created_at: string;
      expires_at: string;
      max_uses: number;
      uses: number;
      joined_at: string | null;
    }>;

    const now = Date.now();
    const items: InviteItem[] = [];

    for (const r of rows) {
      let status: InviteStatus = "unused";
      if (r.uses >= r.max_uses) {
        status = "used";
      } else if (Date.parse(r.expires_at) <= now) {
        status = "expired";
      }

      let codeStr: string | null = null;
      if (status === "unused" && r.code_enc) {
        try {
          codeStr = await decryptServerString(
            secretBytes,
            r.code_enc,
            "invite-code",
          );
        } catch {
          codeStr = null;
        }
      }

      items.push({
        code: codeStr,
        created_at: r.created_at,
        expires_at: r.expires_at,
        max_uses: r.max_uses,
        uses: r.uses,
        status,
        joined_at: r.joined_at,
      });
    }

    const joinedTotalRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM invite_uses iu
      JOIN invites i ON iu.code_hash = i.code_hash
      WHERE i.created_by = ?
    `).get(account.id) as { count: number };

    const res: InvitesListRes = {
      limit: config.invitesPerUser,
      items,
      joined_total: joinedTotalRow.count,
    };

    return c.json(res, 200);
  });

  // POST /api/invites
  router.post("/", async (c) => {
    if (!config.invitesByUsers) {
      return c.json(
        {
          error: {
            code: "invites_disabled",
            message: "User invites are disabled on this instance",
          },
        } satisfies ApiError,
        403,
      );
    }

    const account = c.get("account") as AuthAccount;
    const now = new Date();
    const nowIso = now.toISOString();

    const countRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM invites
      WHERE created_by = ? AND uses < max_uses AND expires_at > ?
    `).get(account.id, nowIso) as { count: number };

    if (countRow.count >= config.invitesPerUser) {
      return c.json(
        {
          error: {
            code: "invite_limit",
            message: "Invite limit reached",
          },
        } satisfies ApiError,
        409,
      );
    }

    const code = generateInviteCode();
    const codeHash = await hashInviteCode(code);
    const codeEnc = await encryptServerBlob(secretBytes, code, "invite-code");
    const expiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000)
      .toISOString();

    db.prepare(`
      INSERT INTO invites (code_hash, code_enc, created_by, created_at, expires_at, max_uses, uses)
      VALUES (?, ?, ?, ?, ?, 1, 0)
    `).run(codeHash, codeEnc, account.id, nowIso, expiresAt);

    const res: InviteCreateRes = {
      code,
      expires_at: expiresAt,
      max_uses: 1,
    };

    return c.json(res, 201);
  });

  return router;
}
