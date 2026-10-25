// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Base colour, gradient and checks: a TypeScript port of the reference
 * generator in ui.md §14.6 (the exact code the prototype used),
 * and the resolver that turns a stored `AppearancePref` into the theme the
 * app paints (ui.md §14.7), with the fields fixed in v1 forced (ui.md §14.1).
 */

import { FONT_MIGRATION } from "./fonts.ts";
import { PRESETS } from "./presets.ts";
import {
  type AppearancePref,
  DEFAULT_APPEARANCE,
  type Hex,
  type LightParams,
  type PresetData,
  type ThemeColors,
  type ThemeV1,
} from "./schema.ts";

/** The body-map and intensity highlight: fixed, cool, theme-independent (principle 7) */
export const MEASURE = { light: "#4F46E5", dark: "#8EA2FF" } as const;

/** The base-colour swatches of Settings → Appearance (ui.md §13, §14.6) */
export const SEEDS: ReadonlyArray<{ id: string; hex: Hex; label: string }> = [
  { id: "teal", hex: "#1F7A73", label: "Teal" },
  { id: "sky", hex: "#2563A8", label: "Sky" },
  { id: "indigo", hex: "#4F46E5", label: "Indigo" },
  { id: "sage", hex: "#4E7A3F", label: "Sage" },
  { id: "lilac", hex: "#6A4FA8", label: "Lilac" },
  { id: "slate", hex: "#4A5A6E", label: "Slate" },
  { id: "rose", hex: "#A8456A", label: "Rose" },
  { id: "amber", hex: "#B7791F", label: "Amber" },
];

const hx = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export function toHsl(h: string): [number, number, number] {
  const [r, g, b] = hx(h).map((x) => x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l * 100];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const H =
    (mx === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : mx === g
      ? (b - r) / d + 2
      : (r - g) / d + 4) * 60;
  return [H, s * 100, l * 100];
}

export function hsl(h: number, s: number, l: number): Hex {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    Math.round(
      255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))),
    );
  return ("#" +
    [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, "0")).join("")
      .toUpperCase()) as Hex;
}

/** WCAG relative luminance */
export function luminance(h: string): number {
  const a = hx(h).map((x) => {
    x /= 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/** WCAG contrast ratio */
export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Moves lightness by `dir` until the colour reaches 4.6:1 against `against`. */
function fit(h: number, s: number, l: number, against: string, dir: number) {
  let x = hsl(h, s, l), i = 0;
  while (contrastRatio(x, against) < 4.6 && i < 80) {
    l += dir;
    x = hsl(h, s, l);
    i++;
  }
  return x;
}

/** `a` moved toward `b` by `t` (0–1), in sRGB. */
export function mix(a: string, b: string, t: number): Hex {
  const [r1, g1, b1] = hx(a), [r2, g2, b2] = hx(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`.toUpperCase() as Hex;
}

/**
 * The accent as text on the page — a link, the editorial key phrase
 * (ui.md §14.3 `--c-accent-text`). The accent is a fill colour
 * and ui.md §14.6 never checks it against the ground, so where it does not read at
 * 4.5:1 on every ground (both, with a gradient) it is moved toward the ink in
 * tenths until it does. The ink always does: `checks` holds it to 4.5:1 on
 * every ground (WCAG 1.4.3).
 */
export function accentText(c: ThemeColors): Hex {
  const grounds = [c.ground].concat(c.ground2 ? [c.ground2] : []);
  for (let i = 0; i <= 10; i++) {
    const x = mix(c.accent, c.ink, i / 10);
    if (grounds.every((g) => contrastRatio(x, g) >= 4.5)) return x;
  }
  return c.ink;
}

/** Hue < 55° or > 340° with saturation > 35 % */
export function warm(h: string): boolean {
  const [H, S] = toHsl(h);
  return (H < 55 || H > 340) && S > 35;
}

export function light(seed: string, p?: LightParams | null): ThemeColors {
  const [H, S0] = toHsl(seed);
  const S = Math.max(25, Math.min(75, S0));
  const gs = (p && p.gs) || 0.5;
  const ground = hsl(H, S * gs, 92),
    surface = hsl(H, S * gs * 1.1, 98),
    ink = hsl(H, S * 0.6, 13);
  const accent = fit(H, S, 42, "#FFFFFF", -1);
  return {
    ground,
    surface,
    ink,
    muted: fit(H, S * 0.28, 36, ground, -1),
    line: hsl(H, S * 0.4, 77),
    track: hsl(H, S * 0.45, 85),
    accent,
    choice: p && p.choice === "accent" ? accent : ink,
    onChoice: "#FFFFFF",
    figure: surface,
    figureLine: hsl(H, S * 0.25, 57),
    figureSel: MEASURE.light,
    bloom: MEASURE.light,
    primary: p && p.primary === "accent" ? accent : ink,
    onPrimary: "#FFFFFF",
  };
}

export function dark(seed: string): ThemeColors {
  const [H, S0] = toHsl(seed);
  const S = Math.max(25, Math.min(80, S0));
  const ground = hsl(H, S * 0.45, 9),
    accent = fit(H, S, 66, hsl(H, S * 0.4, 14), 1);
  return {
    ground,
    surface: hsl(H, S * 0.4, 14),
    ink: hsl(H, S * 0.25, 94),
    muted: hsl(H, S * 0.15, 68),
    line: hsl(H, S * 0.3, 25),
    track: hsl(H, S * 0.3, 19),
    accent,
    choice: accent,
    onChoice: hsl(H, S * 0.5, 9),
    figure: hsl(H, S * 0.35, 12),
    figureLine: hsl(H, S * 0.25, 30),
    figureSel: MEASURE.dark,
    bloom: MEASURE.dark,
    primary: hsl(H, S * 0.25, 94),
    onPrimary: ground,
  };
}

/** `TINT.apply`: a full theme from a preset, a base colour and a gradient. */
export function applyTint(
  preset: ThemeV1,
  seed: string | null | undefined,
  grad: boolean,
  seed2: string | null | undefined,
): ThemeV1 {
  const t: ThemeV1 = structuredClone(preset);
  if (preset.tint && seed) {
    t.c = preset.tint === "dark" ? dark(seed) : light(seed, preset.tp);
  }
  if (preset.tint && grad && seed2) {
    t.c.ground2 = preset.tint === "dark"
      ? dark(seed2).track
      : light(seed2, preset.tp).ground;
  }
  // Guard for the original colours too
  t.c.figureSel = t.c.bloom = luminance(t.c.ground) < 0.2
    ? MEASURE.dark
    : MEASURE.light;
  t.seed = (seed as Hex) || null;
  t.grad = !!(preset.tint && grad);
  t.seed2 = grad ? (seed2 as Hex) ?? null : null;
  return t;
}

export interface ThemeChecks {
  readable: boolean;
  bad: string[];
  warm: boolean;
  dark: boolean;
}

/** `TINT.checks`: contrast of every text pair, and the highlight vs figure */
export function checks(c: ThemeColors): ThemeChecks {
  const grounds = [c.ground].concat(c.ground2 ? [c.ground2] : []);
  const pairs: Array<[string, string, string]> = [
    ["text", c.ink, c.ground],
    ["buttons", c.onPrimary, c.primary],
    ["selected", c.onChoice, c.choice],
    ["cards", c.ink, c.surface],
  ];
  grounds.forEach((g, i) =>
    pairs.push(["secondary text" + (i ? " (gradient)" : ""), c.muted, g])
  );
  if (c.ground2) pairs.push(["text (gradient)", c.ink, c.ground2]);
  const bad = pairs.filter((p) => contrastRatio(p[1], p[2]) < 4.5).map((p) =>
    p[0]
  );
  // Graphics: WCAG 1.4.11
  if (contrastRatio(c.figureSel, c.figure) < 3) bad.push("highlight");
  return {
    readable: bad.length === 0,
    bad,
    warm: warm(c.figureSel) || warm(c.bloom),
    dark: luminance(c.ground) < 0.2,
  };
}

/**
 * The theme the app paints (ui.md §14.7): the preset, recoloured, with the fields
 * fixed in v1 overwritten whatever the preset says (ui.md §14.1). An unknown
 * `themeId` falls back to `calm`.
 */
export function resolveTheme(
  pref: AppearancePref = DEFAULT_APPEARANCE,
): ThemeV1 {
  const preset: PresetData = PRESETS[pref.themeId] ?? PRESETS.calm;
  const { id: _id, desc: _desc, ...theme } = preset;
  const t = applyTint(
    theme,
    preset.tint ? pref.seed : null,
    pref.gradient,
    pref.seed2,
  );
  // The approved Cyrillic-capable families (README.md, ui.md §14.5)
  const fonts = FONT_MIGRATION[preset.id];
  if (fonts) t.f = { ...t.f, ...fonts };
  t.v = {
    ...t.v,
    intensity: "slider",
    options: "grid",
    l2: "chips",
    figure: "solid",
    figureLabels: false,
    confidence: "buttons",
  };
  return t;
}
