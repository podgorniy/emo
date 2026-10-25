// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The layout the screens arrange for (ui.md §4.5, Reach v2;
 * `ui.layout`, data.md §3.6), reactive: `phone` under 900 px wide;
 * `short`, a phone whose keyboard-free height is under 500 px (held
 * sideways), also said as html[data-short] for CSS (`--band`); `kb`, an
 * on-screen keyboard is up (html[data-kb], lib/viewport.ts). `short` reads
 * the keyboard-free height, so it never flips while a keyboard is up (a
 * phone turned with it up aside): typing never rearranges a screen. The same
 * reading as `theme.currentLayout()`, which the saved entry records.
 */
import { isShort, PHONE } from "./band.ts";
import {
  keyboardFreeHeight,
  keyboardShown,
  onViewportChange,
} from "./viewport.ts";

const phoneQuery = typeof matchMedia === "function" ? matchMedia(PHONE) : null;

const state = $state(read());

function read(): { phone: boolean; short: boolean; kb: boolean } {
  const phone = phoneQuery?.matches ?? false;
  return {
    phone,
    short: phone && isShort(keyboardFreeHeight()),
    kb: keyboardShown(),
  };
}

export const layout: {
  readonly phone: boolean;
  readonly short: boolean;
  readonly kb: boolean;
} = {
  get phone() {
    return state.phone;
  },
  get short() {
    return state.short;
  },
  get kb() {
    return state.kb;
  },
};

function update() {
  const next = read();
  if (next.phone !== state.phone) state.phone = next.phone;
  if (next.short !== state.short) state.short = next.short;
  if (next.kb !== state.kb) state.kb = next.kb;
  document.documentElement.toggleAttribute("data-short", next.short);
}

let started = false;

/**
 * Follows the window from now on (main.ts, after `startViewportWatch` and
 * before the app mounts); once only
 */
export function startLayout(): void {
  if (started) return;
  started = true;
  phoneQuery?.addEventListener("change", update);
  onViewportChange(update);
  update();
}
