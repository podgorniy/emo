// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The theme schema `ThemeV1` (ui.md §14.2) and the stored
 * appearance preference (ui.md §14.7). A theme changes presentation only; the
 * fields fixed in v1 (ui.md §14.1) are overwritten by the resolver (`tint.ts`).
 */

/** Exactly `#RRGGBB`, uppercase when stored */
export type Hex = `#${string}`;

export type PresetId =
  | "calm"
  | "mono"
  | "lavender"
  | "paper"
  | "night"
  | "ink"
  | "seaglass"
  | "archive"
  | "dusk"
  | "sand";

/** The order of the preset list in Settings → Appearance (ui.md §14.9) */
export const PRESET_IDS: readonly PresetId[] = [
  "calm",
  "mono",
  "lavender",
  "paper",
  "night",
  "ink",
  "seaglass",
  "archive",
  "dusk",
  "sand",
];

export type FontFamily =
  | "Onest"
  | "Golos Text"
  | "IBM Plex Sans"
  | "Manrope"
  | "Rubik"
  | "Unbounded"
  | "Literata"
  | "JetBrains Mono"
  // Latin-only, used by four early presets (ui.md §14.5)
  | "Hanken Grotesk"
  | "Plus Jakarta Sans"
  | "Sora"
  | "Newsreader";

export interface ThemeColors {
  ground: Hex;
  surface: Hex;
  ink: Hex;
  muted: Hex;
  line: Hex;
  track: Hex;
  accent: Hex;
  choice: Hex;
  onChoice: Hex;
  figure: Hex;
  figureLine: Hex;
  figureSel: Hex;
  bloom: Hex;
  primary: Hex;
  onPrimary: Hex;
  /** Present only when the gradient is on */
  ground2?: Hex;
}

/** Light-recipe parameters (ui.md §14.6) */
export interface LightParams {
  /** Background saturation factor */
  gs: number;
  choice: "ink" | "accent";
  primary: "ink" | "accent";
}

/** Control variants; an entry's `ui` records which one was used (data.md §3.6) */
export const INTENSITY_VARIANTS = ["slider", "bloom", "ruler"] as const;
export const OPTION_VARIANTS = ["grid", "chips", "grouped", "list"] as const;
export const FIGURE_VARIANTS = ["solid", "soft", "hatch", "glow"] as const;

export interface ThemeVariants {
  progress: "segments" | "bar" | "dots" | "counter";
  heading: "plain" | "eyebrow" | "editorial";
  stepLabel: boolean;
  tabs: "segmented" | "underline";
  options: typeof OPTION_VARIANTS[number];
  l2: "chips" | "inline";
  intensity: typeof INTENSITY_VARIANTS[number];
  figure: typeof FIGURE_VARIANTS[number];
  figureLabels: boolean;
  confidence: "buttons" | "segmented";
  summary: "plain" | "dot";
}

/**
 * Light and depth (ui.md §14.2): how much each effect shows,
 * 0–1, and the elevation model. All 0 = no effect at all (Ink, Mono, Paper
 * opt out); the resolver turns them into ready-made CSS variables
 * (`fx.ts`). Part of the resolved theme, so `ui.theme` tells entries
 * recorded with and without them apart.
 */
export interface ThemeFx {
  /** Halo strength: selected answer, focus, primary button, Now */
  glow: number;
  /** The lit rim on surfaces and controls */
  edge: number;
  /** Top light and bottom shade on filled controls */
  sheen: number;
  /** 0 flat (borders), 1 soft shadows (light themes), 2 luminous (dark) */
  depth: 0 | 1 | 2;
  /** The ambient background's strength; 0 = not offered */
  bg: number;
}

export interface ThemeV1 {
  schema: 1;
  /** ≤ 32 characters */
  name: string;
  /** Which recipe can recolour this theme; null = a fixed palette */
  tint?: "light" | "dark" | null;
  tp?: LightParams | null;
  /** The chosen base colour; null = the original colours */
  seed?: Hex | null;
  grad?: boolean;
  seed2?: Hex | null;
  c: ThemeColors;
  f: {
    ui: FontFamily;
    display: FontFamily;
    displayWeight: 400 | 500 | 600 | 700 | 800;
    mono: "JetBrains Mono";
    labels: "normal" | "mono";
  };
  /** `control` 0–28; `chip` 2, 10, 12 or 999 */
  r: { control: number; chip: 2 | 10 | 12 | 999 };
  shadow: boolean;
  v: ThemeVariants;
  fx: ThemeFx;
}

/** A preset: a theme plus its id and card subtitle (ui.md §14.9) */
export interface PresetData extends ThemeV1 {
  id: PresetId;
  desc: string;
}

/** Stored in the encrypted prefs (ui.md §14.7, §14.8) */
export interface AppearancePref {
  themeId: PresetId;
  /** null = the original colours; ignored for fixed-palette themes */
  seed: Hex | null;
  /** Ignored for fixed-palette themes */
  gradient: boolean;
  /** The gradient's second colour, used when `gradient` is on */
  seed2: Hex | null;
  /**
   * Opt-in (UX-26): follow the device's light / dark setting — Calm when
   * light, Dusk when dark, both in their own colours. `themeId` and its
   * colours are kept for when it is turned off. Missing = off (D4).
   */
  auto?: boolean;
  /**
   * "Moving background" turned off: the ambient light stays a still picture
   * (ui.md §13.7). Missing = moving. Not part of the
   * resolved theme: it is never on screen during a check-in.
   */
  still?: boolean;
  /**
   * "Left-handed mode" on mobile: mirrors thumb positions for controls
   * (pane dots to left, next/done to left, front/back to left). Missing = right-handed.
   */
  leftHanded?: boolean;
}

/** What "Match the system" paints (ui.md §13) */
export const AUTO_LIGHT: AppearancePref = {
  themeId: "calm",
  seed: null,
  gradient: false,
  seed2: null,
};
export const AUTO_DARK: AppearancePref = {
  themeId: "dusk",
  seed: null,
  gradient: false,
  seed2: null,
};

export const DEFAULT_APPEARANCE: AppearancePref = {
  themeId: "calm",
  seed: null,
  gradient: false,
  seed2: null,
};
