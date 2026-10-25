// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `emo invite [--uses N] [--expires 30d] | --revoke CODE` and `emo stats`.
 * Specification: ops.md §1.1, §5.4, §6.2; architecture.md §4.4.
 */

import type { DatabaseSync } from "node:sqlite";
import { generateInviteCode, hashInviteCode } from "../crypto.ts";
import { logger } from "../log.ts";
import { CliRefusal } from "./restore.ts";

const DAY_MS = 86_400_000;

/** `30d`, `12h` or a bare number of days. */
export function parseDuration(text: string): number {
  const m = /^(\d+)([dh]?)$/.exec(text.trim());
  if (!m || Number(m[1]) === 0) {
    throw new CliRefusal(
      `--expires takes a duration like 30d or 12h, not "${text}"`,
    );
  }
  return Number(m[1]) * (m[2] === "h" ? 3_600_000 : DAY_MS);
}

/** An admin invite (no `created_by`); `uses > 1` makes a multi-use code. */
export async function createInvite(
  db: DatabaseSync,
  options: { uses?: number; expiresMs?: number; now?: Date } = {},
): Promise<{ code: string; expiresAt: string; uses: number }> {
  const uses = options.uses ?? 1;
  if (!Number.isInteger(uses) || uses < 1 || uses > 1000) {
    throw new CliRefusal("--uses takes a whole number from 1 to 1000");
  }
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (options.expiresMs ?? 30 * DAY_MS))
    .toISOString();
  const code = generateInviteCode();
  db.prepare(`
    INSERT INTO invites (code_hash, created_by, created_at, expires_at, max_uses, uses)
    VALUES (?, NULL, ?, ?, ?, 0)
  `).run(await hashInviteCode(code), now.toISOString(), expiresAt, uses);
  logger.info("admin_invite_created", { uses });
  return { code, expiresAt, uses };
}

/** Expires an invite now, so it cannot be used again. */
export async function revokeInvite(
  db: DatabaseSync,
  code: string,
  now = new Date(),
): Promise<void> {
  const res = db.prepare(`
    UPDATE invites SET expires_at = ?, code_enc = NULL
    WHERE code_hash = ? AND expires_at > ?
  `).run(now.toISOString(), await hashInviteCode(code), now.toISOString());
  if (Number(res.changes) === 0) {
    throw new CliRefusal("No live invite with this code");
  }
  logger.info("admin_invite_revoked", {});
}

export interface StatsLine {
  label: string;
  value: string;
}

/** ops.md §5.4. Counts only: no identifiers. */
export function collectStats(db: DatabaseSync, now = new Date()): StatsLine[] {
  const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const n = (sql: string, ...args: (string | number)[]) =>
    (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;
  const lines: StatsLine[] = [];
  const add = (label: string, value: string | number) =>
    lines.push({ label, value: String(value) });

  add(
    "accounts total / created last 30 d",
    `${n("SELECT COUNT(*) AS n FROM accounts")} / ${
      n(
        "SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ?",
        iso(30 * DAY_MS),
      )
    }`,
  );

  const perDay: string[] = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(now.getTime() - d * DAY_MS).toISOString().slice(0, 10);
    perDay.push(
      `${day.slice(5)}: ${
        n(
          "SELECT COUNT(*) AS n FROM entries WHERE substr(received_at, 1, 10) = ? AND deleted = 0",
          day,
        )
      }`,
    );
  }
  add("entries received per day, last 7 d (UTC)", perDay.join("  "));

  const total = n("SELECT COUNT(*) AS n FROM entries");
  const tombstones = n("SELECT COUNT(*) AS n FROM entries WHERE deleted = 1");
  add(
    "tombstones / all entry rows",
    `${tombstones} / ${total}${
      total ? ` (${((tombstones / total) * 100).toFixed(1)} %)` : ""
    }`,
  );

  const day = iso(DAY_MS);
  const byStatus = (status: string) =>
    n(
      "SELECT COUNT(*) AS n FROM reminders WHERE status = ? AND scheduled_for >= ? AND scheduled_for <= ?",
      status,
      day,
      now.toISOString(),
    );
  add(
    "reminders planned / sent / failed / cancelled / paused, last 24 h",
    ["planned", "sent", "failed", "cancelled", "paused"].map(byStatus).join(
      " / ",
    ),
  );
  const cancelledBy = (reason: string) =>
    n(
      "SELECT COUNT(*) AS n FROM reminders WHERE status = 'cancelled' AND reason = ? AND scheduled_for >= ? AND scheduled_for <= ?",
      reason,
      day,
      now.toISOString(),
    );
  add(
    "cancelled: no device / server down / settings / tz change, last 24 h",
    ["no_device", "overdue", "settings", "tz_change"].map(cancelledBy).join(
      " / ",
    ),
  );

  const counter = (name: string) =>
    n(
      "SELECT COALESCE(SUM(value), 0) AS n FROM ops_counters WHERE name = ? AND ts >= ?",
      name,
      day,
    );
  add(
    "push failures / subscriptions removed, last 24 h",
    `${counter("push_failed")} / ${counter("push_subscription_removed")}`,
  );
  const lags = (db.prepare(
    "SELECT value FROM ops_counters WHERE name = 'tick_lag_ms' AND ts >= ? ORDER BY value",
  ).all(day) as Array<{ value: number }>).map((r) => r.value);
  add(
    "scheduler lag p95, last 24 h",
    lags.length
      ? `${lags[Math.min(lags.length - 1, Math.floor(lags.length * 0.95))]} ms`
      : "no samples",
  );
  add(
    "mail failures / circuit openings, last 24 h",
    `${counter("mail_failed")} / ${counter("mail_circuit_open")}`,
  );

  const pragma = (name: string) =>
    (db.prepare(`PRAGMA ${name}`).get() as Record<string, number>)[name];
  const pageSize = pragma("page_size");
  const dbFile =
    (db.prepare("PRAGMA database_list").all() as Array<{ file: string }>)[0]
      ?.file;
  let walBytes = 0;
  try {
    if (dbFile) walBytes = Deno.statSync(`${dbFile}-wal`).size;
  } catch { /* no WAL file right now */ }
  add(
    "db size / wal size / free pages",
    `${((pragma("page_count") * pageSize) / 1024).toFixed(0)} KiB / ${
      (walBytes / 1024).toFixed(0)
    } KiB / ${pragma("freelist_count")}`,
  );
  return lines;
}
