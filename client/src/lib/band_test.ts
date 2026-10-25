// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The thumb band's arithmetic (ui.md §4.5, Reach v2): the
 * bottom third of a phone, the bottom half (at least 300 px) of one under
 * 500 px high, and the least stage height that starts the band there.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  atEnd,
  bandHeight,
  bandTop,
  isShort,
  PHONE,
  restScrollTop,
  SHORT,
  SHORT_PX,
  stageMin,
} from "./band.ts";

Deno.test("band - the bottom third of a phone", () => {
  // 390×844
  assertAlmostEquals(bandHeight(844), 281.33, 0.01);
  assertAlmostEquals(bandTop(844), 562.67, 0.01);
  // 375×667
  assertAlmostEquals(bandHeight(667), 222.33, 0.01);
  assertAlmostEquals(bandTop(667), 444.67, 0.01);
  // 390×664 (a home bar and a toolbar)
  assertAlmostEquals(bandHeight(664), 221.33, 0.01);
  assertAlmostEquals(bandTop(664), 442.67, 0.01);
});

Deno.test("band - under 500 px high: the bottom half, at least 300 px", () => {
  assertEquals(SHORT_PX, 500);
  assertEquals(SHORT, "(max-height: 499px)");
  assertEquals(PHONE, "(max-width: 899px)");
  assert(isShort(499));
  assert(!isShort(500));
  // 844×390, held sideways
  assertEquals(bandHeight(390), 300);
  assertEquals(bandTop(390), 90);
  // 499 high: half would be under 300
  assertEquals(bandHeight(499), 300);
  // 500 high: a third again
  assertAlmostEquals(bandHeight(500), 166.67, 0.01);
});

Deno.test("band - never taller than the screen", () => {
  // 360×300: all of it
  assertEquals(bandHeight(300), 300);
  assertEquals(bandTop(300), 0);
  assertEquals(bandHeight(250), 250);
  assertEquals(bandTop(250), 0);
});

Deno.test("band - the stage reaches down to the band, in whole pixels", () => {
  // The page's own stage (top 0) and one under a 22 px header
  assertEquals(stageMin(844, 0), 563);
  assertEquals(stageMin(844, 22), 541);
  assertEquals(stageMin(667, 60), 385);
  assertEquals(stageMin(664, 0), 443);
  assertEquals(stageMin(390, 40), 50);
  // A stage that starts in the band already needs no height
  assertEquals(stageMin(844, 600), 0);
  assertEquals(stageMin(300, 0), 0);
  // What follows it never starts above the band's top
  for (const h of [844, 667, 664, 390, 300]) {
    for (const top of [0, 22.5, 61.3]) {
      assert(top + stageMin(h, top) >= bandTop(h));
    }
  }
});

Deno.test("band - a scroller rests at its top or its end", () => {
  assertEquals(restScrollTop("start", 1400, 844), 0);
  assertEquals(restScrollTop("end", 1400, 844), 556);
  // Content that fits: nothing to scroll
  assertEquals(restScrollTop("end", 600, 844), 0);
});

Deno.test("band - at its end a scroller stays pinned there", () => {
  assert(atEnd(556, 1400, 844));
  // Rounding in a fractional layout
  assert(atEnd(554.5, 1400, 844));
  // Scrolled up to read: kept where it is
  assert(!atEnd(500, 1400, 844));
  // Nothing to scroll is the end
  assert(atEnd(0, 600, 844));
});
