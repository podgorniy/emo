// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Apple keyboards say ⌘ where others say Ctrl: the check-in's keyboard
 * legend reads "⌘ + Enter" there (ui.md §5.4, UX-16).
 */
export function isApplePlatform(
  ua: string = globalThis.navigator?.userAgent ?? "",
  platform: string = globalThis.navigator?.platform ?? "",
): boolean {
  return /^(Mac|iPhone|iPad|iPod)/.test(platform) ||
    /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(ua);
}
