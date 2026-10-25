// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Bundle-size gate for `make build`: reads Vite's manifest, gzips each chunk
 * and compares with `perf/budgets.json`. Exits 1 over budget.
 * Specification: performance.md §1.1, §5.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestChunk {
  file: string;
  name?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "client/dist");
const budgets = JSON.parse(
  await Deno.readTextFile(path.join(root, "perf/budgets.json")),
) as Record<string, number>;
const manifest = JSON.parse(
  await Deno.readTextFile(path.join(dist, ".vite/manifest.json")),
) as Record<string, ManifestChunk>;

async function gzipKb(file: string): Promise<number> {
  const bytes = await Deno.readFile(path.join(dist, file));
  const stream = new Blob([bytes]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return (await new Response(stream).arrayBuffer()).byteLength / 1024;
}

// The shell: entry chunks and everything they import statically
const shell = new Set<string>();
const visit = (key: string) => {
  if (shell.has(key)) return;
  shell.add(key);
  for (const dep of manifest[key].imports ?? []) visit(dep);
};
for (const [key, chunk] of Object.entries(manifest)) {
  if (chunk.isEntry) visit(key);
}

const rows: Array<{ what: string; kb: number; budget: number }> = [];
let shellJs = 0;
const shellCss = new Set<string>();
for (const key of shell) {
  shellJs += await gzipKb(manifest[key].file);
  for (const css of manifest[key].css ?? []) shellCss.add(css);
}
rows.push({
  what: "shell JS (gzip)",
  kb: shellJs,
  budget: budgets.shell_js_gzip_kb,
});
let css = 0;
for (const file of shellCss) css += await gzipKb(file);
rows.push({ what: "shell CSS (gzip)", kb: css, budget: budgets.css_gzip_kb });
// A lazy chunk with a budget of its own (`<name>_chunk_gzip_kb`, e.g. the
// History pane's), else the one for any lazy chunk
for (const [key, chunk] of Object.entries(manifest)) {
  if (shell.has(key) || !chunk.file.endsWith(".js")) continue;
  const own = budgets[`${chunk.name?.toLowerCase()}_chunk_gzip_kb`];
  rows.push({
    what: `lazy ${chunk.file} (gzip)`,
    kb: await gzipKb(chunk.file),
    budget: own ?? budgets.lazy_chunk_gzip_kb,
  });
}
let icons = 0;
for (const entry of Deno.readDirSync(dist)) {
  if (/^(icon|apple-touch|badge).*\.png$/.test(entry.name)) {
    icons += Deno.statSync(path.join(dist, entry.name)).size / 1024;
  }
}
rows.push({ what: "manifest icons", kb: icons, budget: budgets.icons_kb });

// The service worker's precache list (written by the build, vite.config.ts)
const sw = await Deno.readTextFile(path.join(dist, "sw.js"));
const precache = JSON.parse(
  /const PRECACHE = (\[[^\]]*\]);/.exec(sw)?.[1] ?? "[]",
) as string[];
let precacheKb = 0;
for (const url of precache) {
  precacheKb += Deno.statSync(path.join(dist, url.replace(/^\//, ""))).size /
    1024;
}
rows.push({
  what: "SW precache (raw)",
  kb: precacheKb,
  budget: budgets.precache_kb,
});

let failed = false;
for (const r of rows) {
  const over = r.kb > r.budget;
  failed ||= over;
  console.log(
    `${over ? "OVER" : "ok  "}  ${r.what.padEnd(48)} ${
      r.kb.toFixed(1).padStart(7)
    } KB / ${r.budget} KB`,
  );
}
if (failed) {
  console.error("Bundle over budget (performance.md §1.1)");
  Deno.exit(1);
}
