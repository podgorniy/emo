// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  latestMigrationVersion,
  runMigrations,
  vacuumInto,
} from "../db/index.ts";
import { LEASE_KEY, tryAcquireLease } from "../services/lease.ts";
import { CliRefusal, restoreDatabase, stamp } from "./restore.ts";

function meta(file: string, key: string): string | undefined {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined)?.value;
  } finally {
    db.close();
  }
}

/** A live DATA_DIR plus a snapshot taken from it, then the live DB moves on. */
async function setup() {
  const dataDir = await Deno.makeTempDir();
  const live = path.join(dataDir, "emo.sqlite");
  const snapshot = path.join(dataDir, "snap.sqlite");
  const db = new DatabaseSync(live);
  db.exec("PRAGMA journal_mode = WAL");
  runMigrations(db);
  tryAcquireLease(db, "old-server", Date.now()); // captured in the snapshot
  vacuumInto(db, snapshot);
  db.prepare("DELETE FROM meta WHERE key = ?").run(LEASE_KEY);
  db.prepare("INSERT INTO meta (key, value) VALUES ('after_snapshot', 'yes')")
    .run();
  db.close();
  return { dataDir, live, snapshot };
}

const liveMarker = (live: string) => meta(live, "after_snapshot");

Deno.test("restore - replaces the live DB, keeps the old one, new epoch", async () => {
  const { dataDir, live, snapshot } = await setup();
  try {
    const snapshotEpoch = meta(snapshot, "epoch");
    const now = new Date("2026-10-08T14:05:00Z");
    const r = restoreDatabase({ file: snapshot, dataDir, now });

    assertEquals(liveMarker(live), undefined); // the snapshot's contents now
    assertEquals(r.schemaVersion, latestMigrationVersion());
    assertEquals(
      r.replacedCopy,
      path.join(dataDir, "backups", "replaced-20261008-1405.sqlite"),
    );
    assertEquals(liveMarker(r.replacedCopy!), "yes"); // never deleted
    assertNotEquals(meta(live, "epoch"), snapshotEpoch);
    assertEquals(meta(live, "epoch"), r.epoch);
    assertEquals(meta(live, LEASE_KEY), undefined);
    assert(!fs.existsSync(`${live}.restoring`));

    // A second restore in the same minute keeps both replaced copies
    const r2 = restoreDatabase({ file: snapshot, dataDir, now });
    assertEquals(
      path.basename(r2.replacedCopy!),
      "replaced-20261008-1405-2.sqlite",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("restore - refuses and changes nothing when a precondition fails", async () => {
  const { dataDir, live, snapshot } = await setup();
  try {
    const refused = (file: string, extra: { latestVersion?: number } = {}) => {
      assertThrows(
        () => restoreDatabase({ file, dataDir, ...extra }),
        CliRefusal,
      );
      assertEquals(liveMarker(live), "yes", "live DB must be untouched");
      assert(!fs.existsSync(path.join(dataDir, "backups")));
    };

    // Missing file, the live DB itself, not SQLite, not an Emo database
    refused(path.join(dataDir, "nope.sqlite"));
    refused(live);
    const junk = path.join(dataDir, "junk.sqlite");
    Deno.writeFileSync(junk, crypto.getRandomValues(new Uint8Array(8192)));
    refused(junk);
    const foreign = path.join(dataDir, "foreign.sqlite");
    new DatabaseSync(foreign).exec("CREATE TABLE t (x)");
    refused(foreign);

    // Snapshot newer than this binary
    refused(snapshot, { latestVersion: 0 });

    // A running server holds the lease
    const db = new DatabaseSync(live);
    tryAcquireLease(db, "running-server");
    db.close();
    refused(snapshot);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("restore - an expired lease (crashed server) does not block", async () => {
  const { dataDir, live, snapshot } = await setup();
  try {
    const db = new DatabaseSync(live);
    tryAcquireLease(db, "crashed", Date.now() - 10 * 60_000);
    db.close();
    restoreDatabase({ file: snapshot, dataDir });
    assertEquals(liveMarker(live), undefined);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("restore - stamp is YYYYMMDD-HHMM in UTC", () => {
  assertEquals(stamp(new Date("2026-01-02T03:04:59Z")), "20260102-0304");
});
