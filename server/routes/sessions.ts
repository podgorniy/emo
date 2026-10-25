// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sessions router: list active sessions and revoke sessions.
 * Specification: architecture.md §4.3, api.md §2.4.
 */

import { Hono } from "@hono/hono";
import type { DatabaseSync } from "node:sqlite";
import {
  type AppEnv,
  type AuthAccount,
  type AuthSession,
  clearSessionCookie,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import type { SessionItem, SessionsListRes } from "../../shared/protocol.ts";
import type { ApiError } from "../../shared/protocol.ts";

export function createSessionsRoutes(db: DatabaseSync) {
  const router = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(db);

  router.use("*", authMiddleware);

  // GET /api/sessions
  router.get("/", (c) => {
    const account = c.get("account") as AuthAccount;
    const currentSession = c.get("session") as AuthSession;

    const rows = db.prepare(`
      SELECT id, user_agent, created_at, last_seen_at
      FROM sessions
      WHERE account_id = ?
      ORDER BY last_seen_at DESC
    `).all(account.id) as Array<{
      id: string;
      user_agent: string;
      created_at: string;
      last_seen_at: string;
    }>;

    const items: SessionItem[] = rows.map((r) => ({
      id: r.id,
      user_agent: r.user_agent,
      created_at: r.created_at,
      last_seen_at: r.last_seen_at,
      current: r.id === currentSession.id,
    }));

    const res: SessionsListRes = { items };
    return c.json(res, 200);
  });

  // DELETE /api/sessions/:id
  router.delete("/:id", (c) => {
    const account = c.get("account") as AuthAccount;
    const currentSession = c.get("session") as AuthSession;
    const sessionId = c.req.param("id");

    const target = db.prepare(
      "SELECT id FROM sessions WHERE id = ? AND account_id = ?",
    ).get(
      sessionId,
      account.id,
    ) as { id: string } | undefined;

    if (!target) {
      return c.json(
        {
          error: { code: "not_found", message: "Session not found" },
        } satisfies ApiError,
        404,
      );
    }

    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);

    if (sessionId === currentSession.id) {
      c.header("Set-Cookie", clearSessionCookie());
    }

    return c.body(null, 204);
  });

  return router;
}
