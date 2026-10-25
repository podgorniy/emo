// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Repository checks for `make lint`: the SPDX header on every source file
 * (development.md §7.3) and no inline `style` attributes or `<style>` blocks in
 * markup, which the strict CSP would block (reliability.md §4.1).
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = [
  "client/src",
  "client/public",
  "client/index.html",
  "server",
  "shared",
  "perf",
  "tools",
  "e2e",
];
const SPDX = "SPDX-License-Identifier: AGPL-3.0-or-later";

function* walk(target: string): Generator<string> {
  const stat = Deno.statSync(target);
  if (stat.isFile) {
    yield target;
    return;
  }
  for (const entry of Deno.readDirSync(target)) {
    // Build output, and the generated e2e/perf reports
    if (["node_modules", "dist", "report"].includes(entry.name)) continue;
    yield* walk(path.join(target, entry.name));
  }
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
}

function spdxProblem(file: string, text: string): string | null {
  const ext = path.extname(file);
  if (ext === ".ts" || ext === ".js") {
    return firstLine(text) === `// ${SPDX}`
      ? null
      : "first line must be the SPDX header";
  }
  if (ext === ".sql") {
    return firstLine(text) === `-- ${SPDX}`
      ? null
      : "first line must be the SPDX header";
  }
  if (ext === ".css") {
    return firstLine(text) === `/* ${SPDX} */`
      ? null
      : "first line must be the SPDX header";
  }
  if (ext === ".svelte") {
    const script = /<script[^>]*>\s*\n\s*(.*)/.exec(text);
    if (script) {
      return script[1].trim() === `// ${SPDX}`
        ? null
        : "the first line inside the first <script> must be the SPDX header";
    }
    return firstLine(text) === `<!-- ${SPDX} -->`
      ? null
      : "SPDX HTML comment missing";
  }
  if (ext === ".html") {
    return text.split("\n").slice(0, 3).some((l) => l.includes(SPDX))
      ? null
      : "SPDX comment missing near the top";
  }
  return null;
}

function styleProblems(file: string, text: string): string[] {
  const ext = path.extname(file);
  if (ext !== ".svelte" && ext !== ".html") return [];
  // Svelte's own <style> block compiles to a CSS file; markup is checked
  const markup = ext === ".svelte"
    ? text.replace(/<style[\s\S]*?<\/style>/g, "")
    : text;
  const out: string[] = [];
  markup.split("\n").forEach((line, i) => {
    if (/\sstyle\s*=/.test(line)) {
      out.push(`line ${i + 1}: inline style attribute (use a class or style:)`);
    }
    if (ext === ".html" && /<style[\s>]/.test(line)) {
      out.push(`line ${i + 1}: <style> block (move it to a .css file)`);
    }
  });
  return out;
}

let problems = 0;
for (const dir of DIRS) {
  const target = path.join(ROOT, dir);
  for (const file of walk(target)) {
    if (!/\.(ts|js|svelte|sql|html|css)$/.test(file)) continue;
    const text = Deno.readTextFileSync(file);
    const rel = path.relative(ROOT, file);
    const spdx = spdxProblem(file, text);
    if (spdx) {
      console.error(`${rel}: ${spdx}`);
      problems++;
    }
    for (const p of styleProblems(file, text)) {
      console.error(`${rel}: ${p}`);
      problems++;
    }
  }
}
if (problems > 0) {
  console.error(`${problems} problem(s)`);
  Deno.exit(1);
}
console.log("check_repo: SPDX headers and inline styles ok");
