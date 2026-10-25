// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../db/index.ts";
import { maintenanceDue, runMaintenance } from "./maintenance.ts";
import { SchedulerService } from "./scheduler.ts";
import type { PushService } from "./push.ts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function setup() {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number })
      .n;
  return { db, count };
}

Deno.test("maintenance - purges what has expired and keeps the rest", () => {
  const { db, count } = setup();
  const now = Date.parse("2026-10-08T12:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  db.prepare(`
    INSERT INTO accounts (id, email_enc, email_hmac, tz, locale, wake_start, wake_end, reminders_per_day, min_gap_min, created_at)
    VALUES ('a', x'00', x'01', 'UTC', 'en', '09:00', '22:00', 3, 120, ?)
  `).run(iso(now));
  const session = db.prepare(`
    INSERT INTO sessions (id, token_hash, account_id, user_agent, created_at, last_seen_at, expires_at)
    VALUES (?, ?, 'a', 'ua', ?, ?, ?)
  `);
  session.run("s1", "t1", iso(now), iso(now), iso(now - HOUR));
  session.run("s2", "t2", iso(now), iso(now), iso(now + DAY));
  const code = db.prepare(`
    INSERT INTO login_codes (id, email_hmac, code_hash, attempts, invite_hash, expires_at, created_at)
    VALUES (?, ?, 'h', 0, NULL, ?, ?)
  `);
  code.run("c1", new Uint8Array([1]), iso(now - 1), iso(now));
  code.run("c2", new Uint8Array([2]), iso(now + 600_000), iso(now));
  const gone = db.prepare(
    "INSERT INTO gone_sessions (token_hash, deleted_at) VALUES (?, ?)",
  );
  gone.run("g1", iso(now - 91 * DAY));
  gone.run("g2", iso(now - 89 * DAY));
  const counter = db.prepare(
    "INSERT INTO ops_counters (ts, name, value) VALUES (?, 'push_failed', 1)",
  );
  counter.run(iso(now - 49 * HOUR));
  counter.run(iso(now - 47 * HOUR));

  const entry = db.prepare(`
    INSERT INTO entries (id, account_id, seq, key_version, nonce, ciphertext, deleted, received_at)
    VALUES (?, 'a', ?, 1, NULL, NULL, ?, ?)
  `);
  entry.run("e-old-tomb", 1, 1, iso(now - 91 * DAY));
  entry.run("e-recent-tomb", 2, 1, iso(now - 89 * DAY));
  entry.run("e-active", 3, 0, iso(now - 100 * DAY));

  assertEquals(maintenanceDue(db, now), true);
  const invite = db.prepare(`
    INSERT INTO invites (code_hash, code_enc, created_by, created_at, expires_at, max_uses, uses)
    VALUES (?, x'01', NULL, ?, ?, 1, 0)
  `);
  invite.run("expired", iso(now - DAY), iso(now - HOUR));
  invite.run("valid", iso(now), iso(now + DAY));
  assertEquals(runMaintenance(db, now), {
    sessions: 1,
    login_codes: 1,
    gone_sessions: 1,
    ops_counters: 1,
    invite_codes: 1,
    entry_tombstones: 1,
  });
  assertEquals(
    db.prepare("SELECT code_hash FROM invites WHERE code_enc IS NOT NULL").all()
      .map((r) => (r as { code_hash: string }).code_hash),
    ["valid"],
  );
  assertEquals(count("entries"), 2, "entries");
  for (
    const t of ["sessions", "login_codes", "gone_sessions", "ops_counters"]
  ) {
    assertEquals(count(t), 1, t);
  }
  assertEquals(maintenanceDue(db, now + 5 * HOUR), false);
  assertEquals(maintenanceDue(db, now + 6 * HOUR), true);
});

Deno.test("maintenance - the scheduler runs it every 6 h and samples its lag", async () => {
  const { db } = setup();
  const scheduler = new SchedulerService(db, {} as PushService, {
    holder: "test",
  });
  const t0 = Date.parse("2026-10-08T12:00:00Z");
  const lastRun = () =>
    (db.prepare("SELECT value FROM meta WHERE key = 'maintenance_at'")
      .get() as { value: string } | undefined)?.value;

  assertEquals(await scheduler.tick(new Date(t0)), "ran");
  assertEquals(lastRun(), new Date(t0).toISOString());
  // 5 s late against the 60 s interval
  assertEquals(await scheduler.tick(new Date(t0 + 65_000)), "ran");
  assertEquals(lastRun(), new Date(t0).toISOString());
  const lags = db.prepare(
    "SELECT value FROM ops_counters WHERE name = 'tick_lag_ms'",
  ).all() as Array<{ value: number }>;
  assertEquals(lags.map((l) => l.value), [5000]);

  assertEquals(await scheduler.tick(new Date(t0 + 6 * HOUR)), "ran");
  assertEquals(lastRun(), new Date(t0 + 6 * HOUR).toISOString());
  await scheduler.stop();
});
