// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The pane swipe (ui.md §5.3), one rule for Home, History and
 * Settings: a touch or pen drag commits at |dx| ≥ 60 px with |dy| ≤ 0.7 |dx|.
 * It is ignored while the page is pinch-zoomed, so dragging a zoomed page pans
 * it and never changes pane. It never starts on a field, inside a dialog or a
 * `[data-no-swipe]` element, while a dialog is open, or at a side edge, where
 * the system's own back gesture lives (`swipeStartOK`). After 10 px a drag is
 * locked to an axis: up and down is the page's scroll; sideways, the pane
 * follows the finger (0.6 of the drag toward a pane, 0.2 toward none, at most
 * 140 px) and springs back unless the swipe commits (`paneSwipe`).
 */
import { DUR, EASE, motionOK, play } from "./motion.ts";

/** The horizontal distance that commits a swipe, in CSS pixels */
export const SWIPE_MIN_PX = 60;

/** A drag that starts this close to a side edge is the system's */
export const SWIPE_EDGE_PX = 24;

/** Above this visual-viewport scale the page counts as pinch-zoomed */
const ZOOMED = 1.01;

/** Where a swipe may not start: its fields, a dialog, a rail that drags */
const GUARDED = "input, textarea, select, [role=dialog], [data-no-swipe]";

/**
 * The pane step for a drag of (dx, dy) at the given zoom: 1 = the next pane
 * (a swipe to the left), −1 = the previous one (a swipe to the right), 0 = none.
 */
export function swipeStep(dx: number, dy: number, scale = 1): -1 | 0 | 1 {
  if (scale > ZOOMED) return 0;
  if (Math.abs(dy) > 0.7 * Math.abs(dx)) return 0;
  if (dx >= SWIPE_MIN_PX) return -1;
  if (dx <= -SWIPE_MIN_PX) return 1;
  return 0;
}

/** The pinch-zoom scale of the visual viewport; 1 where there is none */
export function viewportScale(): number {
  return globalThis.visualViewport?.scale ?? 1;
}

/** What a pointerdown says about a swipe starting there */
export interface SwipeStart {
  pointerType: string;
  isPrimary: boolean;
  /** clientX */
  x: number;
  /** The layout viewport's width */
  width: number;
  scale: number;
  /** It is on a field, inside a dialog or a `[data-no-swipe]` element */
  guarded: boolean;
  /** A dialog is open somewhere on the page */
  dialogOpen: boolean;
}

/**
 * Whether a swipe may start: a touch or pen (a mouse never swipes), the
 * first finger, nothing guarded under it or open over it, not within
 * 24 px of a side edge, and the page not pinch-zoomed.
 */
export function swipeStartAllowed(s: SwipeStart): boolean {
  if (s.pointerType === "mouse" || !s.isPrimary) return false;
  if (s.guarded || s.dialogOpen) return false;
  if (s.x < SWIPE_EDGE_PX || s.x > s.width - SWIPE_EDGE_PX) return false;
  return s.scale <= ZOOMED;
}

/**
 * `swipeStartAllowed` for a pointerdown on the page; a pane keeps the start
 * only when this is true (and drops it otherwise, so a second finger ends
 * it).
 */
export function swipeStartOK(e: PointerEvent): boolean {
  const target = e.target as Element | null;
  return swipeStartAllowed({
    pointerType: e.pointerType,
    isPrimary: e.isPrimary,
    x: e.clientX,
    width: globalThis.innerWidth,
    scale: viewportScale(),
    guarded: !!target?.closest?.(GUARDED),
    dialogOpen: !!globalThis.document?.querySelector("[role=dialog]"),
  });
}

/** Movement (CSS px) after which a drag is locked to an axis */
export const SWIPE_LOCK_PX = 10;

/** How far the pane follows a sideways drag toward a pane */
export const DRAG_K = 0.6;

/** …and toward no pane: the rubber band */
export const DRAG_K_RUBBER = 0.2;

/** The pane never follows further than this, either way (CSS px) */
export const DRAG_MAX_PX = 140;

/**
 * The axis a drag of (dx, dy) is locked to: none yet within 10 px, then
 * sideways when |dx| > |dy|, else up and down (the page's scroll)
 */
export function swipeAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.hypot(dx, dy) < SWIPE_LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/**
 * The pane a sideways drag points to: left → the next (1), right → the
 * previous (−1)
 */
export function dragStep(dx: number): -1 | 1 {
  return dx < 0 ? 1 : -1;
}

/**
 * How far the pane follows a sideways drag of `dx` (CSS px): 0.6 of it
 * toward a pane that is there, 0.2 toward none, within ±140 px
 */
export function dragOffset(dx: number, toPane: boolean): number {
  const x = dx * (toPane ? DRAG_K : DRAG_K_RUBBER);
  return Math.max(-DRAG_MAX_PX, Math.min(DRAG_MAX_PX, x));
}

/**
 * What a drag let go at (dx, dy) does: the step `swipeStep` reads, when
 * `canStep` says that pane is there; 0 = it springs back
 */
export function swipeCommit(
  dx: number,
  dy: number,
  scale: number,
  canStep: (dir: -1 | 1) => boolean,
): -1 | 0 | 1 {
  const step = swipeStep(dx, dy, scale);
  return step !== 0 && canStep(step) ? step : 0;
}

export interface PaneSwipeOptions {
  /** A swipe committed: 1 = the next pane, −1 = the previous one */
  onstep: (dir: -1 | 1) => void;
  /** Whether there is a pane that way (the drag's pull, the commit) */
  canStep: (dir: -1 | 1) => boolean;
}

/** The spring back's WAAPI id (lib/motion.ts `play`) */
const SPRING_BACK = "swipe-back";

/**
 * A Svelte action on a pane's root (`use:paneSwipe`): the swipe of ui.md §5.3.
 * A press `swipeStartOK` allows is followed; locked sideways, the pane's
 * content follows the finger (`translateX`, transform only, the pointer
 * captured), what is fixed to the screen (the toast) staying put. Let go,
 * it commits exactly as `swipeCommit` says, else it springs back (280 ms,
 * the soft spring). A pointercancel (the browser took the drag for a
 * scroll or a zoom), a second finger and a hidden page end it with no
 * step. Under reduced motion nothing follows the finger and the commits
 * are the same. A mouse never swipes.
 */
export function paneSwipe(
  node: HTMLElement,
  opts: PaneSwipeOptions,
): { update(opts: PaneSwipeOptions): void; destroy(): void } {
  let o = opts;
  /** The press being followed, from where it went down */
  let press:
    | { id: number; x: number; y: number; axis: "x" | "y" | null }
    | null = null;
  /** What follows the finger: the pane's children, less what is fixed */
  let moved: HTMLElement[] = [];
  /** How far they are from rest (CSS px) */
  let offset = 0;
  let springs: Animation[] = [];

  /** At rest at once: no transform left, no spring running */
  function settle() {
    for (const a of springs) a.cancel();
    springs = [];
    for (const el of moved) el.style.removeProperty("transform");
    moved = [];
    offset = 0;
  }

  /** Back to rest from where the finger left the pane, with the spring */
  function springBack() {
    const from = offset;
    const els = moved;
    settle();
    if (from === 0) return;
    for (const el of els) {
      const a = play(el, [
        { transform: `translateX(${from}px)` },
        { transform: "none" },
      ], { duration: DUR[4], easing: EASE.springSoft, id: SPRING_BACK });
      if (a) springs.push(a);
    }
  }

  function follow(dx: number) {
    if (moved.length === 0) {
      moved = [...node.children].filter((el): el is HTMLElement =>
        el instanceof HTMLElement && getComputedStyle(el).position !== "fixed"
      );
    }
    offset = dragOffset(dx, o.canStep(dragStep(dx)));
    for (const el of moved) el.style.transform = `translateX(${offset}px)`;
  }

  function down(e: PointerEvent) {
    // A second finger ends the drag; a new press finds the pane at rest
    if (offset !== 0) springBack();
    else settle();
    press = swipeStartOK(e)
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null }
      : null;
  }

  function move(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    if (!press.axis) {
      press.axis = swipeAxis(dx, e.clientY - press.y);
      if (press.axis !== "x") return;
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser does not track (a synthetic one): bubbling
        // brings its events here all the same
      }
    }
    if (press.axis === "x" && motionOK()) follow(dx);
  }

  function up(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    // The axis lock is only the feedback's: the commit reads the whole drag
    const step = swipeCommit(
      e.clientX - press.x,
      e.clientY - press.y,
      viewportScale(),
      o.canStep,
    );
    press = null;
    springBack();
    if (step) o.onstep(step);
  }

  function cancel() {
    press = null;
    springBack();
  }

  function hidden() {
    if (document.visibilityState === "visible") return;
    press = null;
    settle();
  }

  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", cancel);
  document.addEventListener("visibilitychange", hidden);
  return {
    update(next: PaneSwipeOptions) {
      o = next;
    },
    destroy() {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      document.removeEventListener("visibilitychange", hidden);
      press = null;
      settle();
    },
  };
}
