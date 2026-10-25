// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Readable device rows for Settings → Devices: "iPhone · Safari" from a user
 * agent, and "2 h ago" in the current language.
 * Specification: ui.md §11.6.
 */

export function deviceName(ua: string): string | null {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
    ? "iPad"
    : /Android/.test(ua)
    ? "Android"
    : /Mac OS X|Macintosh/.test(ua)
    ? "Mac"
    : /Windows/.test(ua)
    ? "Windows"
    : /Linux/.test(ua)
    ? "Linux"
    : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(ua)
    ? "Firefox"
    : /Chrome\/|CriOS/.test(ua)
    ? "Chrome"
    : /Safari\//.test(ua)
    ? "Safari"
    : null;
  if (!os && !browser) return null;
  return [os, browser].filter(Boolean).join(" · ");
}

/** "5 min ago", "2 h ago", "3 days ago" — the largest whole unit. */
export function timeAgo(iso: string, locale: string, now = Date.now()): string {
  const sec = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "short",
  });
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(sec, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86_400), "day");
}
