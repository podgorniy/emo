// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `emo backup [--keep N]` and `emo verify-backup FILE`.
 * Specification: ops.md §4.1, §4.4; architecture.md §10.2.
 */

import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import { latestMigrationVersion, vacuumInto } from "../db/index.ts";
import { decryptServerString } from "../crypto.ts";
import { logger } from "../log.ts";
import { decodeHex } from "../../shared/crypto/encoding.ts";
import { stamp } from "./restore.ts";

export const DEFAULT_KEEP = 30;
const SNAPSHOT_RE = /^emo-\d{8}-\d{4}(?:-\d{2})?\.sqlite$/;
/** The other database copies in `backups/`: before a migration, before a restore. */
const EXTRA_COPY_RE =
  /^(?:pre-migrate-\d+-to-\d+|replaced)-(\d{8}-\d{4})\d*(?:-\d+)?\.sqlite$/;

export interface BackupResult {
  file: string;
  sizeBytes: number;
  integrity: string;
  removed: string[];
  tableCounts: Record<string, number>;
}

function verifySnapshot(
  file: string,
): { integrity: string; tableCounts: Record<string, number> } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all() as Array<
      { integrity_check: string }
    >;
    const integrity = rows.map((r) => r.integrity_check).join("; ");
    const tables = ["accounts", "entries", "sessions", "reminders", "prefs"];
    const tableCounts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as {
          n: number;
        } | undefined;
        tableCounts[t] = row?.n ?? 0;
      } catch {
        // Table might not exist in older migration version
      }
    }
    return { integrity, tableCounts };
  } finally {
    db.close();
  }
}

/**
 * A consistent snapshot without downtime: `wal_checkpoint(TRUNCATE)`, then
 * `VACUUM INTO DIR/emo-YYYYMMDD-HHMM.sqlite`, checked with
 * `integrity_check` and table count verification; only the newest `keep` snapshots stay.
 */
export function backupDatabase(
  db: DatabaseSync,
  dir: string,
  options: { keep?: number; now?: Date } = {},
): BackupResult {
  const keep = options.keep ?? DEFAULT_KEEP;
  const now = options.now ?? new Date();
  try {
    Deno.mkdirSync(dir, { recursive: true });
    let file = path.join(dir, `emo-${stamp(now)}.sqlite`);
    try {
      Deno.statSync(file);
      // A second backup within the same minute
      const ss = String(now.getUTCSeconds()).padStart(2, "0");
      file = path.join(dir, `emo-${stamp(now)}-${ss}.sqlite`);
    } catch { /* the usual case: the name is free */ }

    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    vacuumInto(db, file);
    const { integrity, tableCounts } = verifySnapshot(file);
    if (integrity !== "ok") {
      throw new Error(`integrity_check of ${file}: ${integrity}`);
    }

    const snapshots = Array.from(Deno.readDirSync(dir))
      .filter((e) => e.isFile && SNAPSHOT_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    const removed: string[] = [];
    const kept = snapshots.slice(0, Math.max(1, keep));
    for (const old of snapshots.slice(Math.max(1, keep))) {
      Deno.removeSync(path.join(dir, old));
      removed.push(old);
    }
    // Once the rotation is full, no copy outlives the oldest kept snapshot, so
    // a deleted account's data leaves `backups/` within KEEP days (ops.md §4.1)
    if (kept.length >= Math.max(1, keep)) {
      const cutoff = kept[kept.length - 1].slice(4, 17); // YYYYMMDD-HHMM
      for (const e of Deno.readDirSync(dir)) {
        const m = e.isFile ? EXTRA_COPY_RE.exec(e.name) : null;
        if (m && m[1] < cutoff) {
          Deno.removeSync(path.join(dir, e.name));
          removed.push(e.name);
        }
      }
    }
    return {
      file,
      sizeBytes: Deno.statSync(file).size,
      integrity,
      removed,
      tableCounts,
    };
  } catch (err) {
    logger.error("backup_failed", { err });
    throw err;
  }
}

export interface VerifyReport {
  ok: boolean;
  problems: string[];
  schemaVersion: number;
  counts: {
    accounts: number;
    entries: number;
    entries_last_7_days: number;
    push_subscriptions: number;
    invites_unused: number;
  };
  /** True when one `email_enc` decrypts with the current `SERVER_SECRET`. */
  secretMatches: boolean | null;
}

/** ops.md §4.4: read-only checks; never touches the live database. */
export async function verifyBackup(
  file: string,
  serverSecretHex: string,
): Promise<VerifyReport> {
  const problems: string[] = [];
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (err) {
    return {
      ok: false,
      problems: [`Cannot open ${file} read-only: ${(err as Error).message}`],
      schemaVersion: 0,
      counts: {
        accounts: 0,
        entries: 0,
        entries_last_7_days: 0,
        push_subscriptions: 0,
        invites_unused: 0,
      },
      secretMatches: null,
    };
  }
  try {
    const integrity = (db.prepare("PRAGMA integrity_check").all() as Array<
      { integrity_check: string }
    >).map((r) => r.integrity_check).join("; ");
    if (integrity !== "ok") problems.push(`integrity_check: ${integrity}`);

    const n = (sql: string, ...args: string[]) =>
      (db.prepare(sql).get(...args) as { n: number }).n;
    const schemaVersion = n(
      "SELECT COALESCE(MAX(version), 0) AS n FROM schema_migrations",
    );
    if (schemaVersion > latestMigrationVersion()) {
      problems.push(
        `schema ${schemaVersion} is newer than this binary (${latestMigrationVersion()})`,
      );
    }

    const taken = Deno.statSync(file).mtime ?? new Date();
    const weekBefore = new Date(taken.getTime() - 7 * 86_400_000).toISOString();
    const nowIso = new Date().toISOString();
    const counts = {
      accounts: n("SELECT COUNT(*) AS n FROM accounts"),
      entries: n("SELECT COUNT(*) AS n FROM entries WHERE deleted = 0"),
      entries_last_7_days: n(
        "SELECT COUNT(*) AS n FROM entries WHERE deleted = 0 AND received_at >= ?",
        weekBefore,
      ),
      push_subscriptions: n("SELECT COUNT(*) AS n FROM push_subscriptions"),
      invites_unused: n(
        "SELECT COUNT(*) AS n FROM invites WHERE uses < max_uses AND expires_at > ?",
        nowIso,
      ),
    };

    let secretMatches: boolean | null = null;
    const one = db.prepare("SELECT email_enc FROM accounts LIMIT 1").get() as
      | { email_enc: Uint8Array }
      | undefined;
    if (one) {
      try {
        await decryptServerString(
          decodeHex(serverSecretHex),
          one.email_enc,
          "email",
        );
        secretMatches = true;
      } catch {
        secretMatches = false;
        problems.push(
          "An email does not decrypt with the current SERVER_SECRET: this snapshot and .env do not belong together",
        );
      }
    }
    return {
      ok: problems.length === 0,
      problems,
      schemaVersion,
      counts,
      secretMatches,
    };
  } finally {
    db.close();
  }
}
