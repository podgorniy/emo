// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Settings router: get and update open account settings and reminder window.
 * Specification: architecture.md §9.1, api.md §2.5.
 */

import { Hono } from "@hono/hono";
import { readJson } from "../http.ts";
import type { DatabaseSync } from "node:sqlite";
import {
  type AppEnv,
  type AuthAccount,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import { tx } from "../db/index.ts";
import { cancelForNewSettings, cancelForNewTz } from "../services/scheduler.ts";
import {
  PauseReqSchema,
  type SettingsGetRes,
  SettingsPutReqSchema,
} from "../../shared/protocol.ts";
import type { ApiError } from "../../shared/protocol.ts";

/** The account has had a push subscription in the last 3 days (api.md §2.5): it
 * has one now, or a reminder reached one of its devices since. */
function receivingReminders(db: DatabaseSync, accountId: string): boolean {
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const row = db.prepare(`
    SELECT EXISTS (SELECT 1 FROM push_subscriptions WHERE account_id = ?)
        OR EXISTS (SELECT 1 FROM reminders
                   WHERE account_id = ? AND status = 'sent' AND sent_at > ?) AS yes
  `).get(accountId, accountId, since) as { yes: number };
  return row.yes === 1;
}

/** The pause still running, or null (a pause that has ended reads as none). */
function pausedUntil(value: string | null, nowMs = Date.now()): string | null {
  return value && Date.parse(value) > nowMs ? value : null;
}

const DAY_MS = 24 * 3600 * 1000;

export function createSettingsRoutes(db: DatabaseSync) {
  const router = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(db);

  router.use("*", authMiddleware);

  // GET /api/settings
  router.get("/", (c) => {
    const account = c.get("account") as AuthAccount;

    const res: SettingsGetRes = {
      tz: account.tz,
      locale: account.locale,
      wake_start: account.wake_start,
      wake_end: account.wake_end,
      reminders_per_day: account.reminders_per_day,
      min_gap_min: account.min_gap_min,
      receiving_reminders: receivingReminders(db, account.id),
      reminders_paused_until: pausedUntil(account.reminders_paused_until),
    };

    return c.json(res, 200);
  });

  /**
   * PUT /api/settings/pause { days: 1 | 3 | 7 } — no reminder is sent to the
   * account until now + days; the moments planned meanwhile are logged as
   * `paused` (architecture.md §9.1). Replaces a pause already running.
   * DELETE /api/settings/pause — resume now. Both answer with the settings.
   */
  const setPause = (account: AuthAccount, until: string | null) => {
    db.prepare("UPDATE accounts SET reminders_paused_until = ? WHERE id = ?")
      .run(until, account.id);
    const res: SettingsGetRes = {
      tz: account.tz,
      locale: account.locale,
      wake_start: account.wake_start,
      wake_end: account.wake_end,
      reminders_per_day: account.reminders_per_day,
      min_gap_min: account.min_gap_min,
      receiving_reminders: receivingReminders(db, account.id),
      reminders_paused_until: until,
    };
    return res;
  };

  router.put("/pause", async (c) => {
    const body = await readJson(c, PauseReqSchema);
    if (body instanceof Response) return body;
    const until = new Date(Date.now() + body.days * DAY_MS).toISOString();
    return c.json(setPause(c.get("account") as AuthAccount, until), 200);
  });

  router.delete("/pause", (c) => {
    return c.json(setPause(c.get("account") as AuthAccount, null), 200);
  });

  // PUT /api/settings
  router.put("/", async (c) => {
    const body = await readJson(c, SettingsPutReqSchema);
    if (body instanceof Response) return body;

    const { tz, locale, wake_start, wake_end, reminders_per_day, min_gap_min } =
      body;

    try {
      if (!tz || typeof tz !== "string") {
        return c.json(
          {
            error: { code: "tz_unknown", message: "Timezone is required" },
          } satisfies ApiError,
          422,
        );
      }
      new Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      return c.json(
        {
          error: { code: "tz_unknown", message: `Invalid timezone: ${tz}` },
        } satisfies ApiError,
        422,
      );
    }

    if (locale !== "ru" && locale !== "uk" && locale !== "en") {
      return c.json(
        {
          error: {
            code: "locale_unsupported",
            message: `Unsupported locale: ${locale}`,
          },
        } satisfies ApiError,
        422,
      );
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(wake_start) || !timeRegex.test(wake_end)) {
      return c.json(
        {
          error: { code: "invalid_field", message: "Invalid wake time format" },
        } satisfies ApiError,
        400,
      );
    }

    const [startH, startM] = wake_start.split(":").map(Number);
    const [endH, endM] = wake_end.split(":").map(Number);
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    if (endTotal <= startTotal) {
      return c.json(
        {
          error: {
            code: "invalid_field",
            message: "wake_end must be after wake_start",
          },
        } satisfies ApiError,
        400,
      );
    }

    if (
      !Number.isInteger(reminders_per_day) || reminders_per_day < 1 ||
      reminders_per_day > 6
    ) {
      return c.json(
        {
          error: {
            code: "invalid_field",
            message: "reminders_per_day must be between 1 and 6",
          },
        } satisfies ApiError,
        400,
      );
    }

    if (
      !Number.isInteger(min_gap_min) || min_gap_min < 30 || min_gap_min > 240
    ) {
      return c.json(
        {
          error: {
            code: "invalid_field",
            message: "min_gap_min must be between 30 and 240",
          },
        } satisfies ApiError,
        400,
      );
    }

    const requiredSpan = (reminders_per_day - 1) * min_gap_min + 60;
    if (endTotal - startTotal < requiredSpan) {
      return c.json(
        {
          error: {
            code: "window_too_short",
            message:
              `Wake window is too short for ${reminders_per_day} reminders with ${min_gap_min}m gap`,
          },
        } satisfies ApiError,
        422,
      );
    }

    const account = c.get("account") as AuthAccount;

    tx(db, () => {
      db.prepare(`
        UPDATE accounts
        SET tz = ?, locale = ?, wake_start = ?, wake_end = ?, reminders_per_day = ?, min_gap_min = ?
        WHERE id = ?
      `).run(
        tz,
        locale,
        wake_start,
        wake_end,
        reminders_per_day,
        min_gap_min,
        account.id,
      );
      // A move first: the count rule below then sees only the rows kept
      if (tz !== account.tz) {
        cancelForNewTz(db, account.id, { tz, wake_start, wake_end });
      }
      const windowChanged = wake_start !== account.wake_start ||
        wake_end !== account.wake_end ||
        reminders_per_day !== account.reminders_per_day;
      if (windowChanged) {
        cancelForNewSettings(db, account.id, {
          wake_start,
          wake_end,
          reminders_per_day,
        });
      }
    });

    const res: SettingsGetRes = {
      tz,
      locale,
      wake_start,
      wake_end,
      reminders_per_day,
      min_gap_min,
      receiving_reminders: receivingReminders(db, account.id),
      reminders_paused_until: pausedUntil(account.reminders_paused_until),
    };

    return c.json(res, 200);
  });

  return router;
}
