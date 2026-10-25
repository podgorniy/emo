// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A theme's light as CSS variables (ui.md §14.3): the five `fx`
 * numbers and the palette become ready-made shadows, gradients and colours,
 * so no component computes anything and nothing needs `color-mix()` (Chrome
 * 110 has none). Two rules hold by construction: what marks an answer or
 * focus glows only in the fixed highlight (principle 7), and the accent's
 * light is off where the accent is warm (`warm()`: Night's amber, the Amber
 * base colour). A shadow that draws nothing is `0 0 #0000`, never `none`, so
 * components can always comma-join them. The ambient background's three
 * fields (ui.md §13.7) come from the ground, the gradient, the surface and
 * at most 12 % of the highlight, and are dimmed until every text colour
 * reads at 4.5:1 over any stack of them.
 */
import type { Hex, ThemeColors, ThemeFx, ThemeV1 } from "./schema.ts";
import { accentText, contrastRatio, luminance, mix, warm } from "./tint.ts";

/** A shadow that draws nothing */
export const NO_SHADOW = "0 0 #0000";

/** Every effect off: stark presets, more contrast, forced colours */
export const FX_OFF: ThemeFx = { glow: 0, edge: 0, sheen: 0, depth: 0, bg: 0 };

const WHITE = "#FFFFFF";
const BLACK = "#000000";

const channels = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** The alpha as CSS writes it: 0–1, at most 3 decimals */
const alpha = (a: number) =>
  String(Math.round(Math.max(0, Math.min(1, a)) * 1000) / 1000);

/** `rgb(r g b / a)` */
export function rgba(h: string, a: number): string {
  return `rgb(${channels(h).join(" ")} / ${alpha(a)})`;
}

/** One shadow layer; null when its alpha rounds to 0 */
function layer(geometry: string, colour: string, a: number): string | null {
  return Math.round(a * 1000) <= 0 ? null : `${geometry} ${rgba(colour, a)}`;
}

/** The layers that draw something, comma-joined; none → `0 0 #0000` */
function shadow(...layers: Array<string | null>): string {
  const on = layers.filter((l): l is string => l !== null);
  return on.length ? on.join(", ") : NO_SHADOW;
}

/** The three fields of the ambient background (ui.md §13.7) */
export interface AuraField {
  colour: Hex;
  /** Peak alpha at the field's centre, after the contrast guard */
  alpha: number;
}

/** `top` over `under` at `a` (sRGB, opaque result) */
function over(under: string, top: string, a: number): Hex {
  return mix(under, top, a);
}

/**
 * The fields at strength `bg`: the lamp behind Now (the surface tinted with
 * the highlight), the pool (the gradient's second colour, or between ground
 * and surface) and the daylight (the surface). Never the accent. Their
 * alphas shrink in steps of 2 % until ink, secondary text and the accent as
 * text read at 4.5:1 over every stack of them on every ground.
 */
export function auraFields(c: ThemeColors, bg: number): AuraField[] {
  if (bg <= 0) return [];
  const dark = luminance(c.ground) < 0.2;
  const S = c.figureSel;
  const fields: AuraField[] = dark
    ? [
      { colour: mix(c.surface, S, 0.12), alpha: 0.55 * bg },
      { colour: c.ground2 ?? mix(c.surface, S, 0.12), alpha: 0.5 * bg },
      { colour: c.surface, alpha: 0.8 * bg },
    ]
    : [
      { colour: mix(c.surface, S, 0.1), alpha: 0.6 * bg },
      { colour: c.ground2 ?? mix(c.ground, c.surface, 0.5), alpha: 0.55 * bg },
      { colour: c.surface, alpha: 0.7 * bg },
    ];
  const texts = [c.ink, c.muted, accentText(c)];
  const grounds = [c.ground].concat(c.ground2 ? [c.ground2] : []);
  const readable = (k: number) => {
    // Every subset of the three fields, stacked, over every ground
    for (let mask = 1; mask < 8; mask++) {
      for (const g of grounds) {
        let px: string = g;
        fields.forEach((f, i) => {
          if (mask & (1 << i)) px = over(px, f.colour, f.alpha * k);
        });
        if (texts.some((t) => contrastRatio(t, px) < 4.5)) return false;
      }
    }
    return true;
  };
  let k = 1;
  while (k > 0 && !readable(k)) k = Math.round((k - 0.02) * 100) / 100;
  return fields.map((f) => ({ ...f, alpha: Math.max(0, f.alpha * k) }));
}

/**
 * The derived variables of ui.md §14.3 for a resolved theme; `off` resolves every
 * effect to nothing (more contrast, forced colours).
 */
export function fxVars(t: ThemeV1, off = false): Record<string, string> {
  const c = t.c;
  const fx = off ? FX_OFF : t.fx;
  const g = fx.glow, e = fx.edge, s = fx.sheen;
  const flat = fx.depth === 0;
  const dark = luminance(c.ground) < 0.2;
  const S = c.figureSel, I = c.ink, P = c.primary, A = c.accent;
  // The accent's own light: off where the accent is warm (principle 7)
  const ga = warm(A) ? 0 : g;
  // Elevation: depth 0 draws borders instead of shadows
  const d = flat ? 0 : 1;
  const fields = auraFields(c, fx.bg);
  const thumbHi = (a: number) => Math.min(1, a * 1.4);

  return {
    // Colours (state fills and lines; never the accent on an answer)
    "--c-focus": S,
    "--c-surface-hi": mix(c.surface, S, 0.05),
    "--c-surface-press": mix(c.surface, S, 0.1),
    "--c-line-strong": mix(c.line, I, 0.45),
    "--c-primary-hi": dark ? mix(P, WHITE, 0.5) : mix(P, S, 0.12),
    "--c-info": mix(c.surface, S, 0.1),
    "--c-scrim": dark ? rgba(BLACK, 0.55) : rgba(I, 0.32),
    "--c-hover-sel": rgba(S, dark ? 0.12 : 0.08),
    "--c-knob": dark ? I : WHITE,
    // Edges and elevation
    "--fx-rim": shadow(layer("inset 0 1px 0", WHITE, (dark ? 0.07 : 0.85) * e)),
    "--fx-rim-fill": shadow(
      layer("inset 0 1px 0", WHITE, (dark ? 0.55 : 0.22) * e),
      layer("inset 0 -1px 0", BLACK, (dark ? 0.14 : 0.18) * e),
    ),
    "--fx-edge-line": flat ? `inset 0 0 0 1px ${c.line}` : NO_SHADOW,
    "--fx-lift-1": dark ? shadow(layer("0 1px 2px", BLACK, 0.35 * d)) : shadow(
      layer("0 1px 2px", I, 0.06 * d),
      layer("0 3px 10px -4px", I, 0.08 * d),
    ),
    "--fx-lift-2": dark
      ? shadow(
        layer("0 0 0 1px", WHITE, 0.05 * d),
        layer("0 24px 56px -20px", BLACK, 0.75 * d),
      )
      : shadow(
        layer("0 2px 6px -2px", I, 0.08 * d),
        layer("0 18px 44px -18px", I, 0.28 * d),
      ),
    "--fx-lift-up": dark
      ? shadow(
        layer("0 -1px 0", WHITE, 0.06 * d),
        layer("0 -20px 60px -20px", BLACK, 0.8 * d),
      )
      : shadow(layer("0 -16px 48px -20px", I, 0.35 * d)),
    "--fx-inset": dark
      ? shadow(layer("inset 0 1px 3px", BLACK, 0.4 * d))
      : shadow(layer("inset 0 1px 2px", I, 0.08 * d)),
    "--fx-press": dark
      ? shadow(layer("inset 0 2px 6px", BLACK, 0.35 * d))
      : shadow(layer("inset 0 2px 5px", I, 0.1 * d)),
    // Halos: the selected answer and focus in the fixed highlight only
    "--fx-sel-aura": dark
      ? shadow(
        layer("0 0 0 1px", S, 0.5 * g),
        layer("0 0 16px -2px", S, 0.4 * g),
      )
      : shadow(
        layer("0 8px 20px -10px", S, 0.6 * g),
        layer("0 2px 6px -3px", S, 0.3 * g),
      ),
    "--fx-focus-halo": dark
      ? shadow(layer("0 0 12px 4px", S, 0.3 * g))
      : shadow(layer("0 0 10px 4px", S, 0.22 * g)),
    // The primary button: a soft light of its own colour
    "--fx-primary-aura": dark
      ? shadow(layer("0 8px 28px -12px", P, 0.32 * g))
      : shadow(
        layer("0 10px 24px -12px", P, 0.55 * g),
        layer("0 2px 4px -2px", P, 0.25 * g),
      ),
    "--fx-primary-aura-hi": dark
      ? shadow(layer("0 10px 34px -10px", P, 0.42 * g))
      : shadow(
        layer("0 14px 30px -12px", P, 0.65 * g),
        layer("0 2px 6px -2px", P, 0.3 * g),
      ),
    "--fx-primary-aura-press": dark
      ? shadow(layer("0 2px 10px -6px", P, 0.3 * g))
      : shadow(layer("0 4px 10px -6px", P, 0.5 * g)),
    // Now: today's drop shadow always; its accent halo only where cool
    "--fx-now-aura": shadow(
      layer("0 18px 40px -18px", A, 0.6),
      layer("0 0 0 10px", A, 0.07 * ga),
      layer("0 0 64px 4px", A, 0.24 * ga),
    ),
    "--fx-now-aura-hi": shadow(
      layer("0 22px 44px -18px", A, 0.65),
      layer("0 0 0 12px", A, 0.09 * ga),
      layer("0 0 72px 6px", A, 0.3 * ga),
    ),
    "--fx-now-aura-press": shadow(
      layer("0 10px 24px -14px", A, 0.6),
      layer("0 0 0 6px", A, 0.07 * ga),
      layer("0 0 40px 0", A, 0.18 * ga),
    ),
    "--fx-accent-aura-sm": shadow(layer("0 0 14px -2px", A, 0.45 * ga)),
    // Sheens: zero between 30 % and 70 % of the height, where labels sit
    "--fx-sheen": s > 0
      ? `linear-gradient(180deg, ${rgba(WHITE, 0.18 * s)} 0%, ${
        rgba(WHITE, 0)
      } 30%, ${rgba(BLACK, 0)} 70%, ${rgba(BLACK, 0.1 * s)} 100%)`
      : "none",
    "--fx-orb-sheen": s > 0
      ? `radial-gradient(circle 40px at 36% 18%, ${rgba(WHITE, 0.28 * s)}, ${
        rgba(WHITE, 0)
      })`
      : "none",
    "--fx-orb-rim": shadow(
      layer("inset 0 1px 0", WHITE, 0.35 * e),
      layer("inset 0 -14px 28px -10px", BLACK, 0.16 * s),
    ),
    // Now's rim light: dark themes with a cool accent only, three slow laps
    "--fx-ring": fx.depth === 2 && ga > 0 ? "block" : "none",
    "--fx-ring-c": rgba(mix(A, WHITE, 0.3), 0.8 * ga),
    // The slider thumb: lit when touched, in the fixed highlight
    "--fx-thumb-sheen": s > 0
      ? `radial-gradient(circle 9px at 38% 32%, ${rgba(WHITE, 0.45 * s)}, ${
        rgba(WHITE, 0)
      })`
      : "none",
    "--fx-thumb-aura": dark
      ? shadow(
        layer("0 0 0 1px", S, 0.5 * g),
        layer("0 0 18px 2px", S, 0.45 * g),
      )
      : shadow(
        layer("0 0 0 1px", S, 0.35 * g),
        layer("0 4px 14px -2px", S, 0.45 * g),
      ),
    "--fx-thumb-aura-hi": dark
      ? shadow(
        layer("0 0 0 1px", S, thumbHi(0.5 * g)),
        layer("0 0 18px 2px", S, thumbHi(0.45 * g)),
      )
      : shadow(
        layer("0 0 0 1px", S, thumbHi(0.35 * g)),
        layer("0 4px 14px -2px", S, thumbHi(0.45 * g)),
      ),
    // The one ring that says "set" on a slider's first input (motion, not light)
    "--fx-set-ring": off ? NO_SHADOW : `0 0 0 0 ${rgba(S, 0.45)}`,
    "--fx-set-ring-end": `0 0 0 14px ${rgba(S, 0)}`,
    // The ambient background (none at strength 0)
    "--aura-1": fields[0]
      ? rgba(fields[0].colour, fields[0].alpha)
      : "transparent",
    "--aura-2": fields[1]
      ? rgba(fields[1].colour, fields[1].alpha)
      : "transparent",
    "--aura-3": fields[2]
      ? rgba(fields[2].colour, fields[2].alpha)
      : "transparent",
  };
}
