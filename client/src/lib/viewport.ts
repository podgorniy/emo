// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The visual viewport and the on-screen keyboard (ui.md §4.5,
 * Reach v2): one path for iOS and Android. The keyboard shrinks the visual
 * viewport, never the layout viewport (no `interactive-widget`: resizing the
 * content would flip height queries mid-typing and squeeze the check-in), so
 * the page reads it from `visualViewport` and says it in CSS on <html>:
 * `--vvh` the visible height, `--vv-top` its top, `--kb` the keyboard's
 * inset from the layout viewport's bottom (where a fixed sheet's bottom
 * goes), and `data-kb` while a keyboard is up. While the page is
 * pinch-zoomed every value holds still. Nothing here touches the page until
 * it is called: Deno tests and e2e code import it.
 */

/** What one reading of the viewports gives, in CSS pixels */
export interface ViewportSample {
  /** The layout viewport's height */
  innerHeight: number;
  /** The visual viewport's height and its top within the layout viewport */
  vvHeight: number;
  vvOffsetTop: number;
  /** The pinch-zoom scale */
  scale: number;
}

/** Above this visual-viewport scale the page counts as pinch-zoomed (swipe.ts) */
const ZOOMED = 1.01;

/** A bottom inset taller than this is an on-screen keyboard, not a toolbar */
export const KB_MIN = 120;

/** A field's bottom lands this far above the keyboard; 8 px is close enough */
const GAP = 12;
const GAP_MIN = 8;

/**
 * The keyboard's inset from the layout viewport's bottom: its height, less
 * how far iOS has moved the visual viewport up to show a low field. The last
 * value while zoomed (a zoomed viewport is no keyboard).
 */
export function keyboardInset(s: ViewportSample, last: number): number {
  if (s.scale > ZOOMED) return last;
  return Math.max(0, Math.round(s.innerHeight - s.vvOffsetTop - s.vvHeight));
}

/**
 * Whether an on-screen keyboard is up: the visible height is more than
 * KB_MIN short of the layout viewport's, wherever iOS has moved it. The last
 * answer while zoomed.
 */
export function keyboardUp(s: ViewportSample, last: boolean): boolean {
  if (s.scale > ZOOMED) return last;
  return Math.round(s.innerHeight - s.vvHeight) > KB_MIN;
}

/** A sample as `startViewportWatch` takes it */
export interface ViewportReading extends ViewportSample {
  innerWidth: number;
  /** A text field has focus (a keyboard may be up) */
  editing: boolean;
}

/** The values in force: what is written on <html> */
export interface ViewportState {
  /** `--vvh` */
  vvh: number;
  /** `--vv-top` */
  top: number;
  /** `--kb` */
  kb: number;
  /** `data-kb` */
  up: boolean;
  /** `keyboardFreeHeight()`, seen at the layout viewport's `width` */
  free: number;
  width: number;
}

/**
 * The next values for a reading. All held while zoomed. The keyboard-free
 * height is the layout viewport's height, held while a keyboard is up at the
 * same width (a phone turned with it up takes the new one); also held when
 * the layout viewport shrinks by more than KB_MIN while a field has focus at
 * the same width (a browser whose keyboard resizes the page)
 */
export function nextViewport(
  prev: ViewportState | null,
  s: ViewportReading,
): ViewportState {
  // No text field focused, no keyboard: a visual viewport iOS left short
  // after one went down, or a zoom that holds, never keeps data-kb (which
  // hides the pane dots and the toast)
  if (prev && s.scale > ZOOMED) {
    return prev.up && !s.editing ? { ...prev, kb: 0, up: false } : prev;
  }
  const zoomed = s.scale > ZOOMED;
  const up = s.editing && keyboardUp(s, prev?.up ?? false);
  const free = prev !== null && prev.width === s.innerWidth &&
      (up || (s.editing && s.innerHeight < prev.free - KB_MIN))
    ? prev.free
    : s.innerHeight;
  return {
    vvh: Math.round(zoomed ? s.innerHeight : s.vvHeight),
    top: zoomed ? 0 : Math.round(s.vvOffsetTop),
    kb: s.editing ? keyboardInset(s, prev?.kb ?? 0) : 0,
    up,
    free,
    width: s.innerWidth,
  };
}

function same(a: ViewportState | null, b: ViewportState): boolean {
  return a !== null && a.vvh === b.vvh && a.top === b.top && a.kb === b.kb &&
    a.up === b.up && a.free === b.free && a.width === b.width;
}

/**
 * How far to scroll (px; more = the content up) so a box from `top` to
 * `bottom` is in view between `ceil` and `floor` (the keyboard's top, or the
 * scroller's visible bottom above it): none when it is in view with 8 px to
 * spare below; else its bottom 12 px above the floor
 */
export function liftBy(
  top: number,
  bottom: number,
  ceil: number,
  floor: number,
): number {
  if (top >= ceil && bottom <= floor - GAP_MIN) return 0;
  return bottom - (floor - GAP);
}

/** The text fields a keyboard comes up for */
const TYPED = "textarea, [contenteditable]:not([contenteditable=false])," +
  " input:not([type=checkbox], [type=radio], [type=range], [type=button]," +
  " [type=submit], [type=reset], [type=file], [type=color], [type=image])";

function editing(): boolean {
  return !!globalThis.document?.activeElement?.matches?.(TYPED);
}

function read(vv: VisualViewport | null): ViewportReading {
  return {
    innerHeight,
    innerWidth,
    vvHeight: vv?.height ?? innerHeight,
    vvOffsetTop: vv?.offsetTop ?? 0,
    scale: vv?.scale ?? 1,
    editing: editing(),
  };
}

let state: ViewportState | null = null;
/** The visual viewport followed (null where there is none) while watching */
let watched: VisualViewport | null | undefined;
let stopWatch: (() => void) | null = null;
let refresh: (() => void) | null = null;

/**
 * Reads the viewports again on the next frame (a new screen: a field that
 * had focus may be gone, and with it the keyboard)
 */
export function refreshViewport(): void {
  refresh?.();
}
const listeners = new Set<() => void>();

/**
 * Follows the visual viewport from now on (main.ts, before the app mounts):
 * its `resize` and `scroll`, once a frame, and the window's `resize`. Reads
 * `visualViewport` when called, so a stub installed before the page's
 * scripts (e2e/keyboard.ts) is the one followed. Returns the stop.
 */
export function startViewportWatch(): () => void {
  if (stopWatch) return stopWatch;
  const vv = globalThis.visualViewport ?? null;
  watched = vv;
  const root = document.documentElement;
  let frame = 0;

  const apply = () => {
    frame = 0;
    const next = nextViewport(state, read(vv));
    if (same(state, next)) return;
    const prev = state;
    state = next;
    if (next.vvh !== prev?.vvh) {
      root.style.setProperty("--vvh", `${next.vvh}px`);
    }
    if (next.top !== prev?.top) {
      root.style.setProperty("--vv-top", `${next.top}px`);
    }
    if (next.kb !== prev?.kb) root.style.setProperty("--kb", `${next.kb}px`);
    root.toggleAttribute("data-kb", next.up);
    for (const fn of listeners) fn();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };

  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  addEventListener("resize", schedule);
  // A field focused or left: the keyboard may have gone without a viewport
  // event (iOS)
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  refresh = schedule;
  apply();

  stopWatch = () => {
    if (frame) cancelAnimationFrame(frame);
    vv?.removeEventListener("resize", schedule);
    vv?.removeEventListener("scroll", schedule);
    removeEventListener("resize", schedule);
    document.removeEventListener("focusin", schedule);
    document.removeEventListener("focusout", schedule);
    refresh = null;
    watched = undefined;
    stopWatch = null;
  };
  return stopWatch;
}

/** Calls `fn` after each change `startViewportWatch` writes; returns the unsubscribe */
export function onViewportChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The last layout-viewport height seen with no keyboard up (`ui.layout`,
 * `layout.short`): a save with the keyboard up still reads the phone's own
 * height. Read now, not a frame late (a window resized just before a save);
 * the window's height before the watch starts; 0 without a window.
 */
export function keyboardFreeHeight(): number {
  if (watched !== undefined) return nextViewport(state, read(watched)).free;
  return state?.free ?? globalThis.innerHeight ?? 0;
}

/** An on-screen keyboard is up (html[data-kb]) */
export function keyboardShown(): boolean {
  return state?.up ?? false;
}

/** The visible height now, as `--vvh`: held while the page is pinch-zoomed */
export function viewportHeight(): number {
  const vv = globalThis.visualViewport;
  if ((vv?.scale ?? 1) > ZOOMED) return state?.vvh ?? innerHeight;
  return Math.round(vv?.height ?? innerHeight);
}

/** `el`'s scroller: null when a fixed box comes first (nothing to scroll) */
function scrollerOf(el: Element): Element | null {
  for (let e = el.parentElement; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (
      /^(auto|scroll|overlay)$/.test(cs.overflowY) &&
      e.scrollHeight > e.clientHeight
    ) {
      return e;
    }
    if (cs.position === "fixed") return null;
  }
  return document.scrollingElement;
}

function isPage(el: Element): boolean {
  return el === document.body || el === document.documentElement ||
    el === document.scrollingElement;
}

/**
 * Brings `el` (a focused field, or its row with the submit) into view right
 * above the on-screen keyboard: its scroller moves so its bottom sits 12 px
 * above the keyboard, or above the scroller's own visible bottom when that
 * is higher (a sheet's actions); one already in view with 8 px or more to
 * spare stays where it is (`liftBy`). Without a keyboard, as
 * `scrollIntoView({block: "nearest"})`. Smooth only when asked and motion is
 * not reduced; the page never scrolls while pinch-zoomed.
 */
export function aboveKeyboard(
  el: Element,
  { smooth = false }: { smooth?: boolean } = {},
): void {
  const vv = globalThis.visualViewport;
  const zoomed = (vv?.scale ?? 1) > ZOOMED;
  const behavior: ScrollBehavior =
    smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "smooth"
      : "auto";
  if (!zoomed && !keyboardShown()) {
    el.scrollIntoView({ block: "nearest", behavior });
    return;
  }
  const scroller = scrollerOf(el);
  if (!scroller || (zoomed && isPage(scroller))) return;
  const page = isPage(scroller);
  const box = scroller.getBoundingClientRect();
  let ceil = page ? 0 : box.top;
  let floor = page ? innerHeight : box.bottom;
  if (!zoomed && vv) {
    ceil = Math.max(ceil, vv.offsetTop);
    floor = Math.min(floor, vv.offsetTop + vv.height);
  }
  const r = el.getBoundingClientRect();
  const by = liftBy(r.top, r.bottom, ceil, floor);
  if (by !== 0) scroller.scrollBy({ top: by, behavior });
}
