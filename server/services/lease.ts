// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The scheduler lease `meta.scheduler_lease = { holder, expires_at }`: only
 * the holder ticks, and commands that need a stopped server refuse to run
 * while someone holds it. 120 s, renewed every tick; released on SIGTERM.
 * Specification: architecture.md §9.1, ops.md §1.1, reliability.md §1.5.
 */

import type { DatabaseSync } from "node:sqlite";
import { tx } from "../db/index.ts";

export const LEASE_KEY = "scheduler_lease";
export const LEASE_TTL_MS = 120_000;

export interface Lease {
  holder: string;
  expires_at: string;
}

export function readLease(db: DatabaseSync): Lease | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(
    LEASE_KEY,
  ) as { value: string } | undefined;
  if (!row) return null;
  try {
    const lease = JSON.parse(row.value) as Lease;
    return typeof lease.holder === "string" &&
        typeof lease.expires_at === "string"
      ? lease
      : null;
  } catch {
    return null;
  }
}

/** A lease that has not expired, or null. */
export function activeLease(db: DatabaseSync, now = Date.now()): Lease | null {
  const lease = readLease(db);
  return lease && Date.parse(lease.expires_at) > now ? lease : null;
}

/** Takes or renews the lease; false when another holder has a live one. */
export function tryAcquireLease(
  db: DatabaseSync,
  holder: string,
  now = Date.now(),
): boolean {
  return tx(db, () => {
    const current = activeLease(db, now);
    if (current && current.holder !== holder) return false;
    const lease: Lease = {
      holder,
      expires_at: new Date(now + LEASE_TTL_MS).toISOString(),
    };
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      LEASE_KEY,
      JSON.stringify(lease),
    );
    return true;
  });
}

export function releaseLease(db: DatabaseSync, holder: string): void {
  tx(db, () => {
    if (readLease(db)?.holder === holder) {
      db.prepare("DELETE FROM meta WHERE key = ?").run(LEASE_KEY);
    }
  });
}
