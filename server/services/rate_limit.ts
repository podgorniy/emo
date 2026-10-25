// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * In-memory sliding-window rate limiter.
 * Specification: api.md §1.3.
 */

import type { DatabaseSync } from "node:sqlite";
import { tx } from "../db/index.ts";
import { logger } from "../log.ts";

interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private db: DatabaseSync | null = null;

  constructor(autoCleanup = true) {
    if (autoCleanup && typeof setInterval !== "undefined") {
      const id = setInterval(() => this.cleanup(), 60000);
      // Housekeeping only: never keep a CLI command (`emo migrate`, …) alive.
      Deno.unrefTimer(id);
      this.cleanupInterval = id;
    }
  }

  /**
   * Initializes SQLite backing for long-window rate limits (>= 3600s).
   */
  initDb(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persistent_rate_limits (
        key TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_persistent_rate_limits ON persistent_rate_limits (key, ts);
    `);
  }

  destroy() {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.entries.clear();
    this.db = null;
  }

  /**
   * Records an attempt and checks if within limit.
   */
  consume(
    key: string,
    limit: number,
    windowSec: number,
  ): { allowed: boolean; remaining: number; retryAfterSec?: number } {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const cutoff = now - windowMs;

    if (windowSec >= 3600 && this.db) {
      return tx(this.db, () => {
        this.db!.prepare(
          "DELETE FROM persistent_rate_limits WHERE key = ? AND ts <= ?",
        ).run(key, cutoff);

        const rows = this.db!.prepare(
          "SELECT ts FROM persistent_rate_limits WHERE key = ? AND ts > ? ORDER BY ts ASC",
        ).all(key, cutoff) as Array<{ ts: number }>;

        if (rows.length >= limit) {
          const bucket = key.split(":")[0];
          logger.warn("ratelimit_hit", {
            scope: bucket.endsWith("_ip") ? "ip" : "account",
            bucket,
          });
          const oldestInWindow = rows[0].ts;
          const retryAfterSec = Math.max(
            1,
            Math.ceil((oldestInWindow + windowMs - now) / 1000),
          );
          return {
            allowed: false,
            remaining: 0,
            retryAfterSec,
          };
        }

        this.db!.prepare(
          "INSERT INTO persistent_rate_limits (key, ts) VALUES (?, ?)",
        ).run(key, now);

        return {
          allowed: true,
          remaining: limit - rows.length - 1,
        };
      });
    }

    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.entries.set(key, entry);
    }

    // Filter out timestamps outside window
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

    if (entry.timestamps.length >= limit) {
      // The key's prefix names the bucket; the rest may be an address and
      // is never logged
      const bucket = key.split(":")[0];
      logger.warn("ratelimit_hit", {
        scope: bucket.endsWith("_ip") ? "ip" : "account",
        bucket,
      });
      const oldestInWindow = entry.timestamps[0];
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldestInWindow + windowMs - now) / 1000),
      );
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec,
      };
    }

    entry.timestamps.push(now);
    return {
      allowed: true,
      remaining: limit - entry.timestamps.length,
    };
  }

  /**
   * Checks current state without consuming a slot.
   */
  check(
    key: string,
    limit: number,
    windowSec: number,
  ): { allowed: boolean; remaining: number; retryAfterSec?: number } {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const cutoff = now - windowMs;

    if (windowSec >= 3600 && this.db) {
      const rows = this.db.prepare(
        "SELECT ts FROM persistent_rate_limits WHERE key = ? AND ts > ? ORDER BY ts ASC",
      ).all(key, cutoff) as Array<{ ts: number }>;

      if (rows.length >= limit) {
        const oldestInWindow = rows[0].ts;
        const retryAfterSec = Math.max(
          1,
          Math.ceil((oldestInWindow + windowMs - now) / 1000),
        );
        return {
          allowed: false,
          remaining: 0,
          retryAfterSec,
        };
      }

      return {
        allowed: true,
        remaining: limit - rows.length,
      };
    }

    const entry = this.entries.get(key);
    if (!entry) {
      return { allowed: true, remaining: limit };
    }

    const validTimestamps = entry.timestamps.filter((ts) => ts > cutoff);
    if (validTimestamps.length >= limit) {
      const oldestInWindow = validTimestamps[0];
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldestInWindow + windowMs - now) / 1000),
      );
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec,
      };
    }

    return {
      allowed: true,
      remaining: limit - validTimestamps.length,
    };
  }

  /**
   * Resets counter for a key.
   */
  reset(key: string) {
    if (this.db) {
      try {
        this.db.prepare("DELETE FROM persistent_rate_limits WHERE key = ?").run(
          key,
        );
      } catch {
        // Ignored if db was closed
      }
    }
    this.entries.delete(key);
  }

  /**
   * Cleans up idle entries older than 24 hours.
   */
  private cleanup() {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const [key, entry] of this.entries.entries()) {
      entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
      if (entry.timestamps.length === 0) {
        this.entries.delete(key);
      }
    }
    if (this.db) {
      try {
        this.db.prepare("DELETE FROM persistent_rate_limits WHERE ts <= ?").run(
          cutoff,
        );
      } catch {
        // Ignored if db was closed
      }
    }
  }
}

// Global server rate limiter instance
export const rateLimiter = new RateLimiter();
