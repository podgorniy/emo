// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reach room (ui.md §4.5, owner decision 2026-10-10): on a phone
 * every control can be brought down into the bottom third of the screen,
 * under the thumb. A scroller keeps room above its content, enough to bring
 * its top edge down to two thirds of the screen's height, and rests with
 * that room just out of view: a screen opens as it always looked, and a pull
 * down brings its topmost controls within reach. None on a desktop
 * (≥ 900 px).
 */

export const PHONE = "(max-width: 899px)";

/** The room above a scroller whose top edge is `top` px down a screen `height` px high */
export function roomFor(height: number, top: number): number {
  return Math.max(0, Math.ceil((height * 2) / 3 - top));
}

/** Where a scroller rests: its room just out of view, or as far as its content goes */
export function restingTop(
  room: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, Math.min(room, scrollHeight - clientHeight));
}

/**
 * An element's top on screen. In a fixed box (a sheet, which rises in by a
 * transform) its place in the layout, transforms aside; elsewhere where it is
 * drawn, whatever the page's own room and scroll are at that moment
 */
export function screenTop(el: HTMLElement): number {
  let y = 0;
  let last: HTMLElement = el;
  for (
    let e: HTMLElement | null = el;
    e;
    e = e.offsetParent as HTMLElement | null
  ) {
    y += e.offsetTop;
    last = e;
  }
  return getComputedStyle(last).position === "fixed"
    ? y
    : el.getBoundingClientRect().top;
}

export interface Reach {
  /** The room now, in px (0 on a desktop) */
  readonly room: number;
  /** Back to the resting place: a new screen, a new step */
  rest(): void;
  /** The room measured again, the place kept (a deep link scrolled it) */
  refresh(): void;
  stop(): void;
}

/**
 * Room above `scroller`'s content: the height of `spacer`, its first child,
 * or else `--reach` on the scroller for its own CSS (its top padding). Their
 * CSS must say `transition-property: none`: under reduced motion every
 * property takes a 0.01 ms transition (boot.css), which lands a frame later,
 * after the scroll position is set. `fit`:
 * the content of a scroller as high as its content (a sheet's body), whose
 * height it keeps, so the room scrolls instead of growing it. `wanted`:
 * whether the screen on show has room at all.
 */
export function keepReach(
  scroller: HTMLElement,
  { spacer, fit, wanted = () => true }: {
    spacer?: HTMLElement;
    fit?: HTMLElement;
    wanted?: () => boolean;
  } = {},
): Reach {
  const phone = matchMedia(PHONE);
  let room = 0;

  /**
   * Browsers hold the view still when content above it changes, except at
   * the very top. At rest the top of the content is the room's edge, so
   * there too nothing is held: a hint that grows or a card that arrives
   * pushes the content down in view, as it did without the room
   */
  let atTop: boolean | null = null;
  function anchor() {
    const top = scroller.scrollTop <= room + 1;
    if (top === atTop) return;
    atTop = top;
    if (top) scroller.style.overflowAnchor = "none";
    else scroller.style.removeProperty("overflow-anchor");
  }

  function fitHeight() {
    if (!fit) return;
    if (room === 0) scroller.style.removeProperty("height");
    else {
      // Border box: the room is padding inside it, so the content overflows by it
      const cs = getComputedStyle(scroller);
      const below = parseFloat(cs.paddingBottom) || 0;
      scroller.style.height = `${fit.offsetHeight + below}px`;
    }
  }

  function measure(rest: boolean) {
    const before = room;
    room = phone.matches && wanted()
      ? roomFor(innerHeight, screenTop(scroller))
      : 0;
    if (spacer) spacer.style.height = `${room}px`;
    else scroller.style.setProperty("--reach", `${room}px`);
    fitHeight();
    if (rest) {
      scroller.scrollTop = restingTop(
        room,
        scroller.scrollHeight,
        scroller.clientHeight,
      );
    } else if (room !== before && scroller.scrollTop >= before) {
      // A new size: what was on screen stays there
      scroller.scrollTop += room - before;
    }
    anchor();
  }

  const onResize = () => measure(false);
  const observer = fit ? new ResizeObserver(fitHeight) : null;
  if (fit) observer!.observe(fit);
  addEventListener("resize", onResize);
  phone.addEventListener("change", onResize);
  scroller.addEventListener("scroll", anchor, { passive: true });
  measure(true);

  return {
    get room() {
      return room;
    },
    rest: () => measure(true),
    refresh: () => measure(false),
    stop() {
      observer?.disconnect();
      removeEventListener("resize", onResize);
      phone.removeEventListener("change", onResize);
      scroller.removeEventListener("scroll", anchor);
    },
  };
}

let page: Reach | null = null;

/**
 * The page's own room (App): the panes and the sign-in screens, whose
 * scroller is `body`; `spacer` is App's first element. None while `wanted`
 * says no (the form has its own).
 */
export function startPageReach(
  spacer: HTMLElement,
  wanted: () => boolean,
): Reach {
  page?.stop();
  page = keepReach(document.body, { spacer, wanted });
  return page;
}

/** The page's room now, in px: where its top rests */
export function pageRoom(): number {
  return page?.room ?? 0;
}
