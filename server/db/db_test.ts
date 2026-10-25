// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import { setLogSink } from "../log.ts";
import {
  closeDb,
  DbStartupError,
  getDb,
  getEpoch,
  latestMigrationVersion,
  runMigrations,
  tx,
} from "./index.ts";

Deno.test("db - transactions roll back on error", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE test (val INT);");

  assertThrows(() => {
    tx(db, () => {
      db.exec("INSERT INTO test VALUES (1);");
      throw new Error("fail tx");
    });
  });

  const row = db.prepare("SELECT COUNT(*) as count FROM test;").get() as {
    count: number;
  };
  assertEquals(row.count, 0);

  // Success case
  tx(db, () => {
    db.exec("INSERT INTO test VALUES (42);");
  });
  const row2 = db.prepare("SELECT val FROM test;").get() as { val: number };
  assertEquals(row2.val, 42);
  db.close();
});

Deno.test("db - runMigrations applies initial schema and creates epoch", () => {
  const db = new DatabaseSync(":memory:");
  const res = runMigrations(db);
  const latest = latestMigrationVersion();
  assertEquals(res.applied, latest);
  assertEquals(res.currentVersion, latest);

  const epoch = getEpoch(db);
  // api.md §1: base64url of 128 bits
  assertEquals(/^[A-Za-z0-9_-]{22}$/.test(epoch), true, epoch);

  // Running migrations again is idempotent
  const res2 = runMigrations(db);
  assertEquals(res2.applied, 0);
  assertEquals(res2.currentVersion, latest);
  assertEquals(getEpoch(db), epoch);

  db.close();
});

Deno.test("db - no migrations found is a broken build, not a no-op", async () => {
  const emptyDir = await Deno.makeTempDir();
  try {
    const db = new DatabaseSync(":memory:");
    assertThrows(
      () => runMigrations(db, { schemaDir: emptyDir }),
      Error,
      "broken build",
    );
    db.close();
  } finally {
    await Deno.remove(emptyDir, { recursive: true });
  }
});

Deno.test("db - the compiled binary embeds the migrations", async () => {
  // C6: `deno compile` only ships files it is told to include.
  const config = JSON.parse(
    await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
  );
  const build: string = config.tasks["build:server"];
  assertEquals(build.includes("--include server/db/schema"), true);
  const dockerfile = await Deno.readTextFile(
    new URL("../../Dockerfile", import.meta.url),
  );
  assertEquals(/RUN deno task build\b/.test(dockerfile), true);
});

/** A schema dir with the given `NNN_name.sql` → SQL files. */
async function schemaDirWith(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir();
  for (const [name, sql] of Object.entries(files)) {
    await Deno.writeTextFile(path.join(dir, name), sql);
  }
  return dir;
}

const ONE = "CREATE TABLE one (id INTEGER PRIMARY KEY);";
const TWO = "CREATE TABLE two (id INTEGER PRIMARY KEY);";

Deno.test("db - all pending migrations apply in one transaction", async () => {
  const restoreLog = setLogSink(() => {});
  const dir = await schemaDirWith({
    "001_one.sql": ONE,
    "002_two.sql": TWO,
    "003_broken.sql":
      "CREATE TABLE three (id INTEGER PRIMARY KEY); SELEC nonsense;",
  });
  try {
    const db = new DatabaseSync(":memory:");
    const err = assertThrows(
      () => runMigrations(db, { schemaDir: dir }),
      DbStartupError,
    );
    assertEquals(err.exitCode, 2);
    assert(err.message.includes("003_broken.sql"));
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all()
      .map((r) => (r as { name: string }).name);
    // Nothing of 001–003 is left: the whole run rolled back
    assertEquals(tables.filter((t) => ["one", "two", "three"].includes(t)), []);
    assertEquals(
      (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {
        n: number;
      }).n,
      0,
    );
    db.close();
  } finally {
    restoreLog();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("db - a database newer than the binary is refused (exit 4)", async () => {
  const restoreLog = setLogSink(() => {});
  const dir = await schemaDirWith({ "001_one.sql": ONE });
  try {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, { schemaDir: dir });
    db.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (7, 'x')",
    ).run();
    const err = assertThrows(
      () => runMigrations(db, { schemaDir: dir }),
      DbStartupError,
    );
    assertEquals(err.exitCode, 4);
    db.close();
  } finally {
    restoreLog();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("db - pending migrations get a pre-migration copy first; 3 are kept", async () => {
  const restoreLog = setLogSink(() => {});
  const dir = await schemaDirWith({ "001_one.sql": ONE });
  const data = await Deno.makeTempDir();
  const backups = path.join(data, "backups");
  try {
    const db = new DatabaseSync(path.join(data, "emo.sqlite"));
    // A new database is not copied
    assertEquals(
      runMigrations(db, { schemaDir: dir, backupDir: backups }).backup,
      null,
    );
    db.prepare("INSERT INTO one (id) VALUES (42)").run();

    // Older copies from earlier upgrades
    await Deno.mkdir(backups);
    for (let i = 0; i < 4; i++) {
      const old = path.join(
        backups,
        `pre-migrate-0-to-1-2026010${i}-000000.sqlite`,
      );
      await Deno.writeTextFile(old, "");
      await Deno.utime(old, 1_000_000 + i, 1_000_000 + i);
    }

    await Deno.writeTextFile(path.join(dir, "002_two.sql"), TWO);
    const dry = runMigrations(db, {
      schemaDir: dir,
      backupDir: backups,
      dryRun: true,
    });
    assertEquals(dry.pending, [2]);
    assertEquals(dry.applied, 0);
    assertEquals(dry.backup, null);

    const res = runMigrations(db, {
      schemaDir: dir,
      backupDir: backups,
      now: new Date("2026-10-08T14:05:33Z"),
    });
    assertEquals(res.applied, 1);
    assertEquals(
      res.backup,
      path.join(backups, "pre-migrate-1-to-2-20261008-140533.sqlite"),
    );
    // The copy holds the data as it was before the migration
    const copy = new DatabaseSync(res.backup!, { readOnly: true });
    assertEquals(
      (copy.prepare("SELECT id FROM one").get() as { id: number }).id,
      42,
    );
    assertEquals(
      copy.prepare("SELECT name FROM sqlite_master WHERE name = 'two'").get(),
      undefined,
    );
    copy.close();

    const kept = Array.from(Deno.readDirSync(backups)).map((e) => e.name)
      .sort();
    assertEquals(kept, [
      "pre-migrate-0-to-1-20260102-000000.sqlite",
      "pre-migrate-0-to-1-20260103-000000.sqlite",
      "pre-migrate-1-to-2-20261008-140533.sqlite",
    ]);
    db.close();
  } finally {
    restoreLog();
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(data, { recursive: true });
  }
});

Deno.test("db - an unwritable data directory is exit 3", () => {
  closeDb();
  const err = assertThrows(
    () => getDb({ path: "/proc-does-not-exist/nope/emo.sqlite" }),
    DbStartupError,
  );
  assertEquals(err.exitCode, 3);
});
