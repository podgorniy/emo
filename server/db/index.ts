// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SQLite Database Connection and Migration Runner.
 * Specification: architecture.md §3.1, performance.md §4.
 */

import { encodeBase64Url } from "../../shared/crypto/encoding.ts";
import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "../log.ts";

let dbInstance: DatabaseSync | null = null;

export interface DbOptions {
  path?: string;
  inMemory?: boolean;
}

/**
 * Startup failure with the exit code ops.md §3 and reliability.md §1.5 give:
 * 2 a migration failed (rolled back), 3 `DATA_DIR` is not writable,
 * 4 the database is newer than this binary.
 */
export class DbStartupError extends Error {
  constructor(message: string, readonly exitCode: 2 | 3 | 4) {
    super(message);
    this.name = "DbStartupError";
  }
}

export function dataDir(): string {
  return Deno.env.get("DATA_DIR") || "./data";
}

/** Where `emo backup` and the pre-migration copies go. */
export function backupDir(): string {
  return path.join(dataDir(), "backups");
}

/**
 * Opens or returns the singleton SQLite connection with strict PRAGMAs applied.
 */
export function getDb(options?: DbOptions): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dbPath = options?.inMemory
    ? ":memory:"
    : options?.path || Deno.env.get("DATABASE_PATH") ||
      path.join(dataDir(), "emo.sqlite");

  let db: DatabaseSync;
  try {
    if (dbPath !== ":memory:") {
      Deno.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    db = new DatabaseSync(dbPath);
    // Apply performance & reliability PRAGMAs at every connection open
    db.exec("PRAGMA journal_mode = WAL;");
  } catch (err) {
    throw new DbStartupError(
      `Cannot open ${dbPath} for writing: ${(err as Error).message}`,
      3,
    );
  }
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA cache_size = -20000;"); // 20 MB
  db.exec("PRAGMA temp_store = MEMORY;");

  dbInstance = db;
  return db;
}

/**
 * Closes the database connection.
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/** A callback result that is not a promise (see `tx`). */
type Sync<T> = T extends PromiseLike<unknown> ? never : T;

/**
 * The only transaction helper (performance.md §4.1): BEGIN IMMEDIATE,
 * the callback, COMMIT, or ROLLBACK on a throw. The callback must be
 * synchronous, and is typed so an `async` one does not compile: an `await`
 * inside would let other requests run between BEGIN and COMMIT.
 */
export function tx<T>(db: DatabaseSync, fn: () => Sync<T>): T {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

const DEFAULT_SCHEMA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema",
);

/** Migration files `NNNN_name.sql`, ordered by version. */
export function listMigrations(
  schemaDir: string,
): Array<{ version: number; file: string }> {
  if (!fs.existsSync(schemaDir)) return [];
  return Array.from(Deno.readDirSync(schemaDir))
    .filter((e) => e.isFile && /^\d+_.+\.sql$/.test(e.name))
    .map((e) => ({ version: parseInt(e.name, 10), file: e.name }))
    .sort((a, b) => a.version - b.version);
}

export interface MigrateOptions {
  schemaDir?: string;
  /** Directory for the `pre-migrate-…` copy; null skips it (in-memory DBs). */
  backupDir?: string | null;
  /** Report what would run without changing anything. */
  dryRun?: boolean;
  now?: Date;
}

export interface MigrateResult {
  applied: number;
  currentVersion: number;
  /** Versions that were (or, with `dryRun`, would be) applied. */
  pending: number[];
  /** The pre-migration copy, when one was written. */
  backup: string | null;
}

const PRE_MIGRATE_KEEP = 3;

function stampUtc(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

/**
 * `VACUUM INTO file`, with the folder's symlinks resolved first: since Deno
 * 2.9.8 the copy fails ("unable to open database") when its path goes
 * through a symlink, such as macOS `/var` → `/private/var`. The folder must
 * exist.
 */
export function vacuumInto(db: DatabaseSync, file: string): void {
  const real = path.join(
    Deno.realPathSync(path.dirname(file)),
    path.basename(file),
  );
  db.prepare("VACUUM INTO ?").run(real);
}

/** `VACUUM INTO backups/pre-migrate-<from>-to-<to>-<ts>.sqlite`; keeps the last 3. */
function writePreMigrateCopy(
  db: DatabaseSync,
  dir: string,
  from: number,
  to: number,
  now: Date,
): string {
  const file = path.join(
    dir,
    `pre-migrate-${from}-to-${to}-${stampUtc(now)}.sqlite`,
  );
  try {
    Deno.mkdirSync(dir, { recursive: true });
    vacuumInto(db, file);
  } catch (err) {
    throw new DbStartupError(
      `Cannot write the pre-migration copy ${file}: ${(err as Error).message}`,
      3,
    );
  }
  const copies = Array.from(Deno.readDirSync(dir))
    .filter((e) => e.isFile && /^pre-migrate-.*\.sqlite$/.test(e.name))
    .map((e) => ({
      name: e.name,
      mtime: Deno.statSync(path.join(dir, e.name)).mtime?.getTime() ?? 0,
    }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  for (const old of copies.slice(PRE_MIGRATE_KEEP)) {
    Deno.removeSync(path.join(dir, old.name));
  }
  return file;
}

/**
 * Runs all pending migrations in **one** `BEGIN IMMEDIATE` transaction, after
 * a pre-migration copy of an existing database (data.md §8.5,
 * ops.md §3.1). Refuses a database newer than this binary.
 */
export function runMigrations(
  db: DatabaseSync,
  options: MigrateOptions = {},
): MigrateResult {
  const schemaDir = options.schemaDir ?? DEFAULT_SCHEMA_DIR;

  // The migrations ship inside the binary (`deno compile --include
  // server/db/schema`); finding none means a broken build, never "nothing to do".
  const migrations = listMigrations(schemaDir);
  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${schemaDir}: broken build`);
  }
  const latest = migrations[migrations.length - 1].version;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const appliedRows = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version ASC;")
    .all() as Array<{ version: number }>;
  const appliedSet = new Set(appliedRows.map((r) => r.version));
  const current = appliedRows.length > 0
    ? appliedRows[appliedRows.length - 1].version
    : 0;

  if (current > latest) {
    logger.error("db_newer_than_binary", {
      db_version: current,
      binary_version: latest,
    });
    throw new DbStartupError(
      `Database schema ${current} is newer than this binary (${latest}); use a newer image`,
      4,
    );
  }

  const pending = migrations.filter((m) => !appliedSet.has(m.version));
  const result: MigrateResult = {
    applied: 0,
    currentVersion: current,
    pending: pending.map((m) => m.version),
    backup: null,
  };
  if (options.dryRun || pending.length === 0) {
    if (!options.dryRun) initMetaAndEpoch(db);
    return result;
  }

  // A brand-new database has nothing worth copying
  if (options.backupDir && current > 0) {
    result.backup = writePreMigrateCopy(
      db,
      options.backupDir,
      current,
      latest,
      options.now ?? new Date(),
    );
  }

  let failing = "";
  try {
    tx(db, () => {
      for (const { version, file } of pending) {
        failing = file;
        db.exec(Deno.readTextFileSync(path.join(schemaDir, file)));
        db.prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?);",
        ).run(version, new Date().toISOString());
      }
    });
  } catch (err) {
    logger.error("migration_failed", { file: failing, err });
    throw new DbStartupError(
      `Migration ${failing} failed and nothing was applied: ${
        (err as Error).message
      }`,
      2,
    );
  }

  if (current === 0) logger.info("db_created", { schema_version: latest });
  initMetaAndEpoch(db);
  return { ...result, applied: pending.length, currentVersion: latest };
}

/**
 * Initializes meta table and server epoch (128-bit random hex).
 */
export function initMetaAndEpoch(db: DatabaseSync): string {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const existing = db
    .prepare("SELECT value FROM meta WHERE key = 'epoch';")
    .get() as { value: string } | undefined;

  if (existing) return existing.value;

  const epochHex = generateEpoch();
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('epoch', ?);")
    .run(epochHex);
  return epochHex;
}

/** A new random 128-bit database epoch (created with the DB, replaced by restore). */
/** api.md §1: base64url of 128 random bits (22 characters) */
export function generateEpoch(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/** The newest migration this binary ships. */
export function latestMigrationVersion(schemaDir = DEFAULT_SCHEMA_DIR): number {
  const all = listMigrations(schemaDir);
  return all.length > 0 ? all[all.length - 1].version : 0;
}

/**
 * Retrieves the current database epoch.
 */
export function getEpoch(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'epoch';")
    .get() as { value: string } | undefined;
  return row ? row.value : initMetaAndEpoch(db);
}
