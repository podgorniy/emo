// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which shown notification a self-started check-in answers (reliability.md
 * §2.3, methodology.md §1.1).
 */
import { assertEquals } from "@std/assert";
import { REMINDER_RESPONSE_WINDOW_MIN } from "../../../shared/protocol.ts";
import { pickRecentReminder } from "./reminderLink.ts";

const NOW = Date.parse("2026-10-08T10:00:00Z");
const WINDOW = REMINDER_RESPONSE_WINDOW_MIN * 60_000;
const ID = "0192f1c4-7b43-7000-8000-0000000000cc";

const shown = (data: unknown) => ({ data, close() {} });

Deno.test("reminderLink - a reminder shown inside the window is answered", () => {
  const n = shown({ url: `/now?reminder=${ID}`, shownAt: NOW - WINDOW });
  assertEquals(pickRecentReminder([n], NOW)?.reminderId, ID);
});

Deno.test("reminderLink - too old, from the future, without a time or a reminder: none", () => {
  const cases = [
    { url: `/now?reminder=${ID}`, shownAt: NOW - WINDOW - 1 },
    { url: `/now?reminder=${ID}`, shownAt: NOW + 1 },
    { url: `/now?reminder=${ID}` }, // shown by a worker before 2026-10-10
    { url: "/now", shownAt: NOW },
    { url: "/now?reminder=not-a-uuid", shownAt: NOW },
    null,
  ];
  for (const data of cases) {
    assertEquals(pickRecentReminder([shown(data)], NOW), null);
  }
});

Deno.test("reminderLink - of two, the newer is answered", () => {
  const older = "0192f1c4-7b43-7000-8000-0000000000dd";
  const list = [
    shown({ url: `/now?reminder=${ID}`, shownAt: NOW - 60_000 }),
    shown({ url: `/now?reminder=${older}`, shownAt: NOW - 120_000 }),
  ];
  assertEquals(pickRecentReminder(list, NOW)?.reminderId, ID);
});
