// SPDX-License-Identifier: AGPL-3.0-or-later
// The theme before the first paint (ui.md §14.3): the resolved
// CSS values cached in localStorage['emo-css'] by the app (values only, never
// the theme name or anything the person wrote), and with "Match the system"
// a second set for dark mode. A plain external script, as
// the CSP allows no inline one; CSSOM calls are not subject to `style-src`.
try {
  let css = JSON.parse(localStorage.getItem("emo-css") || "null");
  // "Match the system" caches a dark variant too (ui.md §13)
  if (
    css && css.dark && typeof css.dark.vars === "object" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  ) css = css.dark;
  if (css && typeof css.vars === "object") {
    const root = document.documentElement;
    for (const name of Object.keys(css.vars)) {
      const value = css.vars[name];
      if (/^--[a-z0-9-]+$/.test(name) && typeof value === "string") {
        root.style.setProperty(name, value);
      }
    }
    if (typeof css.themeColor === "string") {
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", css.themeColor);
    }
  }
} catch {
  // Storage blocked or garbled: the default theme
}
