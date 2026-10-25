// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The thumb band (ui.md §4.5, Reach v2): on a phone (< 900 px)
 * the bottom third of the visual viewport, where every control rests; on a
 * phone under 500 px high (held sideways) the bottom half, at least 300 px.
 * A screen is a stage (what is read) over a band (what is touched): the
 * stage takes at least `stageMin`, so the band starts at the band's top edge
 * (`restLow`, the `.rl-*` classes in fx.css). Nothing here touches the page
 * until it is called: e2e code imports it too.
 */
import { PHONE, screenTop } from "./reach.ts";
import { viewportHeight } from "./viewport.ts";

export { PHONE, screenTop };

/** A phone held sideways (with PHONE): `ui.layout` `short`, html[data-short] */
export const SHORT = "(max-height: 499px)";

/** Under this keyboard-free height a phone is short */
export const SHORT_PX = 500;

/** At least this much of a short phone is the band */
const SHORT_BAND_PX = 300;

export function isShort(h: number): boolean {
  return h < SHORT_PX;
}

/** The band's height on a phone whose visual viewport is `h` px high */
export function bandHeight(h: number): number {
  return isShort(h) ? Math.min(h, Math.max(SHORT_BAND_PX, h / 2)) : h / 3;
}

/** The band's top edge, px down from the visual viewport's top */
export function bandTop(h: number): number {
  return h - bandHeight(h);
}

/**
 * The least height of a stage whose top is `top` px down, so what follows it
 * starts in the band; whole pixels, rounded up, so it never starts above
 */
export function stageMin(h: number, top: number): number {
  return Math.max(0, Math.ceil(bandTop(h) - top));
}

/** Where a scroller rests: its top, or as far as its content goes */
export function restScrollTop(
  anchor: "start" | "end",
  scrollHeight: number,
  clientHeight: number,
): number {
  return anchor === "start" ? 0 : Math.max(0, scrollHeight - clientHeight);
}

/** A scroller at its end (within a pixel's rounding): it stays pinned there */
export function atEnd(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollTop >= scrollHeight - clientHeight - 2;
}

export interface RestLow {
  /** Back to the resting place: the top ("start") or the end ("end") */
  rest(): void;
  /** Measured again, the place kept */
  refresh(): void;
  stop(): void;
}

/**
 * Rest-low for `scroller` (ui.md §4.5): `--stage-min` on
 * `stage`, else on the scroller for the `.rl-stage` inside it, so its band
 * starts at the band's top edge (0 on a desktop). Measured again when the
 * visual viewport or the window changes size, and when the scroller, the
 * stage or the content (`.rl-root`) does. With `anchor: "end"` a scroller at
 * its end stays there as its content grows (new content arrives from the
 * bottom); scrolled up, it keeps its place.
 */
export function restLow(
  scroller: HTMLElement,
  { anchor, stage }: { anchor: "start" | "end"; stage?: HTMLElement },
): RestLow {
  const phone = matchMedia(PHONE);
  const target = stage ?? scroller;
  let written = "";
  let pinned = anchor === "end";
  /** The scroller's place when last seen at its end */
  let endAt = 0;
  let frame = 0;

  /** The stage's top on screen with the scroller at its top */
  function topAtRest(el: HTMLElement): number {
    const top = screenTop(scroller);
    if (el === scroller) return top;
    return top + scroller.scrollTop + el.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top;
  }

  function measure() {
    const el = stage ?? scroller.querySelector<HTMLElement>(".rl-stage") ??
      scroller;
    const min = phone.matches ? stageMin(viewportHeight(), topAtRest(el)) : 0;
    const value = `${min}px`;
    if (value === written) return;
    written = value;
    target.style.setProperty("--stage-min", value);
  }

  function toRest() {
    scroller.scrollTop = restScrollTop(
      anchor,
      scroller.scrollHeight,
      scroller.clientHeight,
    );
    endAt = scroller.scrollTop;
  }

  function pin() {
    if (anchor !== "end" || !pinned) return;
    // Scrolled up since, its scroll event still to come: kept there
    if (scroller.scrollTop < endAt - 2) pinned = false;
    else toRest();
  }

  // Measured a frame later: a size written from a ResizeObserver callback
  // would be observed again in the same frame (a loop error)
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
      pin();
    });
  }

  const onScroll = () => {
    pinned = anchor === "end" &&
      atEnd(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight);
    if (pinned) endAt = scroller.scrollTop;
  };
  const onResize = () => schedule();
  const onContent = () => {
    pin();
    schedule();
  };

  const vv = globalThis.visualViewport ?? null;
  const observer = new ResizeObserver(onContent);
  const content = scroller.querySelector<HTMLElement>(".rl-root");
  for (const el of [scroller, stage, content]) if (el) observer.observe(el);
  if (!content) {
    for (const el of scroller.children) observer.observe(el);
  }
  vv?.addEventListener("resize", onResize);
  addEventListener("resize", onResize);
  phone.addEventListener("change", onResize);
  scroller.addEventListener("scroll", onScroll, { passive: true });
  measure();

  return {
    rest() {
      measure();
      toRest();
      pinned = anchor === "end";
    },
    refresh() {
      measure();
      pin();
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      vv?.removeEventListener("resize", onResize);
      removeEventListener("resize", onResize);
      phone.removeEventListener("change", onResize);
      scroller.removeEventListener("scroll", onScroll);
    },
  };
}
