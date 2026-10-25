// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Log-free operational counters for `emo stats` (ops.md §5.4): a name, a
 * value and a time, never an identifier. Kept 48 h (`maintenance.ts`).
 */
import type { DatabaseSync, StatementSync } from "node:sqlite";

export type CounterName =
  | "push_failed"
  | "push_subscription_removed"
  | "tick_lag_ms"
  | "mail_failed"
  | "mail_circuit_open";

const statementCache = new WeakMap<DatabaseSync, StatementSync>();

export function countOps(
  db: DatabaseSync,
  name: CounterName,
  value = 1,
  nowMs = Date.now(),
): void {
  let stmt = statementCache.get(db);
  if (!stmt) {
    stmt = db.prepare(
      "INSERT INTO ops_counters (ts, name, value) VALUES (?, ?, ?)",
    );
    statementCache.set(db, stmt);
  }
  stmt.run(new Date(nowMs).toISOString(), name, value);
}
