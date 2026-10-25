// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Normalisation on load (ui.md §14.2): unknown keys are dropped,
 * an invalid value becomes `calm`'s, `r.control` is clamped to 0–28, the
 * `fx` strengths to 0–1, colours must be `#RRGGBB` (stored uppercase). Also
 * reads a stored appearance preference (ui.md §14.7), including the `{ preset }`
 * shape of older builds.
 */

import { PRESETS } from "./presets.ts";
import {
  type AppearancePref,
  DEFAULT_APPEARANCE,
  FIGURE_VARIANTS,
  type Hex,
  INTENSITY_VARIANTS,
  OPTION_VARIANTS,
  PRESET_IDS,
  type PresetId,
  type ThemeColors,
  type ThemeV1,
} from "./schema.ts";

const HEX = /^#[0-9A-F]{6}$/i;
const COLOR_KEYS: ReadonlyArray<Exclude<keyof ThemeColors, "ground2">> = [
  "ground",
  "surface",
  "ink",
  "muted",
  "line",
  "track",
  "accent",
  "choice",
  "onChoice",
  "figure",
  "figureLine",
  "figureSel",
  "bloom",
  "primary",
  "onPrimary",
];
const FONTS = new Set([
  "Onest",
  "Golos Text",
  "IBM Plex Sans",
  "Manrope",
  "Rubik",
  "Unbounded",
  "Literata",
  "JetBrains Mono",
  "Hanken Grotesk",
  "Plus Jakarta Sans",
  "Sora",
  "Newsreader",
]);

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? v as Loose : {};

export function isHex(v: unknown): v is Hex {
  return typeof v === "string" && HEX.test(v);
}

const hex = (v: unknown): Hex | null =>
  isHex(v) ? v.toUpperCase() as Hex : null;

/** `v` when it is one of `allowed`, else `fallback` */
function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? v as T : fallback;
}

/** A theme from anything (an import, a future custom theme), never throwing */
export function normalizeTheme(raw: unknown): ThemeV1 {
  const base = PRESETS.calm;
  const t = obj(raw), c = obj(t.c), f = obj(t.f), r = obj(t.r), v = obj(t.v);
  const fx = obj(t.fx);
  /** A strength 0–1; missing or not a number: Calm's */
  const unit = (x: unknown, fb: number) =>
    typeof x === "number" && Number.isFinite(x)
      ? Math.max(0, Math.min(1, x))
      : fb;
  const tp = obj(t.tp);
  const colors = {} as ThemeColors;
  for (const k of COLOR_KEYS) colors[k] = hex(c[k]) ?? base.c[k];
  const ground2 = hex(c.ground2);
  if (ground2) colors.ground2 = ground2;
  const font = (x: unknown, fb: ThemeV1["f"]["ui"]) =>
    FONTS.has(x as string) ? x as ThemeV1["f"]["ui"] : fb;
  const control = typeof r.control === "number" && Number.isFinite(r.control)
    ? Math.max(0, Math.min(28, r.control))
    : base.r.control;
  const tint = oneOf(t.tint, ["light", "dark", null] as const, null);
  return {
    schema: 1,
    name: typeof t.name === "string" && t.name.trim()
      ? t.name.slice(0, 32)
      : base.name,
    tint,
    tp: tint === "light" && typeof tp.gs === "number"
      ? {
        gs: tp.gs,
        choice: oneOf(tp.choice, ["ink", "accent"] as const, "ink"),
        primary: oneOf(tp.primary, ["ink", "accent"] as const, "ink"),
      }
      : null,
    seed: hex(t.seed),
    grad: t.grad === true,
    seed2: hex(t.seed2),
    c: colors,
    f: {
      ui: font(f.ui, base.f.ui),
      display: font(f.display, base.f.display),
      displayWeight: oneOf(
        f.displayWeight,
        [400, 500, 600, 700, 800] as const,
        base.f.displayWeight,
      ),
      mono: "JetBrains Mono",
      labels: oneOf(f.labels, ["normal", "mono"] as const, base.f.labels),
    },
    r: {
      control,
      chip: oneOf(r.chip, [2, 10, 12, 999] as const, base.r.chip),
    },
    shadow: typeof t.shadow === "boolean" ? t.shadow : base.shadow,
    v: {
      progress: oneOf(
        v.progress,
        ["segments", "bar", "dots", "counter"] as const,
        base.v.progress,
      ),
      heading: oneOf(
        v.heading,
        ["plain", "eyebrow", "editorial"] as const,
        base.v.heading,
      ),
      stepLabel: typeof v.stepLabel === "boolean"
        ? v.stepLabel
        : base.v.stepLabel,
      tabs: oneOf(v.tabs, ["segmented", "underline"] as const, base.v.tabs),
      options: oneOf(
        v.options,
        OPTION_VARIANTS,
        base.v.options,
      ),
      l2: oneOf(v.l2, ["chips", "inline"] as const, base.v.l2),
      intensity: oneOf(
        v.intensity,
        INTENSITY_VARIANTS,
        base.v.intensity,
      ),
      figure: oneOf(
        v.figure,
        FIGURE_VARIANTS,
        base.v.figure,
      ),
      figureLabels: typeof v.figureLabels === "boolean"
        ? v.figureLabels
        : base.v.figureLabels,
      confidence: oneOf(
        v.confidence,
        ["buttons", "segmented"] as const,
        base.v.confidence,
      ),
      summary: oneOf(v.summary, ["plain", "dot"] as const, base.v.summary),
    },
    fx: {
      glow: unit(fx.glow, base.fx.glow),
      edge: unit(fx.edge, base.fx.edge),
      sheen: unit(fx.sheen, base.fx.sheen),
      depth: oneOf(fx.depth, [0, 1, 2] as const, base.fx.depth),
      bg: unit(fx.bg, base.fx.bg),
    },
  };
}

/** A stored preference; older builds stored `{ preset }` */
export function normalizeAppearance(raw: unknown): AppearancePref {
  const p = obj(raw);
  const themeId = oneOf<PresetId>(
    p.themeId ?? p.preset,
    PRESET_IDS,
    DEFAULT_APPEARANCE.themeId,
  );
  const fixed = !PRESETS[themeId].tint;
  const gradient = !fixed && p.gradient === true;
  return {
    themeId,
    seed: fixed ? null : hex(p.seed),
    gradient,
    seed2: gradient ? hex(p.seed2) : null,
    // Present only when on, so older prefs and older clients read the same
    ...(p.auto === true ? { auto: true } : {}),
    ...(p.still === true ? { still: true } : {}),
    ...(p.leftHanded === true ? { leftHanded: true } : {}),
  };
}
