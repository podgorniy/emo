// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * performance.md §1.3, §4.5: a scheduler tick at the design ceiling
 * (5 000 accounts) stays under 200 ms p95. Two ticks: one while every
 * account starts its day at once (the worst case: everyone in one time zone;
 * a tick plans at most 1 000 of them), and a peak minute with 100 reminders
 * due. Push is a no-op here; real sends
 * run concurrently (pool of 20) and are bounded by their 10 s timeout.
 */
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../db/index.ts";
import { SchedulerService } from "./scheduler.ts";
import type { PushResult, PushService } from "./push.ts";

const ACCOUNTS = 5000;
const NOON = Date.parse("2026-10-08T12:00:00Z");
const push = {
  sendNotification: (): Promise<PushResult> =>
    Promise.resolve({
      ok: true,
      shouldRemove: false,
      isTransientFailure: false,
    }),
} as unknown as PushService;

function ceilingDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const account = db.prepare(`
    INSERT INTO accounts (id, email_enc, email_hmac, tz, locale, wake_start, wake_end, reminders_per_day, min_gap_min, created_at)
    VALUES (?, x'00', ?, 'UTC', 'en', '00:00', '23:59', 3, 120, '2026-10-01T00:00:00Z')
  `);
  const sub = db.prepare(`
    INSERT INTO push_subscriptions (id, account_id, endpoint, p256dh, auth, user_agent, created_at)
    VALUES (?, ?, ?, 'p', 'a', 'bench', '2026-10-01T00:00:00Z')
  `);
  db.exec("BEGIN");
  for (let i = 0; i < ACCOUNTS; i++) {
    const id = crypto.randomUUID();
    account.run(id, crypto.getRandomValues(new Uint8Array(16)));
    sub.run(crypto.randomUUID(), id, `https://push.example/${i}`);
  }
  db.exec("COMMIT");
  return db;
}

Deno.bench({
  name: "tick while 5 000 accounts start their day (≤ 200 ms p95)",
  n: 10,
  warmup: 1,
  async fn(b) {
    const db = ceilingDb();
    const scheduler = new SchedulerService(db, push, { holder: "bench" });
    b.start();
    await scheduler.tick(new Date(NOON));
    b.end();
    await scheduler.stop();
  },
});

Deno.bench({
  name: "peak minute: 100 reminders due among 5 000 accounts (≤ 200 ms p95)",
  n: 10,
  warmup: 1,
  async fn(b) {
    const db = ceilingDb();
    const scheduler = new SchedulerService(db, push, { holder: "bench" });
    // Plan everyone's day (1 000 accounts a tick)
    for (let i = 0; i < 5; i++) {
      await scheduler.tick(new Date(NOON + i * 60_000));
    }
    // 100 of today's rows fall due in the next minute
    db.prepare(`
      UPDATE reminders SET scheduled_for = ?
      WHERE id IN (SELECT id FROM reminders WHERE status = 'planned' LIMIT 100)
    `).run(new Date(NOON + 5 * 60_000 + 30_000).toISOString());
    b.start();
    await scheduler.tick(new Date(NOON + 6 * 60_000));
    b.end();
    await scheduler.stop();
  },
});
