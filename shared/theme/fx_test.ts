// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §14.2–§14.3, §1.7: the light of every theme a
 * person can build is cool where it marks an answer, off where the accent is
 * warm, absent in the stark presets, never over a label, and the ambient
 * background keeps every text colour readable.
 */
import { assert, assertEquals } from "@std/assert";
import { PRESETS } from "./presets.ts";
import {
  type AppearancePref,
  type Hex,
  PRESET_IDS,
  type ThemeV1,
} from "./schema.ts";
import {
  accentText,
  contrastRatio,
  mix,
  resolveTheme,
  SEEDS,
  warm,
} from "./tint.ts";
import { auraFields, FX_OFF, fxVars, NO_SHADOW } from "./fx.ts";
import { normalizeAppearance, normalizeTheme } from "./validate.ts";

/** Every theme from the built-in choices (570, as theme_test.ts counts) */
function* everyTheme(): Generator<[string, ThemeV1]> {
  const seeds: Array<Hex | null> = [null, ...SEEDS.map((s) => s.hex)];
  for (const themeId of PRESET_IDS) {
    const tintable = !!PRESETS[themeId].tint;
    for (const seed of tintable ? seeds : [null]) {
      for (const seed2 of tintable ? seeds : [null]) {
        const pref: AppearancePref = {
          themeId,
          seed,
          gradient: seed2 !== null,
          seed2,
        };
        yield [JSON.stringify(pref), resolveTheme(pref)];
      }
    }
  }
}

const hexOf = (rgb: string) => {
  const [r, g, b] = rgb.split(" ").map(Number);
  return "#" +
    [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")
      .toUpperCase();
};
/** The colours a shadow or gradient value draws with, as #RRGGBB and alpha */
const colours = (v: string) =>
  [...v.matchAll(/rgb\((\d+ \d+ \d+) \/ ([\d.]+)\)/g)].map((m) => ({
    hex: hexOf(m[1]),
    a: Number(m[2]),
  }));
const layerCount = (v: string) =>
  v === NO_SHADOW ? 0 : v.split(/,(?![^(]*\))/).length;

Deno.test("fx - every resolved theme carries its preset's fx; the base colour never changes it", () => {
  let n = 0;
  for (const [what, t] of everyTheme()) {
    const id = PRESET_IDS.find((p) => PRESETS[p].name === t.name)!;
    assertEquals(t.fx, PRESETS[id].fx, what);
    n++;
  }
  assertEquals(n, 570);
});

Deno.test("fx - Ink, Mono and Paper opt out: all zero, nothing drawn but borders and Now's shadow", () => {
  for (const id of ["ink", "mono", "paper"] as const) {
    assertEquals(PRESETS[id].fx, FX_OFF, id);
    const v = fxVars(
      resolveTheme({ themeId: id, seed: null, gradient: false, seed2: null }),
    );
    for (const [name, value] of Object.entries(v)) {
      if (name === "--fx-edge-line") {
        assert(
          value.startsWith("inset 0 0 0 1px #"),
          `${id}: a border instead`,
        );
      } else if (
        name === "--fx-now-aura" || name.startsWith("--fx-now-aura-")
      ) {
        // Today's drop shadow under Now, no halo
        assertEquals(layerCount(value), 1, `${id} ${name}`);
      } else if (name.startsWith("--fx-") && name.endsWith("sheen")) {
        assertEquals(value, "none", `${id} ${name}`);
      } else if (name === "--fx-ring") {
        assertEquals(value, "none", id);
      } else if (name.startsWith("--aura-")) {
        assertEquals(value, "transparent", `${id} ${name}`);
      } else if (
        name.startsWith("--fx-") && !name.startsWith("--fx-set-ring") &&
        name !== "--fx-ring-c"
      ) {
        assertEquals(value, NO_SHADOW, `${id} ${name}`);
      }
    }
  }
});

Deno.test("fx - halos around selection, focus and the slider thumb are the fixed highlight", () => {
  for (const [what, t] of everyTheme()) {
    const v = fxVars(t);
    assertEquals(v["--c-focus"], t.c.figureSel, what);
    for (
      const name of [
        "--fx-sel-aura",
        "--fx-focus-halo",
        "--fx-thumb-aura",
        "--fx-thumb-aura-hi",
        "--c-hover-sel",
        "--fx-set-ring",
      ]
    ) {
      for (const c of colours(v[name])) {
        assertEquals(c.hex, t.c.figureSel, `${what} ${name}`);
      }
    }
  }
});

Deno.test("fx - a warm accent gives no light: Now keeps its shadow only, no switch halo, no rim light", () => {
  let warmSeen = 0;
  for (const [what, t] of everyTheme()) {
    const v = fxVars(t);
    if (!warm(t.c.accent)) continue;
    warmSeen++;
    assertEquals(layerCount(v["--fx-now-aura"]), 1, what);
    assertEquals(layerCount(v["--fx-now-aura-hi"]), 1, what);
    assertEquals(layerCount(v["--fx-now-aura-press"]), 1, what);
    assertEquals(v["--fx-accent-aura-sm"], NO_SHADOW, what);
    assertEquals(v["--fx-ring"], "none", what);
  }
  // Night, and the Amber base colour on the dark themes at least
  assert(warmSeen >= 10, `${warmSeen} warm themes`);
  // Night as worked out in the spec
  const night = fxVars(
    resolveTheme({
      themeId: "night",
      seed: null,
      gradient: false,
      seed2: null,
    }),
  );
  assertEquals(
    night["--fx-now-aura"],
    "0 18px 40px -18px rgb(232 182 90 / 0.6)",
  );
});

Deno.test("fx - sheens leave 30–70 % of a control's height alone, so labels keep their contrast", () => {
  for (const [what, t] of everyTheme()) {
    const sheen = fxVars(t)["--fx-sheen"];
    if (sheen === "none") continue;
    const stops = [...sheen.matchAll(/rgb\([\d ]+ \/ ([\d.]+)\) (\d+)%/g)].map((
      m,
    ) => ({
      a: Number(m[1]),
      at: Number(m[2]),
    }));
    assertEquals(stops.map((s) => s.at), [0, 30, 70, 100], what);
    for (const s of stops.filter((s) => s.at >= 30 && s.at <= 70)) {
      assertEquals(s.a, 0, what);
    }
    // Hence the label on the primary and on a selected answer reads as on
    // the flat fill: the colour under it at 30 % and 70 % is the fill itself
    const at = (fill: string, i: number) =>
      mix(fill, i < 2 ? "#FFFFFF" : "#000000", stops[i].a);
    for (const i of [1, 2]) {
      assertEquals(
        contrastRatio(t.c.onPrimary, at(t.c.primary, i)),
        contrastRatio(t.c.onPrimary, t.c.primary),
        what,
      );
      assertEquals(
        contrastRatio(t.c.onChoice, at(t.c.choice, i)),
        contrastRatio(t.c.onChoice, t.c.choice),
        what,
      );
    }
  }
});

Deno.test("fx - text stays readable over every stack of the ambient fields, on every ground", () => {
  let fieldsSeen = 0;
  for (const [what, t] of everyTheme()) {
    const fields = auraFields(t.c, t.fx.bg);
    if (t.fx.bg === 0) {
      assertEquals(fields, [], what);
      continue;
    }
    fieldsSeen++;
    assertEquals(fields.length, 3, what);
    // Never the accent: from ground, gradient, surface and ≤ 12 % highlight
    for (const f of fields) assert(f.alpha >= 0 && f.alpha <= 1, what);
    const grounds = [t.c.ground].concat(t.c.ground2 ? [t.c.ground2] : []);
    for (const g of grounds) {
      for (let mask = 1; mask < 8; mask++) {
        let px: string = g;
        fields.forEach((f, i) => {
          if (mask & (1 << i)) px = mix(px, f.colour, f.alpha);
        });
        for (const text of [t.c.ink, t.c.muted, accentText(t.c)]) {
          assert(contrastRatio(text, px) >= 4.5, `${what} ${text} on ${px}`);
        }
      }
    }
  }
  assertEquals(fieldsSeen, 7 * 81);
});

Deno.test("fx - more contrast or forced colours: every effect off", () => {
  const v = fxVars(
    resolveTheme({ themeId: "dusk", seed: null, gradient: false, seed2: null }),
    true,
  );
  assertEquals(v["--fx-sel-aura"], NO_SHADOW);
  assertEquals(v["--fx-focus-halo"], NO_SHADOW);
  assertEquals(v["--fx-sheen"], "none");
  assertEquals(v["--fx-ring"], "none");
  assertEquals(v["--aura-1"], "transparent");
  assert(v["--fx-edge-line"].startsWith("inset 0 0 0 1px"));
});

Deno.test("fx - the worked values of the spec (Calm, Dusk)", () => {
  const calm = fxVars(resolveTheme());
  assertEquals(calm["--fx-rim"], "inset 0 1px 0 rgb(255 255 255 / 0.595)");
  assertEquals(
    calm["--fx-sel-aura"],
    "0 8px 20px -10px rgb(79 70 229 / 0.33), 0 2px 6px -3px rgb(79 70 229 / 0.165)",
  );
  assertEquals(
    calm["--fx-primary-aura"],
    "0 10px 24px -12px rgb(30 42 38 / 0.303), 0 2px 4px -2px rgb(30 42 38 / 0.138)",
  );
  assertEquals(
    calm["--fx-sheen"],
    "linear-gradient(180deg, rgb(255 255 255 / 0.09) 0%, rgb(255 255 255 / 0) 30%, rgb(0 0 0 / 0) 70%, rgb(0 0 0 / 0.05) 100%)",
  );
  const dusk = fxVars(
    resolveTheme({ themeId: "dusk", seed: null, gradient: false, seed2: null }),
  );
  assertEquals(dusk["--fx-rim"], "inset 0 1px 0 rgb(255 255 255 / 0.07)");
  assertEquals(
    dusk["--fx-sel-aura"],
    "0 0 0 1px rgb(142 162 255 / 0.5), 0 0 16px -2px rgb(142 162 255 / 0.4)",
  );
  assertEquals(dusk["--fx-focus-halo"], "0 0 12px 4px rgb(142 162 255 / 0.3)");
  assertEquals(
    dusk["--fx-primary-aura"],
    "0 8px 28px -12px rgb(236 238 248 / 0.32)",
  );
  assertEquals(dusk["--fx-ring"], "block");
});

Deno.test("fx - loading clamps the strengths and repairs what is missing", () => {
  const t = normalizeTheme({
    fx: { glow: 3, edge: -1, sheen: "x", depth: 5, bg: 0.25 },
  });
  assertEquals(t.fx, {
    glow: 1,
    edge: 0,
    sheen: PRESETS.calm.fx.sheen,
    depth: PRESETS.calm.fx.depth,
    bg: 0.25,
  });
  assertEquals(normalizeTheme({}).fx, PRESETS.calm.fx);
  // "Moving background" off is kept only when off (absent = moving)
  assertEquals(
    normalizeAppearance({ themeId: "calm", still: true }).still,
    true,
  );
  assertEquals(
    "still" in normalizeAppearance({ themeId: "calm", still: false }),
    false,
  );
});
