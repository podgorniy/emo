// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §5.3: a pane swipe commits at 60 px, mostly horizontal,
 * and never while the page is pinch-zoomed; it never starts on a field,
 * inside or under a dialog, or at a side edge. After 10 px a drag is locked
 * sideways or up and down; sideways the pane follows at 0.6 toward a pane and
 * 0.2 toward none, within 140 px; `paneSwipe` commits exactly as `swipeStep`
 * reads the whole drag, when that pane is there.
 */
import { assertEquals } from "@std/assert";
import {
  dragOffset,
  dragStep,
  paneSwipe,
  type PaneSwipeOptions,
  swipeAxis,
  swipeCommit,
  type SwipeStart,
  swipeStartAllowed,
  swipeStartOK,
  swipeStep,
  viewportScale,
} from "./swipe.ts";

Deno.test("swipe - a 70 px swipe to the left steps to the next pane", () => {
  assertEquals(swipeStep(-70, 0, 1), 1);
  assertEquals(swipeStep(-70, 0), 1);
});

Deno.test("swipe - a 70 px swipe to the right steps to the previous pane", () => {
  assertEquals(swipeStep(70, 0, 1), -1);
});

Deno.test("swipe - ignored while the page is pinch-zoomed", () => {
  assertEquals(swipeStep(-70, 0, 1.5), 0);
  assertEquals(swipeStep(70, 0, 1.5), 0);
  // Rounding in the visual viewport is not a zoom
  assertEquals(swipeStep(-70, 0, 1.01), 1);
});

Deno.test("swipe - a mostly vertical drag is a scroll, not a swipe", () => {
  assertEquals(swipeStep(70, 60), 0);
  assertEquals(swipeStep(70, 49), -1);
});

Deno.test("swipe - shorter than 60 px does nothing", () => {
  assertEquals(swipeStep(-59, 0), 0);
  assertEquals(swipeStep(59, 0), 0);
  assertEquals(swipeStep(-60, 0), 1);
});

Deno.test("swipe - no visual viewport reads as no zoom", () => {
  assertEquals(viewportScale(), 1);
});

/** A finger in the middle of a 390 px phone, nothing in the way */
const START: SwipeStart = {
  pointerType: "touch",
  isPrimary: true,
  x: 195,
  width: 390,
  scale: 1,
  guarded: false,
  dialogOpen: false,
};

Deno.test("swipe - a touch or a pen may start one; a mouse never", () => {
  assertEquals(swipeStartAllowed(START), true);
  assertEquals(swipeStartAllowed({ ...START, pointerType: "pen" }), true);
  assertEquals(swipeStartAllowed({ ...START, pointerType: "mouse" }), false);
  // A second finger (a pinch) is not a swipe
  assertEquals(swipeStartAllowed({ ...START, isPrimary: false }), false);
});

Deno.test("swipe - not on a field, in a dialog or a rail, nor while a dialog is open", () => {
  assertEquals(swipeStartAllowed({ ...START, guarded: true }), false);
  assertEquals(swipeStartAllowed({ ...START, dialogOpen: true }), false);
});

Deno.test("swipe - not within 24 px of a side edge (the system's back gesture)", () => {
  assertEquals(swipeStartAllowed({ ...START, x: 23 }), false);
  assertEquals(swipeStartAllowed({ ...START, x: 24 }), true);
  assertEquals(swipeStartAllowed({ ...START, x: 366 }), true);
  assertEquals(swipeStartAllowed({ ...START, x: 367 }), false);
});

Deno.test("swipe - not while the page is pinch-zoomed", () => {
  assertEquals(swipeStartAllowed({ ...START, scale: 1.5 }), false);
  assertEquals(swipeStartAllowed({ ...START, scale: 1.01 }), true);
});

Deno.test("swipe - swipeStartOK reads the target, the open dialogs and the width", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = { document: g.document, innerWidth: g.innerWidth };
  let dialog: object | null = null;
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  define("document", {
    querySelector: (sel: string) => sel === "[role=dialog]" ? dialog : null,
  });
  define("innerWidth", 390);
  try {
    /** A pointerdown on an element inside `inside` (or nothing) */
    const down = (inside: string | null, x = 195, pointerType = "touch") =>
      ({
        pointerType,
        isPrimary: true,
        clientX: x,
        target: {
          closest: (sel: string) => inside && sel.includes(inside) ? {} : null,
        },
      }) as unknown as PointerEvent;
    assertEquals(swipeStartOK(down(null)), true);
    assertEquals(swipeStartOK(down(null, 10)), false);
    assertEquals(swipeStartOK(down(null, 195, "mouse")), false);
    for (
      const sel of [
        "input",
        "textarea",
        "select",
        "[role=dialog]",
        "[data-no-swipe]",
      ]
    ) {
      assertEquals(swipeStartOK(down(sel)), false, sel);
    }
    dialog = {};
    assertEquals(swipeStartOK(down(null)), false);
  } finally {
    for (const [name, value] of Object.entries(had)) {
      if (value === undefined) delete g[name];
      else define(name, value);
    }
  }
});

Deno.test("swipe - the axis is decided after 10 px: sideways when |dx| > |dy|", () => {
  assertEquals(swipeAxis(0, 0), null);
  assertEquals(swipeAxis(9, 0), null);
  assertEquals(swipeAxis(6, 7), null);
  assertEquals(swipeAxis(10, 0), "x");
  assertEquals(swipeAxis(-12, 5), "x");
  assertEquals(swipeAxis(3, -12), "y");
  // A tie is not sideways: the page keeps its scroll
  assertEquals(swipeAxis(8, 8), "y");
});

Deno.test("swipe - a drag to the left points to the next pane, to the right the previous", () => {
  assertEquals(dragStep(-1), 1);
  assertEquals(dragStep(1), -1);
});

Deno.test("swipe - the pane follows at 0.6 toward a pane, 0.2 toward none, within 140 px", () => {
  assertEquals(dragOffset(-40, true), -24);
  assertEquals(dragOffset(100, true), 60);
  assertEquals(dragOffset(120, false), 24);
  assertEquals(dragOffset(-50, false), -10);
  // Clamped either way
  assertEquals(dragOffset(-300, true), -140);
  assertEquals(dragOffset(300, true), 140);
  assertEquals(dragOffset(1000, false), 140);
  assertEquals(dragOffset(0, true), 0);
});

Deno.test("swipe - a release commits what swipeStep reads, only toward a pane that is there", () => {
  const both = () => true;
  const nextOnly = (dir: -1 | 1) => dir === 1;
  assertEquals(swipeCommit(-100, 0, 1, both), 1);
  assertEquals(swipeCommit(100, 0, 1, both), -1);
  // Home: nothing before it
  assertEquals(swipeCommit(100, 0, 1, nextOnly), 0);
  assertEquals(swipeCommit(-100, 0, 1, nextOnly), 1);
  // Short, mostly vertical, zoomed: back to rest
  assertEquals(swipeCommit(-40, 0, 1, both), 0);
  assertEquals(swipeCommit(-100, 80, 1, both), 0);
  assertEquals(swipeCommit(-100, 0, 1.5, both), 0);
  // canStep is asked only once there is a step
  let asked = 0;
  swipeCommit(-40, 0, 1, () => (asked++, true));
  assertEquals(asked, 0);
});

/**
 * `paneSwipe` on a stand-in pane (no DOM here): pointer events dispatched on
 * it, the steps it takes collected. Deno has no `matchMedia`, so motion is off
 * and nothing follows the finger: these are the commits alone.
 */
function stage(canStep: (dir: -1 | 1) => boolean = () => true) {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = { document: g.document, innerWidth: g.innerWidth };
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  const doc = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    querySelector: () => null,
  });
  define("document", doc);
  define("innerWidth", 390);
  const node = Object.assign(new EventTarget(), {
    children: [],
    setPointerCapture: () => {},
  }) as unknown as HTMLElement;
  const steps: number[] = [];
  const opts: PaneSwipeOptions = { onstep: (dir) => steps.push(dir), canStep };
  const action = paneSwipe(node, opts);
  /** A pointer event at (x, y), a first finger's touch unless said otherwise */
  const send = (
    type: string,
    x: number,
    y = 400,
    o: { pointerId?: number; isPrimary?: boolean; pointerType?: string } = {},
  ) =>
    node.dispatchEvent(Object.assign(new Event(type), {
      pointerId: 1,
      isPrimary: true,
      pointerType: "touch",
      ...o,
      clientX: x,
      clientY: y,
    }));
  /** One finger from (x, y) by (dx, dy), a move every 10 px, then lifted */
  const drag = (x: number, dx: number, dy = 0, y = 400) => {
    send("pointerdown", x, y);
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 10));
    for (let i = 1; i <= n; i++) {
      send("pointermove", x + (dx * i) / n, y + (dy * i) / n);
    }
    send("pointerup", x + dx, y + dy);
  };
  const restore = () => {
    action.destroy();
    for (const [name, value] of Object.entries(had)) {
      if (value === undefined) delete g[name];
      else define(name, value);
    }
  };
  return { action, doc, steps, send, drag, restore };
}

Deno.test("swipe - paneSwipe steps on a 100 px swipe, not on 40 px, nor toward no pane", () => {
  const s = stage((dir) => dir === 1);
  try {
    s.drag(300, -100);
    assertEquals(s.steps, [1]);
    s.drag(300, -40);
    s.drag(100, 120);
    assertEquals(s.steps, [1]);
  } finally {
    s.restore();
  }
});

Deno.test("swipe - paneSwipe commits on the whole drag, whatever the axis lock said", () => {
  const s = stage();
  try {
    // Up and down first (locked "y", no feedback), then sideways: the same
    // commit as swipeStep's, as before the lock existed
    s.send("pointerdown", 300);
    s.send("pointermove", 300, 412);
    s.send("pointermove", 200, 420);
    s.send("pointerup", 200, 420);
    assertEquals(s.steps, [1]);
    // Mostly vertical at the end: none
    s.drag(300, -80, 70);
    assertEquals(s.steps, [1]);
  } finally {
    s.restore();
  }
});

Deno.test("swipe - paneSwipe: a cancel, a second finger, a mouse, an edge or a hidden page never step", () => {
  const s = stage();
  try {
    // The browser took the drag (a scroll, a zoom)
    s.send("pointerdown", 300);
    s.send("pointermove", 250);
    s.send("pointercancel", 250);
    s.send("pointerup", 200);
    // A second finger lands
    s.send("pointerdown", 300);
    s.send("pointermove", 250);
    s.send("pointerdown", 100, 400, { pointerId: 2, isPrimary: false });
    s.send("pointerup", 200);
    // A mouse never swipes; nor a finger from a side edge
    s.send("pointerdown", 300, 400, { pointerType: "mouse" });
    s.send("pointerup", 150, 400, { pointerType: "mouse" });
    s.drag(380, -100);
    // The page went away mid-drag
    s.send("pointerdown", 300);
    s.send("pointermove", 250);
    s.doc.visibilityState = "hidden";
    s.doc.dispatchEvent(new Event("visibilitychange"));
    s.send("pointerup", 200);
    assertEquals(s.steps, []);
    s.doc.visibilityState = "visible";
    // Another finger's lift is not this drag's
    s.send("pointerdown", 300);
    s.send("pointermove", 250);
    s.send("pointerup", 150, 400, { pointerId: 3 });
    assertEquals(s.steps, []);
    s.send("pointerup", 200);
    assertEquals(s.steps, [1]);
  } finally {
    s.restore();
  }
});

Deno.test("swipe - paneSwipe takes new options and lets go on destroy", () => {
  const s = stage();
  const other: number[] = [];
  try {
    s.action.update({ onstep: (dir) => other.push(dir), canStep: () => true });
    s.drag(100, 100);
    assertEquals([s.steps, other], [[], [-1]]);
    s.action.destroy();
    s.drag(100, 100);
    assertEquals(other, [-1]);
  } finally {
    s.restore();
  }
});
