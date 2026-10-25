// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Per-theme Font Manifest with Cyrillic support across all presets.
 * Specification: performance.md §2.3, ui.md §14.5.
 */

import type { FontFamily, PresetId } from "./schema.ts";

export interface FontFile {
  family: string;
  weight: number;
  style: "normal" | "italic";
  subsets: Array<"latin" | "cyrillic">;
}

export const FONT_MANIFEST: Record<PresetId, FontFile[]> = {
  calm: [
    {
      family: "Onest",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Onest",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Onest",
      weight: 600,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
  mono: [
    // Replaces Hanken Grotesk with Golos Text
    {
      family: "Golos Text",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Golos Text",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Golos Text",
      weight: 600,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Golos Text",
      weight: 700,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
  lavender: [
    // Replaces Plus Jakarta Sans with Manrope
    {
      family: "Manrope",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Manrope",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Manrope",
      weight: 700,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Manrope",
      weight: 800,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
  paper: [
    // Replaces Newsreader with Literata, ui with Golos Text
    {
      family: "Golos Text",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Golos Text",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Literata",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Literata",
      weight: 400,
      style: "italic",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "JetBrains Mono",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
  night: [
    // Replaces Sora with Unbounded (display) + Onest (ui)
    {
      family: "Onest",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Onest",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Onest",
      weight: 600,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Unbounded",
      weight: 700,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
  ink: [
    {
      family: "IBM Plex Sans",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "IBM Plex Sans",
      weight: 600,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "JetBrains Mono",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
  seaglass: [
    {
      family: "Manrope",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Manrope",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Manrope",
      weight: 800,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
  archive: [
    {
      family: "Golos Text",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Golos Text",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Literata",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Literata",
      weight: 500,
      style: "italic",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "JetBrains Mono",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
  dusk: [
    {
      family: "Onest",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Onest",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Onest",
      weight: 600,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Unbounded",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
  sand: [
    {
      family: "Rubik",
      weight: 400,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Rubik",
      weight: 500,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
    {
      family: "Rubik",
      weight: 600,
      style: "normal",
      subsets: ["latin", "cyrillic"],
    },
  ],
};

/** Both subsets of every face; `unicode-range` picks the one a page needs */
export const SUBSETS = ["latin", "cyrillic"] as const;

/** `IBM Plex Sans` → `ibm-plex-sans` (the @fontsource and directory name) */
export function fontSlug(family: string): string {
  return family.toLowerCase().replaceAll(" ", "-");
}

/** `<family>/<family>-<subset>-<weight>[-italic].woff2` under `/fonts/` (performance.md §2.2) */
export function fontFileName(
  f: FontFile,
  subset: (typeof SUBSETS)[number],
): string {
  const slug = fontSlug(f.family);
  return `${slug}/${slug}-${subset}-${f.weight}${
    f.style === "italic" ? "-italic" : ""
  }.woff2`;
}

/**
 * The owner-approved replacement of the four early presets' Latin-only
 * families (performance.md, ui.md §14.5):
 * applied by the resolver over the ui.md §14.9 data, so every preset has Cyrillic.
 */
export const FONT_MIGRATION: Partial<
  Record<PresetId, { ui: FontFamily; display: FontFamily }>
> = {
  mono: { ui: "Golos Text", display: "Golos Text" },
  lavender: { ui: "Manrope", display: "Manrope" },
  night: { ui: "Onest", display: "Unbounded" },
  paper: { ui: "Golos Text", display: "Literata" },
};

/** Local fonts measured against each family (Capsize metrics, tools/gen_fonts.ts) */
export type FallbackFont =
  | "Arial"
  | "Roboto"
  | "Times New Roman"
  | "Noto Serif"
  | "Courier New"
  | "Roboto Mono";

/** Desktop first, then Android, which has no Arial or Times */
export function fallbacksOf(family: FontFamily): FallbackFont[] {
  if (family === "Literata") return ["Times New Roman", "Noto Serif"];
  if (family === "JetBrains Mono") return ["Courier New", "Roboto Mono"];
  return ["Arial", "Roboto"];
}

/**
 * The CSS `font-family` for a theme font (performance.md §2.2): the
 * web font, then local fonts adjusted to its metrics (`size-adjust`,
 * `ascent-override`, `descent-override` in `client/src/fonts.css`), so the
 * swap barely moves the layout, then the generic family.
 */
export function fontStack(family: FontFamily): string {
  const generic = family === "Literata"
    ? "serif"
    : family === "JetBrains Mono"
    ? "monospace"
    : "sans-serif";
  return [
    `"${family}"`,
    ...fallbacksOf(family).map((f) => `"${family} Fallback: ${f}"`),
    generic,
  ].join(", ");
}
