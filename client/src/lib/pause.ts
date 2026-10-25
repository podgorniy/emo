// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Paused reminders (architecture.md §9.1, ui.md §3, §11.3):
 * the pause as the server last said, cached with the settings in `meta`, so
 * Home can show it offline; pausing and resuming need the network.
 */
import type { SettingsGetRes } from "../../../shared/protocol.ts";
import { apiPauseReminders, apiResumeReminders } from "./api.ts";
import { getMeta } from "./db.ts";
import { rememberSettings } from "./sync.ts";

/** The end of a pause still running, or null. */
export function activePause(
  settings: SettingsGetRes | null | undefined,
  now = Date.now(),
): Date | null {
  const until = settings?.reminders_paused_until;
  return until && Date.parse(until) > now ? new Date(until) : null;
}

export async function cachedPause(): Promise<Date | null> {
  return activePause(await getMeta<SettingsGetRes>("settings"));
}

export async function pauseReminders(
  days: 1 | 3 | 7,
): Promise<SettingsGetRes> {
  const res = await apiPauseReminders(days);
  await rememberSettings(res);
  return res;
}

export async function resumeReminders(): Promise<SettingsGetRes> {
  const res = await apiResumeReminders();
  await rememberSettings(res);
  return res;
}

/** "Sat 10 Oct, 14:00" in the interface language */
export function pauseLabel(until: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(until);
}
