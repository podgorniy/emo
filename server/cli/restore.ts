// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `emo restore FILE` — replace the live database with a snapshot.
 * Specification: ops.md §4.3, architecture.md §10.2.
 *
 * 1. `PRAGMA integrity_check` on FILE must be `ok`;
 * 2. `MAX(schema_migrations.version)` of FILE ≤ this binary's latest migration;
 * 3. the current `emo.sqlite` moves to `backups/replaced-YYYYMMDD-HHMM.sqlite`
 *    (never deleted);
 * 4. FILE is copied to `DATA_DIR/emo.sqlite`, stale `-wal`/`-shm` removed;
 * 5. a new random epoch is written, so every client re-uploads what it holds.
 * Refuses while a server holds the scheduler lease (ops.md §1.1).
 */

import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateEpoch, latestMigrationVersion } from "../db/index.ts";
import { activeLease, LEASE_KEY } from "../services/lease.ts";

/** A precondition failed; nothing was changed. */
export class CliRefusal extends Error {}

export interface RestoreResult {
  restoredFrom: string;
  replacedCopy: string | null;
  schemaVersion: number;
  accounts: number;
  entries: number;
  epoch: string;
}

/** `YYYYMMDD-HHMM` in UTC, as in ops.md §4. */
export function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${
    p(now.getUTCDate())
  }-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}

function removeIfExists(file: string) {
  try {
    Deno.removeSync(file);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

function inspectSnapshot(file: string, latest: number) {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (err) {
    throw new CliRefusal(
      `Cannot open ${file} as SQLite: ${(err as Error).message}`,
    );
  }
  try {
    let integrity: string;
    try {
      const rows = db.prepare("PRAGMA integrity_check").all() as Array<
        { integrity_check: string }
      >;
      integrity = rows.map((r) => r.integrity_check).join("; ");
    } catch (err) {
      throw new CliRefusal(
        `${file} is not a valid SQLite database: ${(err as Error).message}`,
      );
    }
    if (integrity !== "ok") {
      throw new CliRefusal(`Integrity check failed for ${file}: ${integrity}`);
    }
    let version: number;
    try {
      const row = db.prepare(
        "SELECT MAX(version) AS v FROM schema_migrations",
      ).get() as { v: number | null };
      version = row.v ?? 0;
    } catch {
      throw new CliRefusal(
        `${file} is not an Emo database (no schema_migrations)`,
      );
    }
    if (version > latest) {
      throw new CliRefusal(
        `${file} has schema version ${version}, newer than this binary (${latest}); restore it with a newer emo`,
      );
    }
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number })
        .n;
    return { version, accounts: count("accounts"), entries: count("entries") };
  } finally {
    db.close();
  }
}

export function restoreDatabase(opts: {
  file: string;
  dataDir: string;
  now?: Date;
  latestVersion?: number;
}): RestoreResult {
  const now = opts.now ?? new Date();
  const file = path.resolve(opts.file);
  const livePath = path.resolve(opts.dataDir, "emo.sqlite");

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new CliRefusal(`Backup file does not exist: ${file}`);
  }
  if (file === livePath) {
    throw new CliRefusal("FILE is the live database itself");
  }

  // 1–2. The snapshot must be sound and not newer than this binary.
  const snapshot = inspectSnapshot(
    file,
    opts.latestVersion ?? latestMigrationVersion(),
  );

  // 3. Move the live database aside (after folding its WAL in).
  let replacedCopy: string | null = null;
  if (fs.existsSync(livePath)) {
    const live = new DatabaseSync(livePath);
    try {
      let lease = null;
      try {
        lease = activeLease(live, now.getTime());
      } catch { /* no meta table yet: nothing can hold a lease */ }
      if (lease) {
        throw new CliRefusal(
          `A server is running (scheduler lease held by ${lease.holder} until ${lease.expires_at}). Stop it first: make down`,
        );
      }
      live.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      live.close();
    }

    const backupsDir = path.join(path.dirname(livePath), "backups");
    Deno.mkdirSync(backupsDir, { recursive: true });
    const base = path.join(backupsDir, `replaced-${stamp(now)}`);
    replacedCopy = `${base}.sqlite`;
    for (let n = 2; fs.existsSync(replacedCopy); n++) {
      replacedCopy = `${base}-${n}.sqlite`;
    }
    Deno.renameSync(livePath, replacedCopy);
  } else {
    Deno.mkdirSync(path.dirname(livePath), { recursive: true });
  }
  removeIfExists(`${livePath}-wal`);
  removeIfExists(`${livePath}-shm`);

  // 4. Install the snapshot (copy, then rename: never a half-written live file).
  const staging = `${livePath}.restoring`;
  Deno.copyFileSync(file, staging);
  Deno.renameSync(staging, livePath);

  // 5. New epoch; a lease captured inside the snapshot means nothing now.
  const epoch = generateEpoch();
  const restored = new DatabaseSync(livePath);
  try {
    restored.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    restored.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('epoch', ?)",
    ).run(epoch);
    restored.prepare("DELETE FROM meta WHERE key = ?").run(LEASE_KEY);
  } finally {
    restored.close();
  }

  return {
    restoredFrom: file,
    replacedCopy,
    schemaVersion: snapshot.version,
    accounts: snapshot.accounts,
    entries: snapshot.entries,
    epoch,
  };
}
