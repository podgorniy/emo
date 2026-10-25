// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §6.2, §14.4: only a still tap answers a slider by
 * itself; on the thumb it answers where the thumb is, elsewhere on the track
 * the value under the finger. A scroll, a pull or a pinch never answers.
 */
import { assertEquals } from "@std/assert";
import {
  isSlide,
  type Press,
  STILL_PX,
  tapIntent,
  thumbX,
  valueAt,
} from "./press.ts";

/**
 * A still tap at x on an untouched 0–10 slider 358 px wide at x 16 (its
 * thumb's centre travels 32…358, the midpoint at 195), y 600
 */
function press(x: number, over: Partial<Press> = {}): Press {
  return {
    downX: x,
    downY: 600,
    upX: x,
    upY: 600,
    cancelled: false,
    sawInput: false,
    held: null,
    value: 5,
    trackLeft: 32,
    trackWidth: 326,
    min: 0,
    max: 10,
    step: 1,
    ...over,
  };
}

Deno.test("press - a still tap on the thumb answers where it is", () => {
  assertEquals(tapIntent(press(195)), { kind: "thumb" });
  // Within reach of the thumb, a finger's width off its centre
  assertEquals(tapIntent(press(195 + 20)), { kind: "thumb" });
  assertEquals(tapIntent(press(195 - 22)), { kind: "thumb" });
  // A wobble under 10 px is still a tap
  assertEquals(
    tapIntent(press(195, { upX: 201, upY: 606 })),
    { kind: "thumb" },
  );
});

Deno.test("press - a still tap elsewhere on the track answers the value under it", () => {
  assertEquals(tapIntent(press(358)), { kind: "value", value: 10 });
  // Past the end of the thumb's travel: the end
  assertEquals(tapIntent(press(370)), { kind: "value", value: 10 });
  assertEquals(tapIntent(press(20)), { kind: "value", value: 0 });
  // 0.88 of the way: rounded to the step
  assertEquals(tapIntent(press(32 + 326 * 0.88)), { kind: "value", value: 9 });
  assertEquals(tapIntent(press(32 + 326 * 0.83)), { kind: "value", value: 8 });
});

Deno.test("press - a scroll or pull that starts on the slider answers nothing", () => {
  // 40 px up or down, along the track or not
  assertEquals(tapIntent(press(195, { upY: 560 })), { kind: "none" });
  assertEquals(tapIntent(press(300, { upY: 640 })), { kind: "none" });
  assertEquals(tapIntent(press(300, { upX: 310, upY: 640 })), {
    kind: "none",
  });
  // Exactly 10 px is a move
  assertEquals(tapIntent(press(195, { upY: 600 + STILL_PX })), {
    kind: "none",
  });
});

Deno.test("press - taken by the browser (pointercancel) answers nothing", () => {
  assertEquals(tapIntent(press(195, { cancelled: true })), { kind: "none" });
  assertEquals(tapIntent(press(358, { cancelled: true, held: 10 })), {
    kind: "none",
  });
});

Deno.test("press - a slide the range already answered adds nothing", () => {
  assertEquals(tapIntent(press(195, { sawInput: true })), { kind: "none" });
  assertEquals(tapIntent(press(195, { upX: 260, sawInput: true })), {
    kind: "none",
  });
});

Deno.test("press - a held jump: a tap decides, a slide keeps it, a scroll drops it", () => {
  // Android moved the thumb to the finger at once; a still tap near the
  // thumb is still a tap on the thumb, elsewhere the value under the finger
  assertEquals(tapIntent(press(210, { held: 6 })), { kind: "thumb" });
  assertEquals(tapIntent(press(358, { held: 10 })), {
    kind: "value",
    value: 10,
  });
  // A slide whose moves the page did not see: what the browser set stands
  assertEquals(tapIntent(press(195, { upX: 290, upY: 610, held: 8 })), {
    kind: "value",
    value: 8,
  });
  // Across the track: a scroll that kept the finger
  assertEquals(tapIntent(press(300, { upX: 290, upY: 540, held: 8 })), {
    kind: "none",
  });
});

Deno.test("press - the bipolar slider: the midpoint is 0, the ends ±3", () => {
  const bipolar = { value: 0, min: -3, max: 3 };
  assertEquals(tapIntent(press(195, bipolar)), { kind: "thumb" });
  assertEquals(tapIntent(press(358, bipolar)), { kind: "value", value: 3 });
  assertEquals(tapIntent(press(32, bipolar)), { kind: "value", value: -3 });
  // Off the thumb but nearer to it than to the next value: the same value
  assertEquals(tapIntent(press(195 + 24, bipolar)), {
    kind: "value",
    value: 0,
  });
});

Deno.test("press - a touched slider: the thumb is where its value is", () => {
  const at8 = { value: 8 };
  assertEquals(tapIntent(press(32 + 326 * 0.8, at8)), { kind: "thumb" });
  assertEquals(tapIntent(press(195, at8)), { kind: "value", value: 5 });
});

Deno.test("press - a slide is 10 px or more, along the track", () => {
  assertEquals(isSlide(12, 3), true);
  assertEquals(isSlide(-12, 3), true);
  assertEquals(isSlide(9, 0), false);
  assertEquals(isSlide(12, 12), false);
  assertEquals(isSlide(3, 40), false);
});

Deno.test("press - thumb centre and value under x are each other's inverse", () => {
  for (let v = 0; v <= 10; v++) {
    const x = thumbX(v, 0, 10, 32, 326);
    assertEquals(valueAt(x, 0, 10, 1, 32, 326), v);
  }
  assertEquals(thumbX(5, 0, 10, 32, 326), 195);
  // A slider with no range sits in the middle
  assertEquals(thumbX(1, 1, 1, 32, 326), 195);
  assertEquals(valueAt(100, 0, 10, 1, 32, 0), 5);
});
