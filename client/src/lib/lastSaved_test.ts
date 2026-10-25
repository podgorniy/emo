// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §6.5: Undo on Home lasts 10 s from the save, by the wall
 * clock; coming back to Home later shows only what is left, never a fresh
 * 10 s.
 */
import { assertEquals } from "@std/assert";
import {
  forget,
  fromSaved,
  SAVED_MS,
  savedAt,
  UNDO_MS,
  undoLeft,
} from "./lastSaved.ts";

const T0 = 1_760_000_000_000;

Deno.test("lastSaved - the deadline is 10 s after the save", () => {
  assertEquals(UNDO_MS, 10_000);
  assertEquals(savedAt("a", T0), { id: "a", until: T0 + 10_000 });
});

Deno.test("lastSaved - the full time right after the save", () => {
  assertEquals(undoLeft(savedAt("a", T0), T0), 10_000);
});

Deno.test("lastSaved - what is left, never restarted", () => {
  const saved = savedAt("a", T0);
  assertEquals(undoLeft(saved, T0 + 3_500), 6_500);
  assertEquals(undoLeft(saved, T0 + 9_999), 1);
});

Deno.test("lastSaved - nothing at or past the deadline", () => {
  const saved = savedAt("a", T0);
  assertEquals(undoLeft(saved, T0 + 10_000), 0);
  assertEquals(undoLeft(saved, T0 + 11_000), 0);
  // Minutes later (a pane, a lock, a Close in between): still nothing
  assertEquals(undoLeft(saved, T0 + 5 * 60_000), 0);
});

Deno.test("lastSaved - nothing without a save", () => {
  assertEquals(undoLeft(null, T0), 0);
});

Deno.test("lastSaved - a clock set back never stretches it", () => {
  assertEquals(undoLeft(savedAt("a", T0), T0 - 60_000), 10_000);
});

Deno.test("lastSaved - reads the wall clock by default", () => {
  const left = undoLeft(savedAt("a"));
  assertEquals(left > 9_000 && left <= 10_000, true);
});

Deno.test("lastSaved - a deleted check-in is forgotten, another is kept", () => {
  const saved = savedAt("a", T0);
  assertEquals(forget(saved, "a"), null);
  assertEquals(forget(saved, "b"), saved);
  assertEquals(forget(null, "a"), null);
});

Deno.test("lastSaved - from Saved: 10 s on Home, Done early or after 5 s", () => {
  assertEquals(SAVED_MS, 5_000);
  // Done after 1 s, or Saved's own 5 s: Home gets its full 10 s
  assertEquals(undoLeft(fromSaved("a", T0, T0 + 1_000), T0 + 1_000), 10_000);
  assertEquals(undoLeft(fromSaved("a", T0, T0 + 5_000), T0 + 5_000), 10_000);
});

Deno.test("lastSaved - from Saved left standing: never a fresh 10 s", () => {
  // Saved's timer stalled (the page was frozen): only what is left of the
  // 10 s after its 5 s would have ended
  assertEquals(undoLeft(fromSaved("a", T0, T0 + 9_000), T0 + 9_000), 6_000);
  assertEquals(
    undoLeft(fromSaved("a", T0, T0 + 30 * 60_000), T0 + 30 * 60_000),
    0,
  );
});

Deno.test("lastSaved - from Saved, the page hidden since: no Undo on Home", () => {
  assertEquals(fromSaved("a", null, T0), null);
});
