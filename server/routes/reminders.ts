// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reminders journal router: pull past reminder records for compliance analysis.
 * Future planned rows NEVER leave the server.
 * Specification: architecture.md §6.1, api.md §2.8.
 */

import { Hono } from "@hono/hono";
import type { DatabaseSync } from "node:sqlite";
import {
  type AppEnv,
  type AuthAccount,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import type {
  ReminderItem,
  RemindersPullRes,
  ReminderStatus,
} from "../../shared/protocol.ts";

/** api.md §2.8: about this many rows a page, plus ties. */
const PAGE = 500;
/** When a row became visible to the client (indexed in 003). */
const VISIBLE_AT = "max(updated_at, scheduled_for)";

export function createRemindersRoutes(db: DatabaseSync) {
  const router = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(db);

  router.use("*", authMiddleware);

  // GET /api/reminders?since=<iso>
  //
  // The cursor is the time a row became visible, max(updated_at,
  // scheduled_for): a row cancelled ahead of its time keeps an old updated_at
  // and only shows once scheduled_for has passed, so a cursor on updated_at
  // alone could already be beyond it. A page ends with every row of its last
  // timestamp, and nothing stamped in the current millisecond is returned, so
  // a later write in that millisecond cannot share the cursor.
  router.get("/", (c) => {
    const account = c.get("account") as AuthAccount;
    const since = c.req.query("since") || "1970-01-01T00:00:00.000Z";
    const nowIso = new Date().toISOString();

    const cutoff = db.prepare(`
      SELECT ${VISIBLE_AT} AS t FROM reminders
      WHERE account_id = ? AND ${VISIBLE_AT} > ? AND ${VISIBLE_AT} < ?
      ORDER BY ${VISIBLE_AT}
      LIMIT 1 OFFSET ?
    `).get(account.id, since, nowIso, PAGE - 1) as { t: string } | undefined;

    const rows = db.prepare(`
      SELECT id, local_date, tz, scheduled_for, sent_at, status, reason,
        updated_at, ${VISIBLE_AT} AS visible_at
      FROM reminders
      WHERE account_id = ? AND ${VISIBLE_AT} > ? AND ${VISIBLE_AT} < ?
        AND ${VISIBLE_AT} <= ?
      ORDER BY ${VISIBLE_AT}, id
    `).all(account.id, since, nowIso, cutoff?.t ?? nowIso) as Array<{
      id: string;
      local_date: string;
      tz: string;
      scheduled_for: string;
      sent_at: string | null;
      status: ReminderStatus;
      reason: string | null;
      updated_at: string;
      visible_at: string;
    }>;

    const hasMore = cutoff !== undefined && db.prepare(`
      SELECT 1 FROM reminders
      WHERE account_id = ? AND ${VISIBLE_AT} > ? AND ${VISIBLE_AT} < ?
      LIMIT 1
    `).get(account.id, cutoff.t, nowIso) !== undefined;

    const items: ReminderItem[] = rows.map((r) => ({
      id: r.id,
      local_date: r.local_date,
      tz: r.tz,
      scheduled_for: r.scheduled_for,
      sent_at: r.sent_at,
      status: r.status,
      reason: r.reason,
      updated_at: r.updated_at,
    }));

    const nextSince = rows.length > 0
      ? rows[rows.length - 1].visible_at
      : since;

    const res: RemindersPullRes = {
      items,
      next_since: nextSince,
      has_more: hasMore,
    };

    return c.json(res, 200);
  });

  return router;
}
