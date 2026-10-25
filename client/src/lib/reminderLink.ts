// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A check-in the person opens themselves (Home "Now", the `/now` shortcut)
 * while a reminder's notification still shows on this device, within the
 * response window, answers that reminder: `random` with its `reminder_id`.
 * Otherwise opening Emo instead of tapping the notification would count as
 * noticing on one's own, and the reminder as missed (methodology.md §1.1).
 * Specification: reliability.md §2.3.
 */

import { REMINDER_RESPONSE_WINDOW_MIN } from "../../../shared/protocol.ts";

const REMINDER_URL =
  /^\/now\?reminder=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const WINDOW_MS = REMINDER_RESPONSE_WINDOW_MIN * 60_000;

/** A notification on screen, as `getNotifications` returns it. */
export interface ShownNotification {
  /** `{ url, shownAt }`, from `client/src/sw.js` */
  readonly data: unknown;
  close(): void;
}

/**
 * The newest notification still inside the window that names a reminder.
 * One shown by a worker from before 2026-10-10 has no `shownAt`: never.
 */
export function pickRecentReminder<T extends ShownNotification>(
  shown: readonly T[],
  now: number,
): { notification: T; reminderId: string } | null {
  let found: { notification: T; reminderId: string } | null = null;
  let foundAt = -Infinity;
  for (const notification of shown) {
    const data = notification.data as
      | { url?: unknown; shownAt?: unknown }
      | null
      | undefined;
    if (typeof data?.url !== "string" || typeof data.shownAt !== "number") {
      continue;
    }
    const match = REMINDER_URL.exec(data.url);
    const age = now - data.shownAt;
    if (!match || age < 0 || age > WINDOW_MS || data.shownAt <= foundAt) {
      continue;
    }
    found = { notification, reminderId: match[1] };
    foundAt = data.shownAt;
  }
  return found;
}

/**
 * The reminder a check-in started now answers, or null. The notification it
 * links is closed, so it can't open a second check-in. Never throws: without
 * a service worker or `getNotifications`, nothing is linked.
 */
export async function linkRecentReminder(
  now = Date.now(),
): Promise<string | null> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (typeof reg?.getNotifications !== "function") return null;
    const found = pickRecentReminder(
      await reg.getNotifications({ tag: "emo" }),
      now,
    );
    if (!found) return null;
    found.notification.close();
    return found.reminderId;
  } catch {
    return null;
  }
}
