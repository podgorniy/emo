// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Housekeeping every 6 h, run by the scheduler's lease holder: expired
 * sessions and login codes, `gone_sessions` after 90 days (api.md §2.5),
 * `ops_counters` after 48 h (ops.md §5.4), the readable code of
 * expired invites (architecture.md §6.1), then a WAL checkpoint
 * (performance.md §4.1). The last run is kept in `meta`, so a restart
 * does not repeat it.
 */
import type { DatabaseSync } from "node:sqlite";
import { tx } from "../db/index.ts";
import { logger } from "../log.ts";

export const MAINTENANCE_INTERVAL_MS = 6 * 3600_000;
const DAY_MS = 24 * 3600_000;
const LAST_RUN_KEY = "maintenance_at";

export interface MaintenanceResult {
  sessions: number;
  login_codes: number;
  gone_sessions: number;
  ops_counters: number;
  invite_codes: number;
  entry_tombstones: number;
}

export function maintenanceDue(db: DatabaseSync, nowMs: number): boolean {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(
    LAST_RUN_KEY,
  ) as { value: string } | undefined;
  const last = row ? Date.parse(row.value) : NaN;
  return !(nowMs - last < MAINTENANCE_INTERVAL_MS);
}

export function runMaintenance(
  db: DatabaseSync,
  nowMs: number,
): MaintenanceResult {
  const iso = (ms: number) => new Date(ms).toISOString();
  const now = iso(nowMs);
  const result = tx(db, () => {
    const del = (sql: string, ...args: string[]) =>
      Number(db.prepare(sql).run(...args).changes);
    const r: MaintenanceResult = {
      sessions: del("DELETE FROM sessions WHERE expires_at < ?", now),
      login_codes: del("DELETE FROM login_codes WHERE expires_at < ?", now),
      gone_sessions: del(
        "DELETE FROM gone_sessions WHERE deleted_at < ?",
        iso(nowMs - 90 * DAY_MS),
      ),
      ops_counters: del(
        "DELETE FROM ops_counters WHERE ts < ?",
        iso(nowMs - 2 * DAY_MS),
      ),
      // An expired invite's readable code is no longer needed (architecture.md §6.1)
      invite_codes: Number(
        db.prepare(
          "UPDATE invites SET code_enc = NULL WHERE expires_at < ? AND code_enc IS NOT NULL",
        ).run(now).changes,
      ),
      entry_tombstones: del(
        "DELETE FROM entries WHERE deleted = 1 AND received_at < ?",
        iso(nowMs - 90 * DAY_MS),
      ),
    };
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      LAST_RUN_KEY,
      now,
    );
    return r;
  });
  db.exec("PRAGMA wal_checkpoint(RESTART);");
  logger.info("maintenance", { ...result });
  return result;
}
