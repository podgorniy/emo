// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The reach room's arithmetic (ui.md §4.5): enough room to bring
 * a scroller's top edge to two thirds of the screen, and a resting place
 * that hides it, or goes as far as the content allows.
 */
import { assertEquals } from "@std/assert";
import { restingTop, roomFor } from "./reach.ts";

Deno.test("reach - the room brings the scroller's top into the bottom third", () => {
  // The page (top 0) of a 390×844 phone: the wordmark comes down to 563 px
  assertEquals(roomFor(844, 0), 563);
  // The check-in's step, under a 22 px header
  assertEquals(roomFor(844, 22), 541);
  assertEquals(roomFor(667, 22), 423);
  // Already in the bottom third (a low sheet's body): no room
  assertEquals(roomFor(844, 700), 0);
});

Deno.test("reach - at rest the room is just out of view, or as far as the content goes", () => {
  // Long content: the room scrolled away, the content as without it
  assertEquals(restingTop(541, 1181, 608), 541);
  // Content that fits (a low slider step): as far as it goes, which keeps
  // the group at the bottom
  assertEquals(restingTop(541, 900, 608), 292);
  // No room (a desktop) and nothing to scroll
  assertEquals(restingTop(0, 608, 608), 0);
});
