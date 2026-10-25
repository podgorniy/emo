// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Vendors the fonts of `FONT_MANIFEST` (performance.md §2): the woff2
 * files of the pinned `@fontsource` packages (SIL OFL 1.1, the licence goes
 * along) into `client/public/fonts/<family>/<family>-<subset>-<weight>[-italic].woff2`,
 * and writes `client/src/fonts.css` with one `@font-face` per file
 * (`font-display: swap`, the packages' own `unicode-range`, so a Latin-only
 * session never downloads Cyrillic), plus local fallbacks sized to each
 * family's metrics (Capsize). Fails when a preset's fonts exceed
 * 350 KB. Run once after changing the manifest; the output is committed.
 *
 *   deno run -A tools/gen_fonts.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createFontStack } from "@capsizecss/core";
import {
  fallbacksOf,
  FONT_MANIFEST,
  type FontFile,
  fontFileName,
  fontSlug,
  SUBSETS,
} from "../shared/theme/fonts.ts";
import { type FontFamily, PRESET_IDS } from "../shared/theme/schema.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "client/public/fonts");
const CSS = path.join(ROOT, "client/src/fonts.css");
const PRESET_BUDGET_KB = 350;

/** Pinned package versions (bump deliberately; the files are committed) */
const VERSIONS: Record<string, string> = {
  onest: "5.3.1",
  "golos-text": "5.3.0",
  manrope: "5.3.0",
  literata: "5.3.0",
  unbounded: "5.3.0",
  "ibm-plex-sans": "5.3.0",
  rubik: "5.3.0",
  "jetbrains-mono": "5.3.0",
};

async function unpack(slug: string): Promise<string> {
  const version = VERSIONS[slug];
  if (!version) throw new Error(`No pinned @fontsource version for ${slug}`);
  const url =
    `https://registry.npmjs.org/@fontsource/${slug}/-/${slug}-${version}.tgz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const dir = await Deno.makeTempDir({ prefix: `font-${slug}-` });
  const tgz = path.join(dir, "pkg.tgz");
  await Deno.writeFile(tgz, new Uint8Array(await res.arrayBuffer()));
  const tar = await new Deno.Command("tar", { args: ["-xzf", tgz, "-C", dir] })
    .output();
  if (!tar.success) throw new Error(`tar failed for ${slug}`);
  return path.join(dir, "package");
}

/** `unicode-range` per subset, from the package's own CSS */
async function unicodeRanges(pkg: string): Promise<Record<string, string>> {
  const css = await Deno.readTextFile(path.join(pkg, "index.css"));
  const ranges: Record<string, string> = {};
  for (
    const m of css.matchAll(
      /\/\* [a-z0-9-]+-([a-z-]+)-\d+-\w+ \*\/\s*@font-face \{[^}]*unicode-range: ([^;]+);/g,
    )
  ) {
    ranges[m[1]] ??= m[2].trim();
  }
  return ranges;
}

const needed = new Map<string, FontFile>();
for (const id of PRESET_IDS) {
  for (const f of FONT_MANIFEST[id]) {
    needed.set(`${f.family}|${f.weight}|${f.style}`, f);
  }
}

await Deno.remove(OUT, { recursive: true }).catch(() => {});
const faces: string[] = [];
const sizes = new Map<string, number>();
const byFamily = new Map<string, FontFile[]>();
for (const f of needed.values()) {
  byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f]);
}
for (const [family, files] of byFamily) {
  const slug = fontSlug(family);
  const pkg = await unpack(slug);
  const ranges = await unicodeRanges(pkg);
  await Deno.mkdir(path.join(OUT, slug), { recursive: true });
  await Deno.copyFile(
    path.join(pkg, "LICENSE"),
    path.join(OUT, slug, "OFL.txt"),
  );
  for (const f of files.sort((a, b) => a.weight - b.weight)) {
    for (const subset of SUBSETS) {
      const from = path.join(
        pkg,
        "files",
        `${slug}-${subset}-${f.weight}-${f.style}.woff2`,
      );
      const name = fontFileName(f, subset);
      await Deno.copyFile(from, path.join(OUT, name));
      sizes.set(name, (await Deno.stat(path.join(OUT, name))).size);
      if (!ranges[subset]) {
        throw new Error(`No unicode-range for ${slug} ${subset}`);
      }
      faces.push(`@font-face {
  font-family: "${family}";
  font-style: ${f.style};
  font-weight: ${f.weight};
  font-display: swap;
  src: url("/fonts/${name}") format("woff2");
  unicode-range: ${ranges[subset]};
}`);
    }
  }
}

// Local fallbacks sized to each family's metrics (performance.md §2.2)
const CAPSIZE: Record<string, string> = {
  "Onest": "onest",
  "Golos Text": "golosText",
  "Manrope": "manrope",
  "Literata": "literata",
  "Unbounded": "unbounded",
  "IBM Plex Sans": "ibmPlexSans",
  "Rubik": "rubik",
  "JetBrains Mono": "jetBrainsMono",
  "Arial": "arial",
  "Roboto": "roboto",
  "Times New Roman": "timesNewRoman",
  "Noto Serif": "notoSerif",
  "Courier New": "courierNew",
  "Roboto Mono": "robotoMono",
};
const metrics = async (family: string) =>
  (await import(`@capsizecss/metrics/${CAPSIZE[family]}`)).default;
const fallbackFaces: string[] = [];
for (const family of byFamily.keys()) {
  const stack = createFontStack([
    await metrics(family),
    ...await Promise.all(
      fallbacksOf(family as FontFamily).map((f) => metrics(f)),
    ),
  ]);
  fallbackFaces.push(stack.fontFaces.trim());
}

await Deno.writeTextFile(
  CSS,
  `/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Generated by tools/gen_fonts.ts from shared/theme/fonts.ts: do not edit.
   Fonts: SIL Open Font License 1.1 (client/public/fonts/<family>/OFL.txt). */

${faces.join("\n\n")}

/* Local fallbacks adjusted to each family's metrics, so the swap barely
   shifts the layout (performance.md §2.2) */
${fallbackFaces.join("\n\n")}
`,
);

// The repository's own formatting, so `make ci` (fmt-check) passes
await new Deno.Command(Deno.execPath(), { args: ["fmt", "--quiet", CSS] })
  .output();

let over = false;
for (const id of PRESET_IDS) {
  let bytes = 0;
  for (const f of FONT_MANIFEST[id]) {
    for (const subset of SUBSETS) bytes += sizes.get(fontFileName(f, subset))!;
  }
  const kb = bytes / 1024;
  over ||= kb > PRESET_BUDGET_KB;
  console.log(
    `${kb > PRESET_BUDGET_KB ? "OVER" : "ok  "}  ${id.padEnd(9)} ${
      kb.toFixed(1).padStart(6)
    } KB`,
  );
}
console.log(`${faces.length} faces, ${sizes.size} files`);
if (over) {
  console.error(
    `A preset is over ${PRESET_BUDGET_KB} KB (performance.md §2.3)`,
  );
  Deno.exit(1);
}
