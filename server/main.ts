// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Main Entry Point and CLI Dispatcher for Emo.
 * Specification: ops.md §1.1, architecture.md §3.4.
 */

import { createApp } from "./app.ts";
import { loadConfig, validateEnv } from "./config.ts";
import { CliRefusal, restoreDatabase } from "./cli/restore.ts";
import { backupDir, getDb, getEpoch } from "./db/index.ts";
import { generateVapidKeyPairB64, PushService } from "./services/push.ts";
import { SchedulerService } from "./services/scheduler.ts";
import { hasSourceArchive } from "./dist.ts";
import { mailMode } from "./services/mail.ts";
import { logger } from "./log.ts";
import { checkServerSecret } from "./secret_check.ts";
import { SERVER_VERSION } from "./version.ts";
import { ADMIN_COMMANDS, runAdminCommand } from "./cli/admin_cli.ts";
import { refuseWhileServing } from "./cli/admin.ts";
import { openAndMigrate } from "./cli/open.ts";
import { backupDatabase, DEFAULT_KEEP, verifyBackup } from "./cli/backup.ts";
import { mailTest } from "./cli/mailtest.ts";
import { drainTasks } from "./tasks.ts";
import {
  collectStats,
  createInvite,
  parseDuration,
  revokeInvite,
} from "./cli/ops.ts";

async function main() {
  const args = Deno.args;
  const subcommand = args[0] || "serve";

  switch (subcommand) {
    case "serve":
      await runServe();
      break;

    case "migrate":
      runMigrateCommand(args.slice(1));
      break;

    case "healthcheck":
      await runHealthcheckCommand();
      break;

    case "backup":
      runBackupCommand(args.slice(1));
      break;

    case "restore":
      runRestoreCommand(args[1]);
      break;

    case "verify-backup":
      await runVerifyBackupCommand(args[1]);
      break;

    case "invite":
      await runInviteCommand(args.slice(1));
      break;

    case "stats":
      runStatsCommand();
      break;

    case "vapid-keys":
      await runVapidKeysCommand();
      break;

    case "mail-test":
      await runMailTestCommand(args[1]);
      break;

    default:
      if ((ADMIN_COMMANDS as readonly string[]).includes(subcommand)) {
        await runAdminCommand(subcommand, args.slice(1));
        break;
      }
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error(
        `Usage: emo [serve|migrate|healthcheck|backup|restore|verify-backup|invite|stats|vapid-keys|mail-test|${
          ADMIN_COMMANDS.join("|")
        }]`,
      );
      Deno.exit(1);
  }
}

async function runServe() {
  // The scheduler converts local wake windows with Temporal; a runtime
  // without it would place every reminder at the wrong hour (H6).
  if (typeof globalThis.Temporal === "undefined") {
    console.error(
      `[emo] Refusing to start: Deno ${Deno.version.deno} has no Temporal; use the version in .tool-versions`,
    );
    Deno.exit(1);
  }
  const problems = validateEnv();
  if (problems.length > 0) {
    console.error("[emo] Refusing to start; fix .env:");
    for (const p of problems) console.error(`  - ${p}`);
    Deno.exit(1);
  }
  const port = Number(Deno.env.get("PORT")) || 8080;
  const { db, mig } = openAndMigrate();
  logger.info("db_ready", {
    migrations_applied: mig.applied,
    schema_version: mig.currentVersion,
    epoch_prefix: getEpoch(db).slice(0, 8),
  });

  const config = loadConfig();
  // AGPL §13: without SOURCE_URL the "Source code" link is this build's own
  // archive, so the build must carry one (`make build` and the image do)
  if (!Deno.env.get("SOURCE_URL") && !config.devMode && !hasSourceArchive()) {
    console.error(
      "[emo] Refusing to start: SOURCE_URL is not set and this build has no source archive (client/dist/source.tar.gz). Build with `make build` or `make docker-build`, or set SOURCE_URL.",
    );
    Deno.exit(1);
  }
  if (await checkServerSecret(db, config.serverSecret) === "mismatch") {
    console.error(
      "[emo] Refusing to start: SERVER_SECRET differs from the one this database was created with, so no one could sign in. Restore the old value in .env (see your .env backup), or change it with `emo rotate-secret`.",
    );
    Deno.exit(1);
  }
  const pushService = new PushService(config);
  const scheduler = new SchedulerService(db, pushService);
  const app = createApp(db, config, {
    pushService,
    schedulerService: scheduler,
  });
  let server: Deno.HttpServer;
  try {
    server = Deno.serve({
      port,
      onListen: ({ hostname, port }) =>
        logger.info("server_listening", {
          hostname,
          port,
          version: SERVER_VERSION,
          mail: mailMode(config),
        }),
    }, app.fetch);
  } catch (err) {
    if (!(err instanceof Deno.errors.AddrInUse)) throw err;
    console.error(
      `[emo] Port ${port} is already in use: another \`make dev\`, or the container from \`make up\` (stop it with \`make down\`).`,
    );
    Deno.exit(1);
  }
  scheduler.start();

  // reliability.md §1.5: stop accepting, finish in-flight work (≤ 10 s),
  // release the scheduler lease, checkpoint and close the database.
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    logger.info("server_stopping", {});
    const deadline = new Promise((r) => setTimeout(r, 10_000));
    await Promise.race([
      Promise.all([server.shutdown(), scheduler.stop(), drainTasks()]),
      deadline,
    ]);
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      db.close();
    } catch (err) {
      logger.error("db_close_failed", { err });
    }
    Deno.exit(0);
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    Deno.addSignalListener(signal, shutdown);
  }
}

function runMigrateCommand(args: string[]) {
  const dryRun = args.includes("--dry-run");
  // ops.md §1.1: migrate needs the server stopped
  try {
    refuseWhileServing(getDb());
  } catch (err) {
    console.error(`[emo] Refusing to migrate: ${(err as Error).message}`);
    Deno.exit(1);
  }
  const { mig } = openAndMigrate(dryRun);
  if (dryRun) {
    console.log(
      mig.pending.length === 0
        ? `[emo] Schema ${mig.currentVersion} is current; nothing to apply.`
        : `[emo] Would apply ${
          mig.pending.join(", ")
        } to schema ${mig.currentVersion}, after a copy in ${backupDir()}.`,
    );
    return;
  }
  if (mig.backup) console.log(`[emo] Pre-migration copy: ${mig.backup}`);
  console.log(
    `[emo] Migrations finished. Applied: ${mig.applied}. Current version: ${mig.currentVersion}`,
  );
}

async function runHealthcheckCommand() {
  const port = Number(Deno.env.get("PORT")) || 8080;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      console.log(`Healthcheck passed (version ${body.version ?? "unknown"})`);
      Deno.exit(0);
    } else {
      console.error(`Healthcheck failed with HTTP status ${res.status}`);
      Deno.exit(1);
    }
  } catch (err) {
    console.error("Healthcheck connection failed:", err);
    Deno.exit(1);
  }
}

function runBackupCommand(args: string[]) {
  const keepArg = args.indexOf("--keep");
  const keep = keepArg >= 0 ? Number(args[keepArg + 1]) : DEFAULT_KEEP;
  if (!Number.isInteger(keep) || keep < 1) {
    console.error("Usage: emo backup [--keep N]  (N ≥ 1)");
    Deno.exit(1);
  }
  const { db } = openAndMigrate();
  try {
    const r = backupDatabase(db, backupDir(), { keep });
    console.log(`[emo] Backup: ${r.file}`);
    console.log(
      `[emo]   ${
        (r.sizeBytes / 1024).toFixed(0)
      } KiB, integrity_check ${r.integrity}, accounts ${
        r.tableCounts.accounts ?? 0
      }, entries ${r.tableCounts.entries ?? 0}`,
    );
    if (r.removed.length > 0) {
      console.log(
        `[emo]   rotated out (keep ${keep}): ${r.removed.join(", ")}`,
      );
    }
  } catch (err) {
    console.error(`[emo] Backup failed: ${(err as Error).message}`);
    Deno.exit(1);
  }
}

function runRestoreCommand(file?: string) {
  if (!file) {
    console.error("Usage: emo restore <backup-file>");
    Deno.exit(1);
  }
  const dataDir = Deno.env.get("DATA_DIR") || "./data";
  try {
    const r = restoreDatabase({ file, dataDir });
    console.log(`[emo] Restored ${r.restoredFrom}`);
    console.log(
      `[emo]   schema version ${r.schemaVersion}, ${r.accounts} account(s), ${r.entries} entry row(s)`,
    );
    if (r.replacedCopy) {
      console.log(`[emo]   previous database kept at ${r.replacedCopy}`);
    }
    console.log(
      `[emo]   new epoch ${r.epoch}: clients will re-upload what they hold`,
    );
    console.log("[emo] Next: make up && make smoke");
  } catch (err) {
    const prefix = err instanceof CliRefusal
      ? "Refusing to restore"
      : "Restore failed";
    console.error(`[emo] ${prefix}: ${(err as Error).message}`);
    Deno.exit(1);
  }
}

async function runVerifyBackupCommand(file?: string) {
  if (!file) {
    console.error("Usage: emo verify-backup <backup-file>");
    Deno.exit(1);
  }
  const r = await verifyBackup(file, loadConfig().serverSecret);
  console.log(`[emo] ${file}: schema ${r.schemaVersion}`);
  for (const [name, value] of Object.entries(r.counts)) {
    console.log(`[emo]   ${name.replaceAll("_", " ")}: ${value}`);
  }
  if (r.secretMatches !== null) {
    console.log(
      `[emo]   email decrypts with the current SERVER_SECRET: ${
        r.secretMatches ? "yes" : "NO"
      }`,
    );
  }
  if (!r.ok) {
    for (const p of r.problems) console.error(`[emo] FAIL: ${p}`);
    Deno.exit(1);
  }
  console.log("[emo] Backup verified: OK");
}

async function runInviteCommand(args: string[]) {
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const { db } = openAndMigrate();
  try {
    const revoke = value("--revoke");
    if (revoke) {
      await revokeInvite(db, revoke);
      console.log("[emo] Invite revoked.");
      return;
    }
    const uses = value("--uses");
    const expires = value("--expires");
    const invite = await createInvite(db, {
      uses: uses === undefined ? 1 : Number(uses),
      expiresMs: expires === undefined ? undefined : parseDuration(expires),
    });
    console.log(`[emo] Invite code: ${invite.code}`);
    console.log(
      `[emo] ${
        invite.uses === 1 ? "Single use" : `${invite.uses} uses`
      }, expires ${invite.expiresAt}. It is shown only now.`,
    );
  } catch (err) {
    if (err instanceof CliRefusal) {
      console.error(`[emo] Refusing: ${err.message}`);
      Deno.exit(1);
    }
    throw err;
  }
}

/** Exits right away: a connection the firewall drops may still be pending. */
async function runMailTestCommand(to?: string) {
  if (!to || !to.includes("@")) {
    console.error("Usage: emo mail-test <address>");
    Deno.exit(1);
  }
  const r = await mailTest(loadConfig(), to);
  for (const line of r.lines) (r.ok ? console.log : console.error)(line);
  Deno.exit(r.ok ? 0 : 1);
}

function runStatsCommand() {
  const { db } = openAndMigrate();
  const lines = collectStats(db);
  const width = Math.max(...lines.map((l) => l.label.length));
  console.log(`[emo] Stats, epoch ${getEpoch(db).slice(0, 8)}…`);
  for (const l of lines) console.log(`  ${l.label.padEnd(width)}  ${l.value}`);
}

/** Prints a new pair in `.env` form; `make init` writes it into `.env`. */
async function runVapidKeysCommand() {
  const keys = await generateVapidKeyPairB64();
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
}

if (import.meta.main) {
  main();
}
