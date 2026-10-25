// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Client theme manager: applying palette, fonts, and contrast modes.
 * Specification: ui.md §14, shared/theme/.
 */

import type { AppearancePref, ThemeV1 } from "../../../shared/theme/schema.ts";
import {
  AUTO_DARK,
  AUTO_LIGHT,
  DEFAULT_APPEARANCE,
} from "../../../shared/theme/schema.ts";
import {
  accentText,
  contrastRatio,
  luminance,
  resolveTheme,
} from "../../../shared/theme/tint.ts";
import { normalizeAppearance } from "../../../shared/theme/validate.ts";
import { fontStack } from "../../../shared/theme/fonts.ts";
import { fxVars } from "../../../shared/theme/fx.ts";
import {
  canonicalizeJson,
  COPY_VERSION,
  type EntryUI,
  type UiLayout,
} from "../../../shared/entry.ts";
import { sha256 } from "../../../shared/crypto/e2e.ts";
import { encodeHex } from "../../../shared/crypto/encoding.ts";
import { removeMeta } from "./db.ts";
import { isShort, PHONE } from "./band.ts";
import { keyboardFreeHeight, onViewportChange } from "./viewport.ts";

export type { AppearancePref };

const CSS_CACHE_KEY = "emo-css";

let currentAppearance: AppearancePref = { ...DEFAULT_APPEARANCE };
let currentTheme: ThemeV1 = resolveTheme(currentAppearance);

/** The device's dark setting, for "Match the system" (UX-26) */
const darkQuery = typeof matchMedia === "function"
  ? matchMedia("(prefers-color-scheme: dark)")
  : null;
darkQuery?.addEventListener("change", () => {
  if (currentAppearance.auto) applyTheme(currentAppearance);
});

/**
 * More contrast or forced colours: every light effect resolves to nothing
 * (ui.md §14.3, §10), followed live; `boot.css` has the same
 * rule as a backstop for the first paint.
 */
const plainQueries = typeof matchMedia === "function"
  ? [
    matchMedia("(prefers-contrast: more)"),
    matchMedia("(forced-colors: active)"),
  ]
  : [];
for (const q of plainQueries) {
  q.addEventListener("change", () => applyTheme(currentAppearance));
}

/** True when the device asks for no light effects (contrast, forced colours) */
export function fxOff(): boolean {
  return plainQueries.some((q) => q.matches);
}

/**
 * What is painted: the chosen theme, or with "Match the system" Calm in
 * light mode and Dusk in dark mode (ui.md §13). Opt-in: the app
 * stays light by default (D4).
 */
export function effectiveAppearance(
  pref: AppearancePref,
  dark = darkQuery?.matches ?? false,
): AppearancePref {
  if (!pref.auto) return pref;
  return dark ? AUTO_DARK : AUTO_LIGHT;
}

export function getAppearance(): AppearancePref {
  return currentAppearance;
}

/** The resolved theme being painted (variants are read from it) */
export function getTheme(): ThemeV1 {
  return currentTheme;
}

const themeListeners = new Set<(theme: ThemeV1) => void>();

/** Calls `fn` with each newly applied theme; returns the unsubscribe. */
export function onThemeChange(fn: (theme: ThemeV1) => void): () => void {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

/**
 * How the form is laid out now (`ui.layout`, data.md §3.6): `wide`
 * from 900 px, else `phone`, or `short` under 500 px high (a phone held
 * sideways). The height is the keyboard-free one (lib/viewport.ts), so a
 * save with the keyboard up never reads `short` (and makes the entry
 * `mixed`); `layout.short` reads the same. Unknown (missing) without a window.
 */
export function currentLayout(): UiLayout | undefined {
  if (typeof matchMedia !== "function") return undefined;
  if (!matchMedia(PHONE).matches) return "wide";
  return isShort(keyboardFreeHeight()) ? "short" : "phone";
}

/**
 * Calls `fn` when `currentLayout()` has changed (turned sideways, a window
 * resized across 900 px or 500 px high); returns the unsubscribe.
 */
export function onLayoutChange(fn: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const phone = matchMedia(PHONE);
  let last = currentLayout();
  const check = () => {
    const now = currentLayout();
    if (now === last) return;
    last = now;
    fn();
  };
  phone.addEventListener("change", check);
  const stop = onViewportChange(check);
  return () => {
    phone.removeEventListener("change", check);
    stop();
  };
}

/**
 * The entry's `ui` field (data.md §3.6): which controls recorded the
 * answers, in which copy and layout. In
 * v1 the controls are the same in every theme (principle 11), so only
 * `theme` varies: the first 16 hex characters of SHA-256 over the canonical
 * resolved theme (ui.md §14.7). Over a draft's, its copy stays and the layouts
 * merge (`machine.mergeUi`).
 */
export async function currentEntryUi(): Promise<EntryUI> {
  const digest = await sha256(canonicalizeJson(currentTheme));
  const layout = currentLayout();
  return {
    theme: encodeHex(digest).slice(0, 16),
    intensity: "slider",
    options: "grid",
    figure: "solid",
    copy: COPY_VERSION,
    ...(layout ? { layout } : {}),
  };
}

/** Text on an accent fill: white where it reads, else the darker of ground and ink */
function onAccent(c: ThemeV1["c"]): string {
  if (contrastRatio("#FFFFFF", c.accent) >= 4.5) return "#FFFFFF";
  return contrastRatio(c.ground, c.accent) >= contrastRatio(c.ink, c.accent)
    ? c.ground
    : c.ink;
}

/** The CSS variables of ui.md §14.3 for a resolved theme */
export function themeCss(t: ThemeV1): Record<string, string> {
  const c = t.c;
  const control = t.r.control;
  return {
    "--c-ground": c.ground,
    "--c-surface": c.surface,
    "--c-ink": c.ink,
    "--c-muted": c.muted,
    "--c-line": c.line,
    "--c-track": c.track,
    "--c-accent": c.accent,
    // The accent as text on the page: readable on every ground (ui.md §14.3)
    "--c-accent-text": accentText(c),
    "--c-choice": c.choice,
    "--c-on-choice": c.onChoice,
    "--c-figure": c.figure,
    "--c-figure-line": c.figureLine,
    // The measurement highlight: identical in every theme (principle 7)
    "--c-figure-sel": c.figureSel,
    "--c-bloom": c.bloom,
    "--c-primary": c.primary,
    "--c-on-primary": c.onPrimary,
    "--c-on-accent": onAccent(c),
    // Text on the highlight (the body map's count badge)
    "--c-on-figure-sel": luminance(c.ground) < 0.2 ? c.ground : "#FFFFFF",
    // The page background: the gradient when it is on (ui.md §14.3)
    "--c-page": c.ground2
      ? `linear-gradient(165deg, ${c.ground}, ${c.ground2})`
      : c.ground,
    "--r-control": `${control}px`,
    "--r-chip": `${t.r.chip}px`,
    // Cards a step rounder than controls; square themes stay square, and
    // fields no rounder than 14 px (ui.md §14.3)
    "--r-card": `${
      control <= 6 ? control : Math.max(12, Math.min(24, control + 4))
    }px`,
    "--r-field": `${Math.min(control, 14)}px`,
    "--font-ui": fontStack(t.f.ui),
    "--font-display": fontStack(t.f.display),
    "--font-mono": fontStack(t.f.mono),
    "--display-weight": String(t.f.displayWeight),
    // Light, depth, derived states and the ambient fields (shared/theme/fx.ts)
    ...fxVars(t, fxOff()),
  };
}

export function applyTheme(appearance: AppearancePref): void {
  currentAppearance = normalizeAppearance(appearance);
  currentTheme = resolveTheme(effectiveAppearance(currentAppearance));
  for (const fn of themeListeners) fn(currentTheme);

  if (typeof document === "undefined") return;
  const vars = themeCss(currentTheme);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", currentTheme.c.ground);
  if (currentAppearance.leftHanded) {
    root.setAttribute("data-handed", "left");
  } else {
    root.removeAttribute("data-handed");
  }
  // For /boot.js on the next start: values only, never the theme's name
  // (ui.md §14.3; the choice itself is in encrypted prefs).
  // With "Match the system" both, so a dark start paints dark at once
  const cache = (pref: AppearancePref) => {
    const theme = resolveTheme(pref);
    return { vars: themeCss(theme), themeColor: theme.c.ground };
  };
  try {
    localStorage.setItem(
      CSS_CACHE_KEY,
      JSON.stringify(
        currentAppearance.auto
          ? { ...cache(AUTO_LIGHT), dark: cache(AUTO_DARK) }
          : { vars, themeColor: currentTheme.c.ground },
      ),
    );
  } catch {
    // Storage blocked: the next start paints the default theme first
  }
}

/**
 * At start: /boot.js has painted the cached values already, so nothing is
 * re-applied over them; without a cache the default theme is. The chosen
 * preset is known once the encrypted prefs are read (`applyStoredPrefs`,
 * after unlocking). Copies older builds kept in plaintext are deleted.
 */
export async function initTheme(): Promise<void> {
  let cached = false;
  try {
    cached = localStorage.getItem(CSS_CACHE_KEY) !== null;
    localStorage.removeItem("emo-theme-preset");
  } catch {
    // Storage blocked
  }
  if (!cached) applyTheme(currentAppearance);
  await removeMeta("appearance").catch(() => {});
}

/**
 * A whole preference from the encrypted prefs (this device's or another's,
 * possibly in an older shape): it replaces the current one, never merges.
 */
export function setAppearance(raw: unknown): void {
  applyTheme(normalizeAppearance(raw));
}

/** A change made here, in Settings → Appearance */
export function updateTheme(
  partial: Partial<AppearancePref>,
): void {
  currentAppearance = { ...currentAppearance, ...partial };
  applyTheme(currentAppearance);
}
