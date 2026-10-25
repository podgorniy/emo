// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sticky heads (ui.md §11, §15.4): a pane's title,
 * its section or day headers and an open History record's row stay in view
 * while what they head scrolls under them — under the safe area and the
 * offline band on a phone, under the pane bar on a desktop (settings.css).
 * They are clear at rest, so the light behind the pane shows through, and
 * take a background only while held away from their place in the flow
 * (`data-stuck`), as the desktop pane bar does once content scrolls under it.
 *
 * Each head is the first child of the box it heads, so its place in the flow
 * is that box's top.
 */

/** The heads in a pane: its title, section and day headers, records' rows */
const HEADS = ".settings-header, .section-header, .entry > .head";

/** Where `head` would be without sticking: the top of its box's content */
function homeOf(head: HTMLElement): number {
  const box = head.parentElement!;
  return box.getBoundingClientRect().top + box.clientTop +
    (parseFloat(getComputedStyle(box).paddingTop) || 0) +
    (parseFloat(getComputedStyle(head).marginTop) || 0);
}

/**
 * Keeps `data-stuck` on the heads in `pane` (an action on the pane): on a
 * scroll of the page (boot.css: the body scrolls), a resize, and whenever
 * the pane changes size (a record opening or closing, a page more of
 * History).
 */
export function stickyHeads(pane: HTMLElement) {
  let frame = 0;

  function update() {
    frame = 0;
    const heads = [...pane.querySelectorAll<HTMLElement>(HEADS)];
    // Every read first, then the writes. Held: drawn below its place and
    // still showing past its sticky line. A head whose box has scrolled
    // away rests at that box's bottom, under the heads above or off screen,
    // and is not held
    const on = heads.map((el) => {
      const r = el.getBoundingClientRect();
      const line = parseFloat(getComputedStyle(el).top) || 0;
      return r.top > homeOf(el) + 0.5 && r.bottom > line + 0.5;
    });
    heads.forEach((el, i) => el.toggleAttribute("data-stuck", on[i]));
  }

  const schedule = () => {
    frame ||= requestAnimationFrame(update);
  };
  const resized = new ResizeObserver(schedule);
  resized.observe(pane);
  document.body.addEventListener("scroll", schedule, { passive: true });
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  schedule();

  return {
    destroy() {
      cancelAnimationFrame(frame);
      resized.disconnect();
      document.body.removeEventListener("scroll", schedule);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
    },
  };
}
