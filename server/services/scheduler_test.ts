// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../db/index.ts";
import { setLogSink } from "../log.ts";
import { startTestServer, TEST_ORIGIN } from "../testing/harness.ts";
import type {
  PushNotificationPayload,
  PushResult,
  PushService,
} from "./push.ts";
import {
  type AccountSettingsRow,
  cancelForNewSettings,
  cancelForNewTz,
  localDateIn,
  localTimeToMs,
  planMoments,
  sampleMoments,
  SchedulerService,
  wakeWindowMs,
} from "./scheduler.ts";

const MIN = 60_000;
const KYIV = "Europe/Kyiv";

/** Silences the JSON log lines and keeps them for assertions. */
function captureLogs(): {
  lines: Array<Record<string, unknown>>;
  restore: () => void;
} {
  const lines: Array<Record<string, unknown>> = [];
  const restore = setLogSink((l) => lines.push(JSON.parse(l)));
  return { lines, restore };
}

class FakePush {
  calls: Array<{ endpoint: string; payload: PushNotificationPayload }> = [];
  results = new Map<string, PushResult>();
  sendNotification(
    sub: { endpoint: string },
    payload: PushNotificationPayload,
  ): Promise<PushResult> {
    this.calls.push({ endpoint: sub.endpoint, payload });
    return Promise.resolve(
      this.results.get(sub.endpoint) ??
        { ok: true, shouldRemove: false, isTransientFailure: false },
    );
  }
}

const TRANSIENT: PushResult = {
  ok: false,
  statusCode: 503,
  shouldRemove: false,
  isTransientFailure: true,
};
const GONE: PushResult = {
  ok: false,
  statusCode: 410,
  shouldRemove: true,
  isTransientFailure: false,
};

function account(over: Partial<AccountSettingsRow> = {}): AccountSettingsRow {
  return {
    id: crypto.randomUUID(),
    tz: KYIV,
    locale: "uk",
    wake_start: "09:00",
    wake_end: "22:00",
    reminders_per_day: 3,
    min_gap_min: 120,
    ...over,
  };
}

function setup() {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const push = new FakePush();
  const scheduler = new SchedulerService(db, push as unknown as PushService, {
    holder: "test",
  });
  const addAccount = (
    a: AccountSettingsRow,
    endpoints: string[] = ["https://push.example/1"],
  ) => {
    db.prepare(`
      INSERT INTO accounts (id, email_enc, email_hmac, tz, locale, wake_start, wake_end, reminders_per_day, min_gap_min, created_at)
      VALUES (?, x'00', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      a.id,
      crypto.getRandomValues(new Uint8Array(8)),
      a.tz,
      a.locale,
      a.wake_start,
      a.wake_end,
      a.reminders_per_day,
      a.min_gap_min,
      new Date().toISOString(),
    );
    for (const endpoint of endpoints) {
      db.prepare(`
        INSERT INTO push_subscriptions (id, account_id, endpoint, p256dh, auth, user_agent, created_at)
        VALUES (?, ?, ?, 'p', 'a', 'test', ?)
      `).run(crypto.randomUUID(), a.id, endpoint, new Date().toISOString());
    }
    return a;
  };
  const reminders = (accountId: string) =>
    db.prepare(
      "SELECT id, local_date, tz, scheduled_for, status, reason, sent_at FROM reminders WHERE account_id = ? ORDER BY scheduled_for",
    ).all(accountId) as Array<
      {
        id: string;
        local_date: string;
        tz: string;
        scheduled_for: string;
        status: string;
        reason: string | null;
        sent_at: string | null;
      }
    >;
  return { db, push, scheduler, addAccount, reminders };
}

/** A local Kyiv wall time on 2026-10-08 (UTC+3) as epoch ms. */
const kyiv = (hhmm: string, date = "2026-10-08") =>
  localTimeToMs(date, KYIV, hhmm);

// --- Sampling ---------------------------------------------------------------

Deno.test("scheduler - sampled moments are inside the window and min_gap apart", () => {
  const start = kyiv("09:00");
  const end = kyiv("22:00");
  for (let run = 0; run < 2000; run++) {
    const count = 1 + (run % 6);
    const moments = sampleMoments(start, end, count, 120);
    assertEquals(moments.length, count);
    for (let i = 0; i < moments.length; i++) {
      assert(moments[i] >= start && moments[i] <= end);
      if (i > 0) assert(moments[i] - moments[i - 1] >= 120 * MIN);
    }
  }
});

Deno.test("scheduler - the fallback keeps min_gap when sampling keeps missing", () => {
  // 5 h hold 3 moments 2 h apart only on a line, so rejection sampling runs;
  // a generator that always returns the same value makes every attempt collide
  const moments = sampleMoments(
    kyiv("09:00"),
    kyiv("14:00"),
    3,
    120,
    () => 0.5,
  );
  assertEquals(moments.length, 3);
  for (let i = 1; i < moments.length; i++) {
    assert(moments[i] - moments[i - 1] >= 120 * MIN);
  }
  assert(moments[0] >= kyiv("09:00") && moments[2] <= kyiv("14:00"));
});

Deno.test("scheduler - a window with no slack gives moments exactly min_gap apart", () => {
  const start = kyiv("09:00");
  for (let run = 0; run < 200; run++) {
    const moments = sampleMoments(start, kyiv("15:00") - 1, 3, 120);
    assertEquals(moments.length, 3);
    assertEquals(moments[1] - moments[0], 120 * MIN);
    assertEquals(moments[2] - moments[1], 120 * MIN);
    assert(moments[0] >= start && moments[2] < kyiv("15:00"));
  }
});

Deno.test("scheduler - a narrow window holds fewer moments", () => {
  const moments = sampleMoments(kyiv("09:00"), kyiv("12:00"), 3, 120);
  assertEquals(moments.length, 2);
  assertEquals(sampleMoments(kyiv("12:00"), kyiv("11:00"), 3, 120), []);
});

Deno.test("scheduler - one moment a day covers the window uniformly (χ²)", () => {
  // 13 one-hour buckets, 10 000 runs; χ² critical value for 12 dof at p = 0.001 is 32.9
  const start = kyiv("09:00");
  const end = kyiv("22:00");
  const buckets = new Array(13).fill(0);
  const runs = 10_000;
  for (let i = 0; i < runs; i++) {
    const [m] = sampleMoments(start, end - 1, 1, 120);
    buckets[Math.floor((m - start) / (60 * MIN))]++;
  }
  const expected = runs / 13;
  const chi2 = buckets.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
  assert(chi2 < 32.9, `χ² = ${chi2.toFixed(1)}, buckets ${buckets}`);
});

Deno.test("scheduler - three moments a day cover the window uniformly (χ²)", () => {
  // methodology.md §5.4: every hour of the window as often as any
  // other. All 3 moments of 10 000 days pooled into 13 one-hour buckets; two
  // moments 2 h apart never share a bucket, so 32.9 (12 dof, p = 0.001) is
  // conservative. Rejection sampling over-samples the first and last hour by
  // about a third and fails this by far.
  const start = kyiv("09:00");
  const end = kyiv("22:00");
  const buckets = new Array(13).fill(0);
  const runs = 10_000;
  for (let i = 0; i < runs; i++) {
    for (const m of sampleMoments(start, end - 1, 3, 120)) {
      buckets[Math.floor((m - start) / (60 * MIN))]++;
    }
  }
  const expected = (runs * 3) / 13;
  const chi2 = buckets.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
  assert(chi2 < 32.9, `χ² = ${chi2.toFixed(1)}, buckets ${buckets}`);
});

// --- Generation -------------------------------------------------------------

Deno.test("scheduler - nothing is generated before wake_start − 1 h", () => {
  const a = account();
  assertEquals(planMoments(a, "2026-10-08", kyiv("07:59")), null);
  assertEquals(planMoments(a, "2026-10-08", kyiv("08:00"))?.length, 3);
});

Deno.test("scheduler - a late start samples only the rest of the window", () => {
  const a = account();
  const now = kyiv("17:30");
  const moments = planMoments(a, "2026-10-08", now)!;
  // 4 h 30 min left: room for 3 moments 2 h apart
  assertEquals(moments.length, 3);
  assert(moments[0] >= now + 5 * MIN);
  const fewer = planMoments(a, "2026-10-08", kyiv("19:30"))!;
  assertEquals(fewer.length, 2);
  assert(fewer[0] >= kyiv("19:35"));
});

Deno.test("scheduler - under 60 minutes left skips the day", () => {
  const a = account();
  assertEquals(planMoments(a, "2026-10-08", kyiv("21:01")), []);
  assertEquals(planMoments(a, "2026-10-08", kyiv("23:00")), []);
});

Deno.test("scheduler - one schedule per account per day", () => {
  const { scheduler, addAccount, reminders } = setup();
  const a = addAccount(account());
  assertEquals(scheduler.planDayForAccount(a, kyiv("09:30")), 3);
  assertEquals(scheduler.planDayForAccount(a, kyiv("09:31")), 0);
  scheduler.planDue(kyiv("10:00"));
  const rows = reminders(a.id);
  assertEquals(rows.length, 3);
  assert(rows.every((r) => r.local_date === "2026-10-08" && r.tz === KYIV));
  // Next local day gets its own schedule
  scheduler.planDue(kyiv("09:00", "2026-10-09"));
  assertEquals(reminders(a.id).length, 6);
});

Deno.test("scheduler - at most 1 000 accounts are planned a tick; the rest next tick", () => {
  const { db, scheduler, addAccount } = setup();
  db.exec("BEGIN");
  for (let i = 0; i < 1500; i++) {
    addAccount(account(), [`https://push.example/${i}`]);
  }
  db.exec("COMMIT");
  const planned = () =>
    (db.prepare("SELECT COUNT(DISTINCT account_id) AS n FROM reminders")
      .get() as {
        n: number;
      }).n;
  scheduler.planDue(kyiv("10:00"));
  assertEquals(planned(), 1000);
  scheduler.planDue(kyiv("10:01"));
  assertEquals(planned(), 1500);
});

Deno.test("scheduler - accounts without a subscription get no schedule", () => {
  const { scheduler, addAccount, reminders } = setup();
  const a = addAccount(account(), []);
  scheduler.planDue(kyiv("10:00"));
  assertEquals(reminders(a.id).length, 0);
});

Deno.test("scheduler - the local date follows the account tz", () => {
  // 23:30 UTC on Oct 8 is already Oct 9 in Kyiv and still Oct 8 in New York
  const at = Date.parse("2026-10-08T23:30:00Z");
  assertEquals(localDateIn(KYIV, at), "2026-10-09");
  assertEquals(localDateIn("America/New_York", at), "2026-10-08");
});

// --- DST (reliability.md §2.2) ------------------------------------------------

/** `skip`: a local time that does not exist on the spring day, and what it
 * resolves to; `rep`: a local time that happens twice on the fall day. */
const TRANSITIONS = [
  {
    tz: "Europe/Kyiv",
    spring: "2026-03-29",
    fall: "2026-10-25",
    skip: ["03:30", "04:30"],
    rep: "03:30",
  },
  {
    tz: "Europe/Kyiv",
    spring: "2027-03-28",
    fall: "2027-10-31",
    skip: ["03:30", "04:30"],
    rep: "03:30",
  },
  {
    tz: "Europe/Berlin",
    spring: "2026-03-29",
    fall: "2026-10-25",
    skip: ["02:30", "03:30"],
    rep: "02:30",
  },
  {
    tz: "Europe/Berlin",
    spring: "2027-03-28",
    fall: "2027-10-31",
    skip: ["02:30", "03:30"],
    rep: "02:30",
  },
  {
    tz: "America/New_York",
    spring: "2026-03-08",
    fall: "2026-11-01",
    skip: ["02:30", "03:30"],
    rep: "01:30",
  },
  {
    tz: "America/New_York",
    spring: "2027-03-14",
    fall: "2027-11-07",
    skip: ["02:30", "03:30"],
    rep: "01:30",
  },
];

const localHhmm = (tz: string, ms: number) =>
  Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tz)
    .toPlainTime().toString().slice(0, 5);

for (const { tz, spring, fall, skip, rep } of TRANSITIONS) {
  Deno.test(`scheduler - DST in ${tz}, ${spring.slice(0, 4)}`, () => {
    // Spring forward: a skipped time resolves to the next valid instant
    assertEquals(localHhmm(tz, localTimeToMs(spring, tz, skip[0])), skip[1]);
    // A window across the jump is an hour shorter in real time
    const short = wakeWindowMs(spring, tz, "00:00", "06:00");
    assertEquals(short.endMs - short.startMs, 5 * 60 * MIN);
    // Fall back: the window across the repeated hour is an hour longer, and
    // a repeated time resolves to the earlier instant
    const long = wakeWindowMs(fall, tz, "00:00", "06:00");
    assertEquals(long.endMs - long.startMs, 7 * 60 * MIN);
    const hourBefore = `${
      String(Number(rep.slice(0, 2)) - 1).padStart(2, "0")
    }${rep.slice(2)}`;
    assertEquals(
      localTimeToMs(fall, tz, rep) - localTimeToMs(fall, tz, hourBefore),
      60 * MIN,
    );
    // A normal wake window is unaffected, and its moments stay on that date
    for (const date of [spring, fall]) {
      const day = wakeWindowMs(date, tz, "09:00", "22:00");
      assertEquals(day.endMs - day.startMs, 13 * 60 * MIN);
      const moments = planMoments(
        account({ tz }),
        date,
        day.startMs - 30 * MIN,
      )!;
      assertEquals(moments.length, 3);
      assert(moments.every((m) => m >= day.startMs && m <= day.endMs));
      assert(moments.every((m) => localDateIn(tz, m) === date));
    }
  });
}

// --- Ticks, lease and sending -------------------------------------------------

Deno.test("scheduler - a due reminder is sent once with the spec payload", async () => {
  const logs = captureLogs();
  try {
    const { scheduler, push, addAccount, reminders } = setup();
    const a = addAccount(account());
    scheduler.planDayForAccount(a, kyiv("08:30"));
    const [first] = reminders(a.id);
    const at = Date.parse(first.scheduled_for);

    assertEquals(await scheduler.tick(new Date(at - MIN)), "ran");
    assertEquals(push.calls.length, 0); // the journal's future is not sent

    assertEquals(await scheduler.tick(new Date(at)), "ran");
    assertEquals(push.calls.length, 1);
    assertEquals(push.calls[0].payload, {
      title: "Що в тілі?",
      url: `/now?reminder=${first.id}`,
      tag: "emo",
      renotify: true,
    });
    const sent = reminders(a.id)[0];
    assertEquals(sent.status, "sent");
    assertEquals(sent.sent_at, new Date(at).toISOString());

    await scheduler.tick(new Date(at + MIN));
    assertEquals(push.calls.length, 1);
    assert(logs.lines.some((l) => l.msg === "push_sent"));
  } finally {
    logs.restore();
  }
});

Deno.test("scheduler - after downtime past reminders are cancelled, not sent late", async () => {
  const logs = captureLogs();
  try {
    const { scheduler, push, addAccount, reminders } = setup();
    const a = addAccount(account());
    scheduler.planDayForAccount(a, kyiv("08:30"));
    const rows = reminders(a.id);
    // The server comes back 31 minutes after the last one was due
    const back = Date.parse(rows[2].scheduled_for) + 31 * MIN;
    await scheduler.tick(new Date(back));
    assertEquals(push.calls.length, 0);
    assertEquals(reminders(a.id).map((r) => [r.status, r.reason]), [
      ["cancelled", "overdue"],
      ["cancelled", "overdue"],
      ["cancelled", "overdue"],
    ]);
  } finally {
    logs.restore();
  }
});

Deno.test("scheduler - a refused push is retried for 30 minutes, then failed", async () => {
  const logs = captureLogs();
  try {
    const { db, scheduler, push, addAccount, reminders } = setup();
    const a = addAccount(account({ reminders_per_day: 1 }));
    push.results.set("https://push.example/1", TRANSIENT);
    scheduler.planDayForAccount(a, kyiv("08:30"));
    const at = Date.parse(reminders(a.id)[0].scheduled_for);

    for (let m = 0; m <= 30; m += 10) {
      await scheduler.tick(new Date(at + m * MIN));
    }
    assertEquals(push.calls.length, 4);
    assertEquals(reminders(a.id)[0].status, "planned");
    const failedCount = () =>
      (db.prepare("SELECT failed_count FROM push_subscriptions").get() as {
        failed_count: number;
      })
        .failed_count;
    assertEquals(failedCount(), 0); // counted per reminder, not per attempt

    await scheduler.tick(new Date(at + 31 * MIN));
    assertEquals(reminders(a.id)[0].status, "failed");
    assertEquals(failedCount(), 1);
    assert(logs.lines.some((l) => l.msg === "push_failed_all_subscriptions"));
  } finally {
    logs.restore();
  }
});

Deno.test("scheduler - one accepting device makes it sent; gone ones are dropped", async () => {
  const logs = captureLogs();
  try {
    const { db, scheduler, push, addAccount, reminders } = setup();
    const a = addAccount(account({ reminders_per_day: 1 }), [
      "https://push.example/ok",
      "https://push.example/gone",
      "https://push.example/flaky",
    ]);
    push.results.set("https://push.example/gone", GONE);
    push.results.set("https://push.example/flaky", TRANSIENT);
    db.prepare(
      "UPDATE push_subscriptions SET failed_count = 4 WHERE endpoint = ?",
    )
      .run("https://push.example/flaky");
    scheduler.planDayForAccount(a, kyiv("08:30"));
    await scheduler.tick(
      new Date(Date.parse(reminders(a.id)[0].scheduled_for)),
    );

    assertEquals(reminders(a.id)[0].status, "sent");
    const left = db.prepare(
      "SELECT endpoint FROM push_subscriptions ORDER BY endpoint",
    ).all()
      .map((r) => (r as { endpoint: string }).endpoint);
    // Gone is deleted at once; the flaky one reached 5 failures and is dropped
    assertEquals(left, ["https://push.example/ok"]);
  } finally {
    logs.restore();
  }
});

Deno.test("scheduler - with no subscription left a due reminder is cancelled", async () => {
  const logs = captureLogs();
  try {
    const { db, scheduler, push, addAccount, reminders } = setup();
    const a = addAccount(account({ reminders_per_day: 1 }));
    scheduler.planDayForAccount(a, kyiv("08:30"));
    db.prepare("DELETE FROM push_subscriptions").run();
    await scheduler.tick(
      new Date(Date.parse(reminders(a.id)[0].scheduled_for)),
    );
    assertEquals(push.calls.length, 0);
    assertEquals(reminders(a.id)[0].status, "cancelled");
    assertEquals(reminders(a.id)[0].reason, "no_device");
  } finally {
    logs.restore();
  }
});

Deno.test("scheduler - only the lease holder ticks", async () => {
  const logs = captureLogs();
  try {
    const { db, scheduler, push, addAccount, reminders } = setup();
    const second = new SchedulerService(db, push as unknown as PushService, {
      holder: "other",
    });
    const a = addAccount(account());
    const now = new Date(kyiv("09:00"));
    assertEquals(await scheduler.tick(now), "ran");
    assertEquals(await second.tick(now), "standby");
    assertEquals(reminders(a.id).length, 3);
    assertEquals(
      logs.lines.filter((l) => l.msg === "scheduler_standby").length,
      1,
    );
    await second.tick(new Date(now.getTime() + MIN));
    assertEquals(
      logs.lines.filter((l) => l.msg === "scheduler_standby").length,
      1,
    ); // every 10 min
    await scheduler.stop(); // releases the lease
    assertEquals(await second.tick(new Date(now.getTime() + 2 * MIN)), "ran");
  } finally {
    logs.restore();
  }
});

Deno.test("scheduler - a tick is skipped while the previous one runs", async () => {
  const logs = captureLogs();
  try {
    const { db, addAccount } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowPush = {
      async sendNotification() {
        await gate;
        return { ok: true, shouldRemove: false, isTransientFailure: false };
      },
    };
    const scheduler = new SchedulerService(
      db,
      slowPush as unknown as PushService,
      { holder: "t" },
    );
    const a = addAccount(account({ reminders_per_day: 1 }));
    scheduler.planDayForAccount(a, kyiv("08:30"));
    const due = new Date(kyiv("23:00") - 40 * MIN);
    db.prepare("UPDATE reminders SET scheduled_for = ?").run(due.toISOString());

    const first = scheduler.tick(due);
    assertEquals(await scheduler.tick(due), "skipped");
    assert(logs.lines.some((l) => l.msg === "scheduler_tick_skipped"));
    release();
    assertEquals(await first, "ran");
    assert(scheduler.getLastTickAt() !== null);
  } finally {
    logs.restore();
  }
});

// --- Settings change mid-day (reliability.md §2.3) ---------------------------

Deno.test("scheduler - a mid-day settings change cancels only what no longer fits", async () => {
  const logs = captureLogs();
  try {
    const { db, scheduler, addAccount, reminders } = setup();
    const a = addAccount(account({ reminders_per_day: 4 }));
    // 10:00, 13:00, 16:00, 19:00; the first has been sent
    scheduler.planDayForAccount(a, kyiv("08:30"));
    const times = ["10:00", "13:00", "16:00", "19:00"].map((t) =>
      new Date(kyiv(t)).toISOString()
    );
    reminders(a.id).forEach((r, i) =>
      db.prepare("UPDATE reminders SET scheduled_for = ? WHERE id = ?").run(
        times[i],
        r.id,
      )
    );
    const firstId = reminders(a.id)[0].id;
    db.prepare("UPDATE reminders SET status = 'sent', sent_at = ? WHERE id = ?")
      .run(times[0], firstId);
    const now = kyiv("11:00");

    // Same settings: nothing changes
    assertEquals(cancelForNewSettings(db, a.id, a, now), 0);
    // A window ending at 18:00 drops 19:00
    assertEquals(
      cancelForNewSettings(db, a.id, { ...a, wake_end: "18:00" }, now),
      1,
    );
    // Two a day with one already sent: only 13:00 is left of the rest
    assertEquals(
      cancelForNewSettings(db, a.id, {
        ...a,
        wake_end: "18:00",
        reminders_per_day: 2,
      }, now),
      1,
    );
    assertEquals(reminders(a.id).map((r) => [r.status, r.reason]), [
      ["sent", null],
      ["planned", null],
      ["cancelled", "settings"],
      ["cancelled", "settings"],
    ]);
    // Nothing new today
    await scheduler.tick(new Date(now));
    assertEquals(reminders(a.id).length, 4);
  } finally {
    logs.restore();
  }
});

Deno.test("scheduler - a move to another tz cancels night and next-day moments; an emptied day is planned again", () => {
  const { db, scheduler, addAccount, reminders } = setup();
  const NY = "America/New_York";
  const setTimes = (id: string, times: number[]) =>
    reminders(id).forEach((r, i) =>
      db.prepare("UPDATE reminders SET scheduled_for = ? WHERE id = ?").run(
        new Date(times[i]).toISOString(),
        r.id,
      )
    );
  const moveTo = (id: string, tz: string, now: number) => {
    db.prepare("UPDATE accounts SET tz = ? WHERE id = ?").run(tz, id);
    return cancelForNewTz(
      db,
      id,
      { tz, wake_start: "09:00", wake_end: "22:00" },
      now,
    );
  };

  // West, Kyiv → New York at 09:30 Kyiv (02:30 there): 10:00 and 13:00 Kyiv
  // would come at 03:00 and 06:00; 16:00 and 19:00 are 09:00 and 12:00
  const west = addAccount(account({ reminders_per_day: 4 }));
  scheduler.planDayForAccount(west, kyiv("08:30"));
  setTimes(west.id, ["10:00", "13:00", "16:00", "19:00"].map((t) => kyiv(t)));
  assertEquals(moveTo(west.id, NY, kyiv("09:30")), 2);
  assertEquals(reminders(west.id).map((r) => [r.status, r.reason]), [
    ["cancelled", "tz_change"],
    ["cancelled", "tz_change"],
    ["planned", null],
    ["planned", null],
  ]);
  // Today keeps the two left; tomorrow is planned in New York
  const ny = (hhmm: string, date: string) => localTimeToMs(date, NY, hhmm);
  scheduler.planDue(ny("09:00", "2026-10-08"));
  assertEquals(reminders(west.id).length, 4);
  scheduler.planDue(ny("08:00", "2026-10-09"));
  const nextDay = reminders(west.id).filter((r) =>
    r.local_date === "2026-10-09"
  );
  assertEquals(nextDay.length, 4);
  assert(nextDay.every((r) => r.tz === NY));

  // A day the move empties is planned again in the new tz, from now on
  const emptied = addAccount(account(), ["https://push.example/2"]);
  scheduler.planDayForAccount(emptied, kyiv("08:30"));
  setTimes(emptied.id, ["10:00", "12:30", "15:00"].map((t) => kyiv(t)));
  assertEquals(moveTo(emptied.id, NY, kyiv("09:30")), 3);
  scheduler.planDue(ny("09:00", "2026-10-08"));
  const replanned = reminders(emptied.id).filter((r) => r.status === "planned");
  assertEquals(replanned.length, 3);
  assert(replanned.every((r) => r.tz === NY && r.local_date === "2026-10-08"));
  assert(
    replanned.every((r) =>
      Date.parse(r.scheduled_for) >= ny("09:05", "2026-10-08")
    ),
  );

  // East, Los Angeles → Tokyo: LA's afternoon is already the next day there
  const LA = "America/Los_Angeles";
  const la = (hhmm: string) => localTimeToMs("2026-10-08", LA, hhmm);
  const east = addAccount(account({ tz: LA }), ["https://push.example/3"]);
  scheduler.planDayForAccount(east, la("08:30"));
  setTimes(east.id, [la("10:00"), la("14:00"), la("18:00")]);
  assertEquals(moveTo(east.id, "Asia/Tokyo", la("09:30")), 3);
  assert(reminders(east.id).every((r) => r.reason === "tz_change"));
  scheduler.planDue(localTimeToMs("2026-10-09", "Asia/Tokyo", "08:00"));
  assertEquals(
    reminders(east.id).filter((r) => r.status === "planned").length,
    3,
  );
});

Deno.test("scheduler - a moment drawn on a minute a move cancelled is drawn again next tick", () => {
  const { db, scheduler, addAccount, reminders } = setup();
  const NY = "America/New_York";
  const ny = (hhmm: string) => localTimeToMs("2026-10-08", NY, hhmm);
  const a = addAccount(account({ tz: NY }));
  // Every minute of the day's window is held by a row the move cancelled
  const insert = db.prepare(`
    INSERT INTO reminders (id, account_id, local_date, tz, scheduled_for, status, reason, updated_at)
    VALUES (?, ?, '2026-10-08', ?, ?, 'cancelled', 'tz_change', ?)
  `);
  db.exec("BEGIN");
  for (let at = ny("09:00"); at <= ny("22:00"); at += MIN) {
    insert.run(
      crypto.randomUUID(),
      a.id,
      KYIV,
      new Date(at).toISOString(),
      new Date(at).toISOString(),
    );
  }
  db.exec("COMMIT");
  const planned = () => reminders(a.id).filter((r) => r.status === "planned");

  scheduler.planDue(ny("08:30")); // no unique-index failure, nothing written
  assertEquals(planned().length, 0);
  db.prepare("DELETE FROM reminders WHERE reason = 'tz_change'").run();
  scheduler.planDue(ny("08:31"));
  assertEquals(planned().length, 3);
});

Deno.test("scheduler - a device switched off leaves no_device rows for 30 days", async () => {
  const logs = captureLogs();
  try {
    const { db, scheduler, addAccount, reminders } = setup();
    const a = addAccount(account({ reminders_per_day: 1 }));
    scheduler.planDayForAccount(a, kyiv("08:30"));
    await scheduler.tick(
      new Date(Date.parse(reminders(a.id)[0].scheduled_for)),
    );
    assertEquals(reminders(a.id)[0].status, "sent");

    db.prepare("DELETE FROM push_subscriptions").run();
    const day2 = "2026-10-09";
    await scheduler.tick(new Date(kyiv("08:30", day2)));
    const [next] = reminders(a.id).filter((r) => r.local_date === day2);
    await scheduler.tick(new Date(Date.parse(next.scheduled_for)));
    const [logged] = reminders(a.id).filter((r) => r.local_date === day2);
    assertEquals([logged.status, logged.reason], ["cancelled", "no_device"]);

    // A month after the last sent one, the account stops getting rows
    const later = "2026-11-09";
    scheduler.planDue(kyiv("08:30", later));
    assertEquals(
      reminders(a.id).filter((r) => r.local_date === later).length,
      0,
    );
  } finally {
    logs.restore();
  }
});

Deno.test("scheduler - PUT /api/settings with a same-offset tz keeps today", async () => {
  const server = startTestServer();
  const restore = server.installFetch();
  const logs = captureLogs();
  try {
    const { accountId } = await server.signUp("tz@example.org");
    // A planned row a little ahead, never in the last minute of a local day
    const lateEvening = localHhmm(KYIV, Date.now()) >= "23:50";
    const at = Date.now() + (lateEvening ? 30 : 2) * MIN;
    server.db.prepare(`
      INSERT INTO reminders (id, account_id, local_date, tz, scheduled_for, status, updated_at)
      VALUES (?, ?, ?, ?, ?, 'planned', ?)
    `).run(
      crypto.randomUUID(),
      accountId,
      localDateIn(KYIV, at),
      KYIV,
      new Date(at).toISOString(),
      new Date().toISOString(),
    );
    const put = (body: Record<string, unknown>) =>
      fetch(`${TEST_ORIGIN}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tz: KYIV,
          locale: "en",
          wake_start: "00:00",
          wake_end: "23:59",
          reminders_per_day: 3,
          min_gap_min: 120,
          ...body,
        }),
      });
    const status = () =>
      (server.db.prepare("SELECT status FROM reminders").get() as {
        status: string;
      }).status;

    // Helsinki keeps Kyiv's offset all year: the move cancels nothing (the
    // rule itself is tested above, without the wall clock)
    assertEquals((await put({})).status, 200);
    assertEquals(status(), "planned");
    assertEquals((await put({ tz: "Europe/Helsinki" })).status, 200);
    assertEquals(status(), "planned");
    assertEquals(
      (await put({ tz: "Europe/Helsinki", reminders_per_day: 1 })).status,
      200,
    );
    assertEquals(status(), "planned"); // 1 a day, none sent yet: it stays
  } finally {
    logs.restore();
    restore();
  }
});

Deno.test("scheduler - the journal never returns future rows", async () => {
  const server = startTestServer();
  const restore = server.installFetch();
  try {
    const { accountId } = await server.signUp("journal@example.org");
    const insert = server.db.prepare(`
      INSERT INTO reminders (id, account_id, local_date, tz, scheduled_for, sent_at, status, updated_at)
      VALUES (?, ?, '2026-10-08', ?, ?, ?, ?, ?)
    `);
    const past = new Date(Date.now() - 60 * MIN).toISOString();
    const future = new Date(Date.now() + 60 * MIN).toISOString();
    const pastId = crypto.randomUUID();
    insert.run(pastId, accountId, KYIV, past, past, "sent", past);
    insert.run(
      crypto.randomUUID(),
      accountId,
      KYIV,
      future,
      null,
      "planned",
      past,
    );
    const later = new Date(Date.now() + 120 * MIN).toISOString();
    insert.run(
      crypto.randomUUID(),
      accountId,
      KYIV,
      later,
      null,
      "cancelled",
      past,
    );

    const res = await fetch(`${TEST_ORIGIN}/api/reminders`);
    assertEquals(res.status, 200);
    const body = await res.json() as { items: Array<{ id: string }> };
    assertEquals(body.items.map((i) => i.id), [pastId]);
  } finally {
    restore();
  }
});

Deno.test("scheduler - a pause sends nothing and logs the moments as paused", async () => {
  const logs = captureLogs();
  try {
    const { db, scheduler, push, addAccount, reminders } = setup();
    const a = addAccount(account({ reminders_per_day: 2 }));
    scheduler.planDayForAccount(a, kyiv("08:30"));
    const [first, second] = reminders(a.id).map((r) =>
      Date.parse(r.scheduled_for)
    );
    // Paused until between the two moments
    const until = new Date(Math.round((first + second) / 2)).toISOString();
    db.prepare("UPDATE accounts SET reminders_paused_until = ? WHERE id = ?")
      .run(until, a.id);
    await scheduler.tick(new Date(first + MIN));
    assertEquals(push.calls.length, 0);
    assertEquals(reminders(a.id).map((r) => r.status), ["paused", "planned"]);
    // After the pause the next moment is sent as usual
    await scheduler.tick(new Date(second + MIN));
    assertEquals(push.calls.length, 1);
    assertEquals(reminders(a.id).map((r) => r.status), ["paused", "sent"]);
    assert(logs.lines.some((l) => l.msg === "reminders_paused"));
  } finally {
    logs.restore();
  }
});

Deno.test("settings - PUT and DELETE /api/settings/pause", async () => {
  const server = startTestServer();
  const restore = server.installFetch();
  try {
    await server.signUp("pause@example.org");
    const pause = (body: unknown) =>
      fetch(`${TEST_ORIGIN}/api/settings/pause`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const before = Date.now();
    const res = await pause({ days: 3 });
    assertEquals(res.status, 200);
    const until = Date.parse((await res.json()).reminders_paused_until);
    assert(Math.abs(until - (before + 3 * 24 * 60 * MIN)) < MIN, String(until));
    const got = await (await fetch(`${TEST_ORIGIN}/api/settings`)).json();
    assertEquals(Date.parse(got.reminders_paused_until), until);
    // Only 1, 3 or 7 days
    for (const days of [2, 0, "7", null]) {
      const bad = await pause({ days });
      assertEquals(bad.status, 400, String(days));
      assertEquals((await bad.json()).error.code, "invalid_field");
    }
    // Resume
    const resumed = await fetch(`${TEST_ORIGIN}/api/settings/pause`, {
      method: "DELETE",
    });
    assertEquals(resumed.status, 200);
    assertEquals((await resumed.json()).reminders_paused_until, null);
    // A pause that has ended reads as none
    server.db.prepare("UPDATE accounts SET reminders_paused_until = ?")
      .run(new Date(Date.now() - MIN).toISOString());
    const ended = await (await fetch(`${TEST_ORIGIN}/api/settings`)).json();
    assertEquals(ended.reminders_paused_until, null);
  } finally {
    restore();
  }
});

Deno.test("scheduler - network timeout or 429 does not increment subscription failed_count", async () => {
  const logs = captureLogs();
  try {
    const { db, scheduler, push, addAccount, reminders } = setup();
    const a = addAccount(account({ reminders_per_day: 1 }));
    // Simulate network timeout (no statusCode) and 429 rate limit
    push.results.set("https://push.example/1", {
      ok: false,
      statusCode: undefined,
      shouldRemove: false,
      isTransientFailure: true,
      error: "push send timed out",
    });
    scheduler.planDayForAccount(a, kyiv("08:30"));
    const at = Date.parse(reminders(a.id)[0].scheduled_for);

    for (let m = 0; m <= 30; m += 10) {
      await scheduler.tick(new Date(at + m * MIN));
    }
    const failedCount = () =>
      (db.prepare("SELECT failed_count FROM push_subscriptions").get() as {
        failed_count: number;
      }).failed_count;
    assertEquals(failedCount(), 0);

    // After 30m retry window, reminder expires as failed, but subscription failed_count stays 0
    await scheduler.tick(new Date(at + 31 * MIN));
    assertEquals(reminders(a.id)[0].status, "failed");
    assertEquals(failedCount(), 0);
  } finally {
    logs.restore();
  }
});
