// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Motion (ui.md §5.1): the tokens of `boot.css` as numbers and
 * curves, one gate for every script-driven animation, arrivals and screen
 * swaps. Nothing here holds input: the DOM is final and interactive before
 * an animation starts, an arrival only decorates its first frames, and any
 * pointer or key ends a View Transition at once. Under
 * `prefers-reduced-motion: reduce` every call is a plain state change; the
 * CSS kill switch in `boot.css` cannot reach WAAPI or View Transitions, so
 * this gate does.
 */
import { flushSync } from "svelte";

/** Milliseconds; `boot.css` --dur-* (motion_test.ts keeps them equal) */
export const DUR = {
  1: 90,
  2: 140,
  3: 180,
  4: 280,
  5: 400,
  spring: 360,
  springSoft: 420,
} as const;

/** The damped springs of `boot.css` (ζ .65 / 360 ms and ζ .82 / 420 ms) */
export const SPRING_LINEAR =
  "linear(0, 0.075 5%, 0.244 10%, 0.445 15%, 0.636 20%, 0.796 25%, 0.916 30%, 0.996 35%, 1.043 40%, 1.064 45%, 1.068 50%, 1.06 55%, 1.048 60%, 1.034 65%, 1.022 70%, 1.011 75%, 1.004 80%, 0.999 85%, 0.997 90%, 0.998 95%, 1)";
export const SPRING_SOFT_LINEAR =
  "linear(0, 0.047 5%, 0.156 10%, 0.292 15%, 0.431 20%, 0.561 25%, 0.673 30%, 0.766 35%, 0.839 40%, 0.896 45%, 0.937 50%, 0.966 55%, 0.986 60%, 0.999 65%, 1.006 70%, 1.01 75%, 1.011 80%, 1.009 85%, 1.006 90%, 1.003 95%, 1)";

// WAAPI throws on an easing the engine does not know: never pass linear()
// unchecked (Safari 16.4–17.1, Chrome 110–112)
const linearOK = typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("transition-timing-function", "linear(0, 1)");

export const EASE = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  in: "cubic-bezier(0.4, 0, 1, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  emphasized: "cubic-bezier(0.05, 0.7, 0.1, 1)",
  spring: linearOK ? SPRING_LINEAR : "cubic-bezier(0.34, 1.36, 0.64, 1)",
  springSoft: linearOK ? SPRING_SOFT_LINEAR : "cubic-bezier(0.25, 1.1, 0.5, 1)",
} as const;

const reduce = typeof matchMedia === "function"
  ? matchMedia("(prefers-reduced-motion: reduce)")
  : null;

/** False when the device asks for less motion: then nothing moves */
export const motionOK = (): boolean => !(reduce?.matches ?? true);

/**
 * Plays `keyframes` on `el` through the gate, replacing a running animation
 * of the same `id` there. `fill: "backwards"` holds the first keyframe
 * during a delay and nothing after the end, so no style is left behind.
 */
export function play(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  timing: KeyframeAnimationOptions & { id?: string } = {},
): Animation | null {
  if (!el || !motionOK() || typeof el.animate !== "function") return null;
  const id = timing.id ?? "arrive";
  for (const a of el.getAnimations({ subtree: !!timing.pseudoElement })) {
    if (a.id === id) a.cancel();
  }
  try {
    return el.animate(keyframes, { fill: "backwards", ...timing, id });
  } catch {
    // An option this engine refuses (an old one): the state is already final
    return null;
  }
}

/** Where new content comes from: the right, the left, or below */
export type Dir = "fwd" | "back" | "up";

export interface ArriveOptions {
  /** Distance in px along the direction (default 14) */
  offset?: number;
  /**
   * Starting opacity (default .35). 1 = transform only: what carries text
   * in the check-in never fades (contrast on every frame, ui.md §5.1)
   */
  from?: number;
  /** Starting scale (default 1) */
  scale?: number;
  duration?: number;
  delay?: number;
  easing?: string;
}

/**
 * New content settles in: it is already in place and interactive; it moves
 * the last few pixels (and fades from `from`) over `duration`. Compositor
 * only, < 0.2 ms of script.
 */
export function arrive(
  el: Element | null | undefined,
  dir: Dir,
  o: ArriveOptions = {},
): Animation | null {
  const d = o.offset ?? 14;
  const [x, y] = dir === "fwd" ? [d, 0] : dir === "back" ? [-d, 0] : [0, d];
  const scale = o.scale !== undefined && o.scale !== 1
    ? ` scale(${o.scale})`
    : "";
  const from = o.from ?? 0.35;
  const start: Keyframe = {
    transform: `translate3d(${x}px, ${y}px, 0)${scale}`,
  };
  const end: Keyframe = { transform: "none" };
  if (from < 1) {
    start.opacity = from;
    end.opacity = 1;
  }
  return play(el, [start, end], {
    duration: o.duration ?? DUR[3],
    delay: o.delay ?? 0,
    easing: o.easing ?? EASE.out,
  });
}

/** A Svelte action: a part revealed within a step rises 6 px, no fade (ui.md §5.1) */
export function reveal(node: Element): void {
  arrive(node, "up", { offset: 6, from: 1 });
}

/** What a View Transition is for: the CSS in `fx.css` reads it off <html> */
export type SwapKind = "pane-fwd" | "pane-back" | "auth-fwd" | "auth-back";

interface ViewTransitionLike {
  skipTransition(): void;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
}
let running: ViewTransitionLike | null = null;

/**
 * A screen swap: a View Transition where the browser has one (Chrome 111+,
 * Safari 18+), else the update and then `fallback` (an arrival). Never in the
 * check-in: while a transition runs the page is a picture, so any pointer or
 * key skips it to the live page at once. Resolves once the DOM is updated
 * (a focus move waits for it).
 */
export function swap(
  kind: SwapKind,
  update: () => void,
  fallback?: () => void,
): Promise<void> {
  running?.skipTransition();
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => ViewTransitionLike;
  };
  if (
    !motionOK() || typeof doc.startViewTransition !== "function" ||
    document.visibilityState !== "visible"
  ) {
    flushSync(update);
    fallback?.();
    return Promise.resolve();
  }
  const html = document.documentElement;
  html.dataset.vt = kind;
  let t: ViewTransitionLike;
  try {
    t = doc.startViewTransition(() => flushSync(update));
  } catch {
    delete html.dataset.vt;
    flushSync(update);
    fallback?.();
    return Promise.resolve();
  }
  running = t;
  const skip = () => t.skipTransition();
  addEventListener("pointerdown", skip, { capture: true, once: true });
  addEventListener("keydown", skip, { capture: true, once: true });
  t.finished.catch(() => {}).finally(() => {
    if (running === t) running = null;
    if (!running) delete html.dataset.vt;
    removeEventListener("pointerdown", skip, { capture: true });
    removeEventListener("keydown", skip, { capture: true });
  });
  return t.updateCallbackDone.catch(() => {});
}

/**
 * A sign-in card's content changes in place (ui.md §5.1): its size morphs and its
 * content crossfades; without View Transitions the new content settles in
 * from 16 px, never fainter than .35.
 */
export function swapCard(
  dir: "fwd" | "back",
  update: () => void,
): Promise<void> {
  return swap(dir === "fwd" ? "auth-fwd" : "auth-back", update, () => {
    const card = document.querySelector(".auth-card, .login-card");
    for (const el of card?.children ?? []) arrive(el, dir, { offset: 16 });
  });
}

/**
 * How the next screen should arrive, handed over by the one leaving (Home
 * after the check-in, ui.md §5.1). Read once.
 */
let cue: "flow" | null = null;
export function cueArrival(kind: "flow"): void {
  cue = kind;
}
export function takeArrival(): "flow" | null {
  const c = cue;
  cue = null;
  return c;
}
