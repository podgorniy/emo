// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §14 and development.md §5.1: the presets are the spec's,
 * every theme a person can build from the built-in choices is readable, the
 * highlight is fixed and cool, and loading never trusts its input.
 */
import { assert, assertEquals } from "@std/assert";
import { PRESETS } from "./presets.ts";
import { FONT_MANIFEST, fontFileName, SUBSETS } from "./fonts.ts";
import {
  type AppearancePref,
  AUTO_DARK,
  AUTO_LIGHT,
  type Hex,
  PRESET_IDS,
} from "./schema.ts";
import {
  accentText,
  checks,
  contrastRatio,
  MEASURE,
  resolveTheme,
  SEEDS,
} from "./tint.ts";
import { normalizeAppearance, normalizeTheme } from "./validate.ts";

Deno.test("theme - the 10 presets, in the spec's order, each with fonts", () => {
  assertEquals(PRESET_IDS, [
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
  ]);
  for (const id of PRESET_IDS) {
    assertEquals(PRESETS[id].id, id);
    assert(FONT_MANIFEST[id], `fonts for ${id}`);
  }
  // Seven take a base colour (ui.md §13.5, §14.1); three keep their palette
  assertEquals(
    PRESET_IDS.filter((id) => PRESETS[id].tint === null),
    ["mono", "paper", "ink"],
  );
});

Deno.test("theme - all 570 themes from built-in choices are readable, never warm", () => {
  // Where the accent already reads as text, it is used as it is
  assertEquals(accentText(resolveTheme().c), PRESETS.calm.c.accent);
  const seeds: Array<Hex | null> = [null, ...SEEDS.map((s) => s.hex)];
  const gradients: Array<Hex | null> = [null, ...SEEDS.map((s) => s.hex)];
  let n = 0;
  for (const themeId of PRESET_IDS) {
    const tintable = !!PRESETS[themeId].tint;
    for (const seed of tintable ? seeds : [null]) {
      for (const seed2 of tintable ? gradients : [null]) {
        const pref: AppearancePref = {
          themeId,
          seed,
          gradient: seed2 !== null,
          seed2,
        };
        const t = resolveTheme(pref);
        const c = checks(t.c);
        const what = JSON.stringify(pref);
        assertEquals(c.bad, [], what);
        assertEquals(c.warm, false, what);
        // The highlight is fixed: indigo on light grounds, periwinkle on dark
        assertEquals(t.c.figureSel, c.dark ? MEASURE.dark : MEASURE.light);
        assertEquals(t.c.bloom, t.c.figureSel);
        assert(contrastRatio(t.c.figureSel, t.c.figure) >= 3, what);
        assertEquals(!!t.c.ground2, seed2 !== null, what);
        // The accent as text (links, the editorial key phrase) reads on
        // every ground, the gradient's second one too (ui.md §14.3)
        for (const g of [t.c.ground, t.c.ground2 ?? t.c.ground]) {
          assert(contrastRatio(accentText(t.c), g) >= 4.5, what);
        }
        n++;
      }
    }
  }
  // 7 tintable × 9 base colours × 9 gradient states, + 3 fixed palettes
  assertEquals(n, 570);
});

Deno.test("theme - the resolver forces the fields fixed in v1 (ui.md §14.1)", () => {
  const preset = structuredClone(PRESETS.calm);
  preset.v = {
    ...preset.v,
    intensity: "bloom",
    options: "list",
    l2: "inline",
    figure: "glow",
    figureLabels: true,
    confidence: "segmented",
  };
  const saved = PRESETS.calm;
  (PRESETS as Record<string, typeof saved>).calm = preset;
  try {
    const v = resolveTheme().v;
    assertEquals(
      [v.intensity, v.options, v.l2, v.figure, v.figureLabels, v.confidence],
      ["slider", "grid", "chips", "solid", false, "buttons"],
    );
    // Theme-dependent fields stay the preset's
    assertEquals(v.progress, preset.v.progress);
  } finally {
    (PRESETS as Record<string, typeof saved>).calm = saved;
  }
});

Deno.test("theme - loading drops unknown keys, repairs bad values, clamps radii", () => {
  const t = normalizeTheme({
    name: "x".repeat(50),
    evil: "<script>",
    c: { ground: "#abcdef", ink: "red", extra: "#000000" },
    f: { ui: "Comic Sans", displayWeight: 900 },
    r: { control: 99, chip: 7 },
    v: { progress: "spinner", summary: "dot" },
  });
  assertEquals("evil" in t, false);
  assertEquals("extra" in t.c, false);
  assertEquals(t.name.length, 32);
  assertEquals(t.c.ground, "#ABCDEF");
  assertEquals(t.c.ink, PRESETS.calm.c.ink);
  assertEquals(t.f.ui, PRESETS.calm.f.ui);
  assertEquals(t.f.displayWeight, PRESETS.calm.f.displayWeight);
  assertEquals(t.r, { control: 28, chip: PRESETS.calm.r.chip });
  assertEquals(t.v.progress, PRESETS.calm.v.progress);
  assertEquals(t.v.summary, "dot");
  assertEquals(normalizeTheme("garbage").name, PRESETS.calm.name);
});

Deno.test("theme - a stored preference: old shape, fixed palettes, bad colours", () => {
  // Older builds stored `{ preset }`
  assertEquals(normalizeAppearance({ preset: "dusk" }), {
    themeId: "dusk",
    seed: null,
    gradient: false,
    seed2: null,
  });
  // A fixed palette ignores base colour and gradient
  assertEquals(
    normalizeAppearance({
      themeId: "ink",
      seed: "#1F7A73",
      gradient: true,
      seed2: "#2563A8",
    }),
    { themeId: "ink", seed: null, gradient: false, seed2: null },
  );
  assertEquals(
    normalizeAppearance({ themeId: "calm", seed: "teal", gradient: true }),
    { themeId: "calm", seed: null, gradient: true, seed2: null },
  );
  assertEquals(normalizeAppearance({ themeId: "neon" }).themeId, "calm");
  assertEquals(normalizeAppearance(null).themeId, "calm");
});

Deno.test("theme - 'Match the system' is kept only when on (UX-26)", () => {
  assertEquals(
    normalizeAppearance({ themeId: "paper", auto: true }),
    { themeId: "paper", seed: null, gradient: false, seed2: null, auto: true },
  );
  // Off or missing: the shape older builds wrote and read
  assertEquals(
    "auto" in normalizeAppearance({ themeId: "paper", auto: false }),
    false,
  );
  assertEquals("auto" in normalizeAppearance({ themeId: "paper" }), false);
  // Calm and Dusk in their own colours, both readable
  assertEquals(resolveTheme(AUTO_LIGHT).c.ground, PRESETS.calm.c.ground);
  assertEquals(resolveTheme(AUTO_DARK).c.ground, PRESETS.dusk.c.ground);
});

Deno.test("theme - every font a preset uses is in its manifest, on disk, with Cyrillic", () => {
  const LATIN_ONLY = [
    "Hanken Grotesk",
    "Plus Jakarta Sans",
    "Sora",
    "Newsreader",
  ];
  for (const id of PRESET_IDS) {
    const t = resolveTheme({
      themeId: id,
      seed: null,
      gradient: false,
      seed2: null,
    });
    const has = (family: string, weight: number, style = "normal") =>
      FONT_MANIFEST[id].some((f) =>
        f.family === family && f.weight === weight && f.style === style
      );
    assert(has(t.f.ui, 400), `${id}: ${t.f.ui} 400`);
    assert(
      has(t.f.display, t.f.displayWeight),
      `${id}: ${t.f.display} ${t.f.displayWeight}`,
    );
    if (t.v.heading === "editorial") {
      assert(has(t.f.display, t.f.displayWeight, "italic"), `${id}: italic`);
    }
    if (t.f.labels === "mono") {
      assert(has("JetBrains Mono", 400), `${id}: mono`);
    }
    assertEquals(
      LATIN_ONLY.includes(t.f.ui) || LATIN_ONLY.includes(t.f.display),
      false,
      id,
    );
    for (const f of FONT_MANIFEST[id]) {
      for (const subset of SUBSETS) {
        Deno.statSync(
          new URL(
            `../../client/public/fonts/${fontFileName(f, subset)}`,
            import.meta.url,
          ),
        );
      }
    }
  }
});
