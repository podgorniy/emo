// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reminder scheduling and dispatching service.
 * Specification: architecture.md §9.1–§9.2, reliability.md §1.5–§1.6 and §2,
 * performance.md §4.3.
 */

import type { DatabaseSync } from "node:sqlite";
import { tx } from "../db/index.ts";
import { generateUuidV4 } from "../crypto.ts";
import { logger } from "../log.ts";
import { releaseLease, tryAcquireLease } from "./lease.ts";
import { countOps } from "./ops_counters.ts";
import { maintenanceDue, runMaintenance } from "./maintenance.ts";
import type { PushResult, PushService } from "./push.ts";
import { pushTitle } from "../../shared/i18n/push.ts";
import type { Locale } from "../../shared/protocol.ts";

const MINUTE_MS = 60_000;

/** A planned reminder is retried this long, then never sent late. */
export const RETRY_WINDOW_MS = 30 * MINUTE_MS;
/** Today's schedule is generated from `wake_start − 1 h` on. */
export const GENERATE_LEAD_MS = 60 * MINUTE_MS;
/** Less than this left of today's window: no reminders today. */
export const MIN_REMAINING_MS = 60 * MINUTE_MS;
/** A late schedule starts no sooner than this after now. */
export const LATE_START_PAD_MS = 5 * MINUTE_MS;
/** `/healthz` is unhealthy when the last tick finished longer ago. */
export const LAG_HIGH_SEC = 180;

const SAMPLE_ATTEMPTS = 1000;
const SEND_CONCURRENCY = 20;
const DUE_LIMIT = 500;
const DROP_AFTER_FAILURES = 5;
const STANDBY_LOG_INTERVAL_MS = 10 * MINUTE_MS;

export interface AccountSettingsRow {
  id: string;
  tz: string;
  locale: string;
  wake_start: string;
  wake_end: string;
  reminders_per_day: number;
  min_gap_min: number;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failed_count: number;
}

interface DueRow {
  id: string;
  account_id: string;
  locale: string;
  scheduled_for: string;
  /** The account's pause, if any (architecture.md §9.1) */
  paused_until: string | null;
}

export type TickOutcome = "ran" | "skipped" | "standby";

/** The local calendar date (`YYYY-MM-DD`) of an instant in `tz`. */
export function localDateIn(tz: string, atMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(atMs)
    .toZonedDateTimeISO(tz)
    .toPlainDate()
    .toString();
}

/** `HH:MM` on `localDate` in `tz` as epoch ms. A time skipped by a DST jump
 * resolves to the next valid instant, a repeated one to the earlier
 * (reliability.md §2.2) — Temporal's "compatible" disambiguation. */
export function localTimeToMs(
  localDate: string,
  tz: string,
  hhmm: string,
): number {
  return Temporal.PlainDate.from(localDate)
    .toZonedDateTime({ timeZone: tz, plainTime: Temporal.PlainTime.from(hhmm) })
    .epochMilliseconds;
}

/** The wake window of `localDate` in `tz`, as real instants (a DST day may
 * make it an hour shorter or longer). */
export function wakeWindowMs(
  localDate: string,
  tz: string,
  wakeStart: string,
  wakeEnd: string,
): { startMs: number; endMs: number } {
  return {
    startMs: localTimeToMs(localDate, tz, wakeStart),
    endMs: localTimeToMs(localDate, tz, wakeEnd),
  };
}

/**
 * `count` whole-minute moments in `[startMs, endMs]`, pairwise at least
 * `gapMin` apart, sorted; fewer when the window cannot hold `count`
 * (architecture.md §9.1). When the window holds `count × gapMin`, every moment is
 * uniform over the whole window (`circularMoments`), so each hour of it is
 * sampled as often as any other (methodology.md §5.4). A shorter
 * window keeps its count with rejection sampling, which favours the first and
 * last hour; after 1000 misses its fallback places `count` uniform points in
 * the window shrunk by the gaps and shifts the i-th by i gaps, which samples
 * the same distribution and can never break `min_gap`.
 */
export function sampleMoments(
  startMs: number,
  endMs: number,
  count: number,
  gapMin: number,
  random: () => number = Math.random,
): number[] {
  const first = Math.ceil(startMs / MINUTE_MS);
  const last = Math.floor(endMs / MINUTE_MS);
  const span = last - first;
  if (span < 0 || count <= 0) return [];
  const n = Math.min(count, Math.floor(span / gapMin) + 1);
  const pick = (range: number) => Math.floor(random() * (range + 1));

  const circle = span + 1;
  if (n >= 2 && n * gapMin <= circle) {
    return circularMoments(first, circle, n, gapMin, pick);
  }

  for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
    const minutes = Array.from({ length: n }, () => first + pick(span))
      .sort((a, b) => a - b);
    if (minutes.every((m, i) => i === 0 || m - minutes[i - 1] >= gapMin)) {
      return minutes.map((m) => m * MINUTE_MS);
    }
  }

  const slack = span - (n - 1) * gapMin;
  return Array.from({ length: n }, () => pick(slack))
    .sort((a, b) => a - b)
    .map((offset, i) => (first + offset + i * gapMin) * MINUTE_MS);
}

/**
 * `n` moments on the window's `circle` minutes bent into a ring: the gaps are
 * `gapMin` plus a share of the slack, uniform over the ways to share it, and
 * the set is turned by a uniform offset. Every moment is then uniform over
 * the window, and no two are closer than `gapMin` — across the ring's seam
 * too: the time before the first and after the last add up to at least that.
 */
function circularMoments(
  first: number,
  circle: number,
  n: number,
  gapMin: number,
  pick: (range: number) => number,
): number[] {
  // n − 1 distinct cut points among `slots` split the slack into n shares
  // (Floyd's algorithm)
  const slots = circle - n * gapMin + n - 1;
  const cuts = new Set<number>();
  for (let j = slots - (n - 1); j < slots; j++) {
    const t = pick(j);
    cuts.add(cuts.has(t) ? j : t);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const turn = pick(circle - 1);
  const minutes: number[] = [];
  let offset = 0;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    minutes.push((offset + turn) % circle);
    const cut = i < n - 1 ? sorted[i] : slots;
    offset += gapMin + cut - prev - 1;
    prev = cut;
  }
  return minutes.sort((a, b) => a - b).map((m) => (first + m) * MINUTE_MS);
}

/**
 * Today's moments for an account at `nowMs`, or null when it is too early to
 * generate them (before `wake_start − 1 h`). An empty array means the day is
 * skipped: under 60 minutes of the window remain (reliability.md §2.1).
 */
export function planMoments(
  account: AccountSettingsRow,
  localDate: string,
  nowMs: number,
  random: () => number = Math.random,
): number[] | null {
  const { startMs, endMs } = wakeWindowMs(
    localDate,
    account.tz,
    account.wake_start,
    account.wake_end,
  );
  if (nowMs < startMs - GENERATE_LEAD_MS) return null;
  if (endMs - Math.max(nowMs, startMs) < MIN_REMAINING_MS) return [];
  const from = nowMs > startMs ? nowMs + LATE_START_PAD_MS : startMs;
  return sampleMoments(
    from,
    endMs,
    account.reminders_per_day,
    account.min_gap_min,
    random,
  );
}

/**
 * A settings change mid-day (architecture.md §9.1, reliability.md §2.3):
 * the new settings drive generation from the next local day. Of today's
 * `planned` rows, the ones outside the new window, and the latest beyond
 * `new count − sent today`, are cancelled (`settings`); nothing is added.
 * Rows keep the tz that generated them; a new tz is `cancelForNewTz`'s.
 * Runs inside the caller's transaction; returns the number cancelled.
 */
export function cancelForNewSettings(
  db: DatabaseSync,
  accountId: string,
  next: { wake_start: string; wake_end: string; reminders_per_day: number },
  nowMs: number = Date.now(),
): number {
  const rows = db.prepare(`
    SELECT id, local_date, tz, scheduled_for FROM reminders
    WHERE account_id = ? AND status = 'planned' AND scheduled_for >= ?
    ORDER BY scheduled_for
  `).all(accountId, new Date(nowMs - RETRY_WINDOW_MS).toISOString()) as Array<
    { id: string; local_date: string; tz: string; scheduled_for: string }
  >;
  if (rows.length === 0) return 0;

  const cancel: string[] = [];
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.local_date}|${row.tz}`;
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }
  const sentOn = db.prepare(
    "SELECT COUNT(*) AS n FROM reminders WHERE account_id = ? AND local_date = ? AND status = 'sent'",
  );
  for (const dayRows of byDay.values()) {
    const { local_date, tz } = dayRows[0];
    const { startMs, endMs } = wakeWindowMs(
      local_date,
      tz,
      next.wake_start,
      next.wake_end,
    );
    const kept: string[] = [];
    for (const row of dayRows) {
      const at = Date.parse(row.scheduled_for);
      if (at < startMs || at > endMs) cancel.push(row.id);
      else kept.push(row.id);
    }
    const sent = (sentOn.get(accountId, local_date) as { n: number }).n;
    const allowed = Math.max(0, next.reminders_per_day - sent);
    cancel.push(...kept.slice(allowed));
  }

  return cancelRows(db, cancel, "settings", nowMs);
}

/**
 * The account moved to another time zone (architecture.md §9.3, reliability.md
 * §2.2). Of the `planned` rows, the ones that in the new tz fall outside the
 * wake window, or on another local date than they were planned for, are
 * cancelled (`tz_change`): travelling never brings a reminder at night or two
 * days' worth in one. The rest are sent as planned; a day left without rows
 * is planned again in the new tz (`planDue` passes over `tz_change` rows).
 * Runs inside the caller's transaction; returns the number cancelled.
 */
export function cancelForNewTz(
  db: DatabaseSync,
  accountId: string,
  next: { tz: string; wake_start: string; wake_end: string },
  nowMs: number = Date.now(),
): number {
  const rows = db.prepare(`
    SELECT id, local_date, scheduled_for FROM reminders
    WHERE account_id = ? AND status = 'planned' AND scheduled_for >= ?
  `).all(accountId, new Date(nowMs - RETRY_WINDOW_MS).toISOString()) as Array<
    { id: string; local_date: string; scheduled_for: string }
  >;
  const cancel = rows.filter((row) => {
    const at = Date.parse(row.scheduled_for);
    const date = localDateIn(next.tz, at);
    const { startMs, endMs } = wakeWindowMs(
      date,
      next.tz,
      next.wake_start,
      next.wake_end,
    );
    return date !== row.local_date || at < startMs || at > endMs;
  }).map((row) => row.id);
  return cancelRows(db, cancel, "tz_change", nowMs);
}

/** Why a `cancelled` row was never sent (`005_reminders_reason.sql`). */
export type CancelReason = "settings" | "overdue" | "no_device" | "tz_change";

function cancelRows(
  db: DatabaseSync,
  ids: string[],
  reason: CancelReason,
  nowMs: number,
): number {
  const update = db.prepare(
    "UPDATE reminders SET status = 'cancelled', reason = ?, updated_at = ? WHERE id = ?",
  );
  const nowIso = new Date(nowMs).toISOString();
  for (const id of ids) update.run(reason, nowIso, id);
  return ids.length;
}

/**
 * An account without a subscription still gets its schedule this long after
 * its last sent reminder: a device switched off leaves `no_device` rows, a
 * gap the reminder log shows (methodology.md §5.3), and an account
 * nobody uses stops growing rows after a month.
 */
export const NO_DEVICE_PLAN_MS = 30 * 86_400_000;

interface DayPlan {
  account: AccountSettingsRow;
  localDate: string;
  moments: number[];
}

/** Accounts whose new day is written in one transaction. */
const PLAN_WRITE_BATCH = 500;
/**
 * Accounts planned per tick: at the design ceiling (5 000 in one time zone)
 * the day is planned over 5 ticks, still an hour before the window opens,
 * and no tick blocks the event loop for long.
 */
const PLAN_PER_TICK = 1000;

export interface SchedulerOptions {
  /** Lease holder id; one per process. */
  holder?: string;
  random?: () => number;
}

export class SchedulerService {
  private db: DatabaseSync;
  private pushService: PushService;
  private random: () => number;
  readonly holder: string;

  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt: number | null = null;
  private busy: Promise<TickOutcome> | null = null;
  private lastTickAt: number | null = null;
  /** Start of the last tick that ran with the lease (for `tick_lag_ms`). */
  private lastRanAt: number | null = null;
  private intervalMs = MINUTE_MS;
  private lastStandbyLogAt = 0;
  private lagHighLogged = false;
  /**
   * `account_id → tz|local_date` already planned or skipped (a cache only).
   * With the tz in the key, a day emptied by a move to another time zone is
   * planned again (`cancelForNewTz`).
   */
  private doneDates = new Map<string, string>();
  /** Reminder id → subscriptions that failed it transiently. In memory: after
   * a restart an unsent reminder expires as `cancelled` instead of `failed`. */
  private failedSubs = new Map<string, Set<string>>();
  private countableFailedSubs = new Map<string, Set<string>>();

  constructor(
    db: DatabaseSync,
    pushService: PushService,
    options: SchedulerOptions = {},
  ) {
    this.db = db;
    this.pushService = pushService;
    this.random = options.random ?? Math.random;
    this.holder = options.holder ?? `${Deno.pid}-${generateUuidV4()}`;
  }

  /** When the last completed tick finished (ISO), or null before the first. */
  getLastTickAt(): string | null {
    return this.lastTickAt === null
      ? null
      : new Date(this.lastTickAt).toISOString();
  }

  /** Seconds since the last completed tick (or since start, before the
   * first), or null when the scheduler is not running in this process. */
  getLagSec(nowMs = Date.now()): number | null {
    const since = this.lastTickAt ?? this.startedAt;
    return since === null
      ? null
      : Math.max(0, Math.round((nowMs - since) / 1000));
  }

  start(intervalMs = MINUTE_MS) {
    if (this.timer !== null) return;
    this.startedAt = Date.now();
    this.intervalMs = intervalMs;
    const run = () => {
      this.checkLag();
      this.tick().catch((err) =>
        logger.error("scheduler_tick_failed", { err })
      );
    };
    run();
    this.timer = setInterval(run, intervalMs);
  }

  /** Stops ticking, waits for a running tick, and releases the lease. */
  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.busy?.catch(() => {});
    releaseLease(this.db, this.holder);
  }

  private checkLag() {
    const lag = this.getLagSec();
    if (lag !== null && lag > LAG_HIGH_SEC) {
      if (!this.lagHighLogged) {
        logger.error("scheduler_lag_high", { lag_sec: lag });
        this.lagHighLogged = true;
      }
    } else {
      this.lagHighLogged = false;
    }
  }

  /** One tick: skipped while the previous one runs, standby without the lease. */
  tick(now: Date = new Date()): Promise<TickOutcome> {
    if (this.busy) {
      logger.warn("scheduler_tick_skipped", {
        lag_ms: this.lastTickAt === null
          ? null
          : now.getTime() - this.lastTickAt,
      });
      return Promise.resolve("skipped");
    }
    this.busy = this.runTick(now.getTime()).finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async runTick(nowMs: number): Promise<TickOutcome> {
    const started = Date.now();
    if (!tryAcquireLease(this.db, this.holder, nowMs)) {
      if (nowMs - this.lastStandbyLogAt >= STANDBY_LOG_INTERVAL_MS) {
        logger.warn("scheduler_standby", {});
        this.lastStandbyLogAt = nowMs;
      }
      this.lastTickAt = Date.now();
      return "standby";
    }

    const heartbeat = setInterval(() => {
      try {
        if (!tryAcquireLease(this.db, this.holder, Date.now())) {
          logger.warn("scheduler_heartbeat_lost", { holder: this.holder });
        }
      } catch (err) {
        logger.error("scheduler_heartbeat_error", { err });
      }
    }, 30_000);

    try {
      // ops.md §5.4: how late this tick is against the interval
      if (this.lastRanAt !== null) {
        countOps(
          this.db,
          "tick_lag_ms",
          Math.max(0, nowMs - this.lastRanAt - this.intervalMs),
          nowMs,
        );
      }
      this.lastRanAt = nowMs;

      this.expireOverdue(nowMs);
      this.planDue(nowMs);
      await this.sendDue(nowMs);

      if (maintenanceDue(this.db, nowMs)) {
        try {
          runMaintenance(this.db, nowMs);
        } catch (err) {
          logger.error("maintenance_failed", { err });
        }
      }

      this.lastTickAt = Date.now();
      logger.debug("scheduler_tick", { dur_ms: this.lastTickAt - started });
      return "ran";
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Generates today's schedule for every account that has none yet and has a
   * subscription, or had a reminder sent in the last 30 days
   * (`NO_DEVICE_PLAN_MS`). Rows cancelled by a move to another tz don't count
   * as a schedule. The "no rows for this date" check and the inserts share
   * one `BEGIN IMMEDIATE` transaction, which keeps it to one schedule a day.
   */
  planDue(nowMs: number) {
    const accounts = this.db.prepare(`
      SELECT a.id, a.tz, a.locale, a.wake_start, a.wake_end,
             a.reminders_per_day, a.min_gap_min,
             (SELECT MAX(r.local_date) FROM reminders r
               WHERE r.account_id = a.id AND r.reason IS NOT 'tz_change')
               AS last_date
      FROM accounts a
      WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.account_id = a.id)
         OR EXISTS (SELECT 1 FROM reminders r
                    WHERE r.account_id = a.id AND r.status = 'sent'
                      AND r.sent_at >= ?)
    `).all(
      new Date(nowMs - NO_DEVICE_PLAN_MS).toISOString(),
    ) as unknown as Array<
      AccountSettingsRow & { last_date: string | null }
    >;

    // Sample first, then write in a few transactions with the statements
    // prepared once; at most PLAN_PER_TICK accounts a tick
    // (performance.md §1.3, `scheduler.bench.ts`)
    const plans: DayPlan[] = [];
    for (const account of accounts) {
      try {
        const localDate = localDateIn(account.tz, nowMs);
        if (account.last_date !== null && account.last_date >= localDate) {
          continue;
        }
        if (this.doneDates.get(account.id) === `${account.tz}|${localDate}`) {
          continue;
        }
        const plan = this.sampleDay(account, nowMs, localDate);
        if (plan) plans.push(plan);
        // The rest go in the next ticks, a minute apart
        if (plans.length >= PLAN_PER_TICK) break;
      } catch (err) {
        logger.error("reminders_plan_failed", { account_id: account.id, err });
      }
    }
    for (let i = 0; i < plans.length; i += PLAN_WRITE_BATCH) {
      this.writePlans(plans.slice(i, i + PLAN_WRITE_BATCH), nowMs);
    }
  }

  /**
   * Today's moments for one account, or null when there is nothing to write
   * (too early, or a day without room: then it is marked done).
   */
  private sampleDay(
    account: AccountSettingsRow,
    nowMs: number,
    localDate: string,
  ): DayPlan | null {
    const moments = planMoments(account, localDate, nowMs, this.random);
    if (moments === null) return null;
    if (moments.length === 0) {
      this.doneDates.set(account.id, `${account.tz}|${localDate}`);
      logger.info("reminders_skip_day", { account_id: account.id });
      return null;
    }
    return { account, localDate, moments };
  }

  /**
   * One transaction for several accounts; a day that has rows is left alone
   * (rows cancelled by a move to another tz don't count). Such a day keeps
   * those rows, so a moment drawn on one of their minutes (the unique index)
   * waits for the next tick's draw instead of failing the transaction.
   */
  private writePlans(plans: DayPlan[], nowMs: number): number {
    const nowIso = new Date(nowMs).toISOString();
    const redraw = new Set<string>();
    const written = tx(this.db, () => {
      const dayRows = this.db.prepare(
        "SELECT scheduled_for, reason FROM reminders WHERE account_id = ? AND local_date = ?",
      );
      const insert = this.db.prepare(`
        INSERT INTO reminders (id, account_id, local_date, tz, scheduled_for, status, updated_at)
        VALUES (?, ?, ?, ?, ?, 'planned', ?)
      `);
      let n = 0;
      for (const { account, localDate, moments } of plans) {
        const day = dayRows.all(account.id, localDate) as Array<
          { scheduled_for: string; reason: string | null }
        >;
        if (day.some((r) => r.reason !== "tz_change")) continue;
        const taken = new Set(day.map((r) => r.scheduled_for));
        if (moments.some((ms) => taken.has(new Date(ms).toISOString()))) {
          redraw.add(account.id);
          continue;
        }
        for (const ms of moments) {
          insert.run(
            generateUuidV4(),
            account.id,
            localDate,
            account.tz,
            new Date(ms).toISOString(),
            nowIso,
          );
        }
        n += moments.length;
      }
      return n;
    });
    for (const { account, localDate } of plans) {
      if (!redraw.has(account.id)) {
        this.doneDates.set(account.id, `${account.tz}|${localDate}`);
      }
    }
    return written;
  }

  planDayForAccount(
    account: AccountSettingsRow,
    nowMs: number = Date.now(),
    localDate: string = localDateIn(account.tz, nowMs),
  ): number {
    const plan = this.sampleDay(account, nowMs, localDate);
    return plan ? this.writePlans([plan], nowMs) : 0;
  }

  /**
   * `planned` rows past their retry window are never sent late: `failed` when
   * every subscription refused them, `cancelled` (`overdue`) when they were
   * never tried (the server was down).
   */
  expireOverdue(nowMs: number) {
    const cutoff = new Date(nowMs - RETRY_WINDOW_MS).toISOString();
    const nowIso = new Date(nowMs).toISOString();
    const rows = this.db.prepare(
      "SELECT id FROM reminders WHERE status = 'planned' AND scheduled_for < ?",
    ).all(cutoff) as Array<{ id: string }>;
    if (rows.length === 0) return;
    tx(this.db, () => {
      const update = this.db.prepare(
        "UPDATE reminders SET status = ?, reason = ?, updated_at = ? WHERE id = ?",
      );
      for (const { id } of rows) {
        const failed = this.failedSubs.get(id);
        const countable = this.countableFailedSubs.get(id);
        if (failed) update.run("failed", null, nowIso, id);
        else update.run("cancelled", "overdue", nowIso, id);
        if (countable) this.countFailures(countable);
        this.failedSubs.delete(id);
        this.countableFailedSubs.delete(id);
      }
    });
  }

  /** Sends every due `planned` reminder to all subscriptions of its account,
   * outside any transaction, at most 20 sends at a time. */
  async sendDue(nowMs: number) {
    const nowIso = new Date(nowMs).toISOString();
    const rows = this.db.prepare(`
      SELECT r.id, r.account_id, a.locale, r.scheduled_for,
             a.reminders_paused_until AS paused_until
      FROM reminders r JOIN accounts a ON a.id = r.account_id
      WHERE r.status = 'planned' AND r.scheduled_for <= ?
      ORDER BY r.scheduled_for
      LIMIT ${DUE_LIMIT}
    `).all(nowIso) as unknown as DueRow[];
    if (rows.length === 0) return;

    // A moment that falls inside the account's pause is never sent: it stays
    // in the reminder log as `paused`, an honest, analysable gap
    const isPaused = (r: DueRow) =>
      r.paused_until !== null && r.scheduled_for < r.paused_until;
    const paused = rows.filter(isPaused);
    if (paused.length > 0) {
      tx(this.db, () => {
        const mark = this.db.prepare(
          "UPDATE reminders SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'planned'",
        );
        for (const r of paused) mark.run(nowIso, r.id);
      });
      logger.info("reminders_paused", { n: paused.length });
    }
    const due = rows.filter((r) => !isPaused(r));
    if (due.length === 0) return;

    const subsOf = this.db.prepare(`
      SELECT id, endpoint, p256dh, auth, failed_count
      FROM push_subscriptions WHERE account_id = ?
    `);
    const jobs: Array<{ reminder: DueRow; sub: SubscriptionRow }> = [];
    const noSubs: string[] = [];
    for (const reminder of due) {
      const subs = subsOf.all(
        reminder.account_id,
      ) as unknown as SubscriptionRow[];
      if (subs.length === 0) noSubs.push(reminder.id);
      for (const sub of subs) jobs.push({ reminder, sub });
    }

    const results = await pool(
      jobs,
      SEND_CONCURRENCY,
      async ({ reminder, sub }) => {
        const started = Date.now();
        const res = await this.pushService.sendNotification(sub, {
          title: pushTitle(asLocale(reminder.locale)),
          url: `/now?reminder=${reminder.id}`,
          tag: "emo",
          renotify: true,
        });
        return { reminder, sub, res, dur_ms: Date.now() - started };
      },
    );

    this.recordResults(nowMs, results, noSubs);
  }

  private recordResults(
    nowMs: number,
    results: Array<
      {
        reminder: DueRow;
        sub: SubscriptionRow;
        res: PushResult;
        dur_ms: number;
      }
    >,
    noSubs: string[],
  ) {
    const nowIso = new Date(nowMs).toISOString();
    const byReminder = new Map<string, typeof results>();
    for (const r of results) {
      const list = byReminder.get(r.reminder.id) ?? [];
      list.push(r);
      byReminder.set(r.reminder.id, list);
    }

    tx(this.db, () => {
      const setStatus = this.db.prepare(
        "UPDATE reminders SET status = ?, reason = ?, sent_at = ?, updated_at = ? WHERE id = ? AND status = 'planned'",
      );
      const resetFailures = this.db.prepare(
        "UPDATE push_subscriptions SET failed_count = 0 WHERE id = ? AND failed_count > 0",
      );
      const dropSub = this.db.prepare(
        "DELETE FROM push_subscriptions WHERE id = ?",
      );

      for (const id of noSubs) {
        setStatus.run("cancelled", "no_device", null, nowIso, id);
      }

      for (const [reminderId, list] of byReminder) {
        const failed = this.failedSubs.get(reminderId) ?? new Set<string>();
        const countableFailed = this.countableFailedSubs.get(reminderId) ??
          new Set<string>();
        let anySuccess = false;
        for (const { sub, res, dur_ms } of list) {
          if (res.ok) {
            anySuccess = true;
            failed.delete(sub.id);
            countableFailed.delete(sub.id);
            resetFailures.run(sub.id);
            logger.info("push_sent", {
              account_id: list[0].reminder.account_id,
              dur_ms,
            });
          } else if (res.shouldRemove) {
            failed.delete(sub.id);
            countableFailed.delete(sub.id);
            dropSub.run(sub.id);
            countOps(this.db, "push_subscription_removed", 1, nowMs);
            logger.info("push_subscription_gone", {
              account_id: list[0].reminder.account_id,
              status: res.statusCode,
            });
          } else {
            failed.add(sub.id);
            // P1 - 5.1: Do not count global timeouts, connection errors, or 429 rate limits toward failed_count
            if (res.statusCode !== undefined && res.statusCode !== 429) {
              countableFailed.add(sub.id);
            }
            countOps(this.db, "push_failed", 1, nowMs);
            logger.warn("push_failed", {
              account_id: list[0].reminder.account_id,
              status: res.statusCode ?? null,
              err: res.error,
              dur_ms,
            });
          }
        }

        if (anySuccess) {
          setStatus.run("sent", null, nowIso, nowIso, reminderId);
          // The reminder is done, so the retry window of the ones that failed ends
          this.countFailures(countableFailed);
          this.failedSubs.delete(reminderId);
          this.countableFailedSubs.delete(reminderId);
        } else {
          if (failed.size > 0) {
            this.failedSubs.set(reminderId, failed);
            this.countableFailedSubs.set(reminderId, countableFailed);
            logger.warn("push_failed_all_subscriptions", {
              account_id: list[0].reminder.account_id,
            });
          } else {
            // Every subscription was gone: nothing left to send to
            setStatus.run("cancelled", "no_device", null, nowIso, reminderId);
            this.failedSubs.delete(reminderId);
            this.countableFailedSubs.delete(reminderId);
          }
        }
      }
    });
  }

  /** One failure per subscription per reminder; dropped at 5 (reliability.md §1.6). */
  private countFailures(subIds: Set<string>) {
    const bump = this.db.prepare(
      "UPDATE push_subscriptions SET failed_count = failed_count + 1 WHERE id = ?",
    );
    const drop = this.db.prepare(
      "DELETE FROM push_subscriptions WHERE id = ? AND failed_count >= ?",
    );
    for (const id of subIds) {
      bump.run(id);
      if (drop.run(id, DROP_AFTER_FAILURES).changes) {
        countOps(this.db, "push_subscription_removed");
      }
    }
  }
}

function asLocale(value: string): Locale {
  return value === "ru" || value === "uk" ? value : "en";
}

/** Runs `fn` over `items` with at most `limit` in flight; keeps input order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}
