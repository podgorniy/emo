// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The on-screen keyboard through the visual viewport (ui.md §4.5): its inset
 * and whether it is up, the keyboard-free height, held
 * while zoomed, and how far a field is lifted above it.
 */
import { assertEquals } from "@std/assert";
import {
  KB_MIN,
  keyboardFreeHeight,
  keyboardInset,
  keyboardShown,
  keyboardUp,
  liftBy,
  nextViewport,
  type ViewportReading,
  type ViewportSample,
} from "./viewport.ts";

/** A 390×844 phone, no keyboard */
const REST: ViewportSample = {
  innerHeight: 844,
  vvHeight: 844,
  vvOffsetTop: 0,
  scale: 1,
};

function reading(s: Partial<ViewportReading> = {}): ViewportReading {
  return { ...REST, innerWidth: 390, editing: false, ...s };
}

Deno.test("viewport - no keyboard: no inset", () => {
  assertEquals(keyboardInset(REST, 0), 0);
  assertEquals(keyboardUp(REST, false), false);
});

Deno.test("viewport - a 336 px and a 260 px keyboard", () => {
  const ios = { ...REST, vvHeight: 844 - 336 };
  assertEquals(keyboardInset(ios, 0), 336);
  assertEquals(keyboardUp(ios, false), true);
  const android = { ...REST, vvHeight: 844 - 260 };
  assertEquals(keyboardInset(android, 0), 260);
  assertEquals(keyboardUp(android, false), true);
});

Deno.test("viewport - iOS moves the visual viewport up to show a low field", () => {
  // A 336 px keyboard, the view moved 200 px up: a fixed box's bottom goes
  // 136 px up to sit on the keyboard, and the keyboard is still up
  const s = { ...REST, vvHeight: 508, vvOffsetTop: 200 };
  assertEquals(keyboardInset(s, 0), 136);
  assertEquals(keyboardUp(s, false), true);
  // All the way up: the layout viewport's bottom is the keyboard's top
  const full = { ...REST, vvHeight: 508, vvOffsetTop: 336 };
  assertEquals(keyboardInset(full, 0), 0);
  assertEquals(keyboardUp(full, false), true);
});

Deno.test("viewport - a toolbar is not a keyboard (KB_MIN)", () => {
  assertEquals(KB_MIN, 120);
  assertEquals(keyboardUp({ ...REST, vvHeight: 844 - 120 }, false), false);
  assertEquals(keyboardUp({ ...REST, vvHeight: 844 - 121 }, false), true);
  // The inset itself is said whatever its size
  assertEquals(keyboardInset({ ...REST, vvHeight: 844 - 56 }, 0), 56);
});

Deno.test("viewport - pinch-zoomed: the last values hold", () => {
  const zoomed = { ...REST, vvHeight: 422, vvOffsetTop: 300, scale: 2 };
  assertEquals(keyboardInset(zoomed, 0), 0);
  assertEquals(keyboardInset(zoomed, 336), 336);
  assertEquals(keyboardUp(zoomed, false), false);
  assertEquals(keyboardUp(zoomed, true), true);
  // Rounding in the visual viewport is not a zoom
  assertEquals(keyboardInset({ ...REST, vvHeight: 508, scale: 1.01 }, 0), 336);
});

Deno.test("viewport - fractional viewports round to whole pixels", () => {
  assertEquals(keyboardInset({ ...REST, vvHeight: 507.6 }, 0), 336);
  assertEquals(keyboardInset({ ...REST, vvHeight: 507.4 }, 0), 337);
  // A visual viewport a fraction taller than the layout one: none
  assertEquals(keyboardInset({ ...REST, vvHeight: 844.5 }, 0), 0);
  const s = nextViewport(null, reading({ vvHeight: 663.6, vvOffsetTop: 0.4 }));
  assertEquals([s.vvh, s.top], [664, 0]);
});

Deno.test("viewport - the values in force follow the keyboard", () => {
  const rest = nextViewport(null, reading());
  assertEquals(rest, {
    vvh: 844,
    top: 0,
    kb: 0,
    up: false,
    free: 844,
    width: 390,
  });
  const up = nextViewport(rest, reading({ vvHeight: 508, editing: true }));
  assertEquals(up, { ...rest, vvh: 508, kb: 336, up: true });
  const moved = nextViewport(
    up,
    reading({ vvHeight: 508, vvOffsetTop: 200, editing: true }),
  );
  assertEquals([moved.top, moved.kb, moved.up], [200, 136, true]);
  const down = nextViewport(moved, reading());
  assertEquals(down, rest);
});

Deno.test("viewport - the keyboard-free height holds while a keyboard is up", () => {
  // A 664 px phone: with a 336 px keyboard the visible 328 px would read
  // as short, the keyboard-free height never does
  const rest = nextViewport(null, reading({ innerHeight: 664, vvHeight: 664 }));
  const up = nextViewport(
    rest,
    reading({ innerHeight: 664, vvHeight: 328, editing: true }),
  );
  assertEquals([up.vvh, up.free], [328, 664]);
  // A browser whose keyboard resizes the page: the layout viewport shrinks
  // with it while a field has focus, and the height still holds
  const resized = nextViewport(
    rest,
    reading({ innerHeight: 404, vvHeight: 404, editing: true }),
  );
  assertEquals([resized.up, resized.free], [false, 664]);
  // The same shrink with no field focused is a smaller window
  const smaller = nextViewport(
    rest,
    reading({ innerHeight: 404, vvHeight: 404 }),
  );
  assertEquals(smaller.free, 404);
  // Turned sideways with the keyboard up: the new width's height
  const turned = nextViewport(
    up,
    reading({
      innerWidth: 664,
      innerHeight: 390,
      vvHeight: 200,
      editing: true,
    }),
  );
  assertEquals([turned.up, turned.free], [true, 390]);
});

Deno.test("viewport - no field focused: no keyboard, whatever the viewport says", () => {
  const rest = nextViewport(null, reading());
  const up = nextViewport(rest, reading({ vvHeight: 508, editing: true }));
  // The field gone (Saved replaced the note) and iOS still reports 508
  const stale = nextViewport(up, reading({ vvHeight: 508 }));
  assertEquals([stale.up, stale.kb], [false, 0]);
  // Zoomed with the keyboard up, then the field left: down, still zoomed
  const zoomed = nextViewport(
    up,
    reading({ vvHeight: 400, scale: 1.2, editing: true }),
  );
  assertEquals(zoomed, up);
  const left = nextViewport(zoomed, reading({ vvHeight: 400, scale: 1.2 }));
  assertEquals([left.up, left.kb, left.vvh], [false, 0, up.vvh]);
});

Deno.test("viewport - pinch-zoomed: everything holds", () => {
  const rest = nextViewport(null, reading());
  const zoomed = nextViewport(
    rest,
    reading({ vvHeight: 300, vvOffsetTop: 120, scale: 2.5 }),
  );
  assertEquals(zoomed, rest);
  // Zoomed from the first reading: the layout viewport, no keyboard
  const first = nextViewport(
    null,
    reading({ vvHeight: 300, vvOffsetTop: 120, scale: 2.5 }),
  );
  assertEquals([first.vvh, first.top, first.kb, first.up], [844, 0, 0, false]);
});

Deno.test("viewport - a field is lifted right above the keyboard", () => {
  // Keyboard top at 508: a field down at 560–604 goes up to end at 496
  assertEquals(liftBy(560, 604, 0, 508), 108);
  // Already above it with room to spare: it stays
  assertEquals(liftBy(300, 344, 0, 508), 0);
  assertEquals(liftBy(456, 500, 0, 508), 0);
  // Closer than 8 px: lifted to 12
  assertEquals(liftBy(460, 504, 0, 508), 8);
  // Hidden above (moved out of view): brought down to the keyboard
  assertEquals(liftBy(-60, -16, 0, 508), -512);
  // Under a sheet's actions (its scroller ends at 440): above them
  assertEquals(liftBy(400, 444, 120, 440), 16);
});

Deno.test("viewport - without a window: the window's height, no keyboard", () => {
  assertEquals(keyboardFreeHeight(), globalThis.innerHeight ?? 0);
  assertEquals(keyboardShown(), false);
});
