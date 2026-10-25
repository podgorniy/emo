// SPDX-License-Identifier: AGPL-3.0-or-later
/** Opening the database for `emo` subcommands. Specification: ops.md §3. */

import {
  backupDir,
  DbStartupError,
  getDb,
  type MigrateResult,
  runMigrations,
} from "../db/index.ts";
import type { DatabaseSync } from "node:sqlite";

/** Opens the database and applies pending migrations, or exits with the
 * code of ops.md §3 (2 failed, 3 `DATA_DIR` not writable, 4 newer DB). */
export function openAndMigrate(
  dryRun = false,
): { db: DatabaseSync; mig: MigrateResult } {
  try {
    const db = getDb();
    const mig = runMigrations(db, { backupDir: backupDir(), dryRun });
    return { db, mig };
  } catch (err) {
    console.error(`[emo] ${(err as Error).message}`);
    Deno.exit(err instanceof DbStartupError ? err.exitCode : 2);
  }
}
