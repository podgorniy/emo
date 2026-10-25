// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PWA shell guards (ui.md §4, §16.2): the manifest's id,
 * description and one "Check in now" shortcut; no app badging, haptics or
 * notification actions (methodology.md §2.14); pinch-zoom never
 * locked; and every scroller in the code contains its own scroll, so nothing
 * chains past an edge into the page behind it.
 */
import { assertEquals, assertMatch, assertNotMatch } from "@std/assert";
import { findForbiddenWord } from "../../../shared/i18n/forbidden.ts";

const ROOT = new URL("../../../", import.meta.url);

/** Repo-relative paths of the files under `dir` whose names pass `keep` */
async function filesUnder(dir: string, keep: (name: string) => boolean) {
  const files: string[] = [];
  async function walk(d: string) {
    for await (const e of Deno.readDir(new URL(d, ROOT))) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory) {
        if (e.name !== "node_modules" && e.name !== "dist") await walk(p);
      } else if (keep(e.name)) files.push(p);
    }
  }
  await walk(dir);
  return files.sort();
}

const read = (path: string) => Deno.readTextFile(new URL(path, ROOT));

/** Every string value in a JSON document, with its path */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      strings(v, path ? `${path}.${k}` : k)
    );
  }
  return [];
}

Deno.test("pwa - the manifest: id, description and a manual check-in shortcut", async () => {
  const manifest = JSON.parse(await read("client/public/manifest.webmanifest"));
  assertEquals(manifest.id, "/");
  assertEquals(typeof manifest.description, "string");
  assertEquals(manifest.description.trim().length > 0, true);
  assertEquals(manifest.shortcuts.length, 1);
  // A manual check-in: never tied to a reminder
  assertEquals(manifest.shortcuts[0].url, "/now");
  assertNotMatch(manifest.shortcuts[0].url, /reminder=/);
  // No orientation lock (WCAG 1.3.4)
  assertEquals("orientation" in manifest, false);
  for (const [where, text] of strings(manifest)) {
    const hit = findForbiddenWord(text);
    assertEquals(
      hit,
      null,
      `Forbidden word "${hit}" in manifest ${where}: "${text}"`,
    );
  }
});

Deno.test("pwa - no app badging, haptics or notification actions", async () => {
  const code = [
    ...await filesUnder(
      "client/src",
      (n) => /\.(ts|js|svelte)$/.test(n) && !n.endsWith("_test.ts"),
    ),
    ...await filesUnder(
      "server",
      (n) => n.endsWith(".ts") && !n.endsWith("_test.ts"),
    ),
  ];
  assertEquals(code.length > 20, true);
  const hits: string[] = [];
  for (const f of code) {
    const text = await read(f);
    for (
      const m of text.matchAll(
        /\b(setAppBadge|clearAppBadge)\b|navigator\s*\.\s*vibrate\b/g,
      )
    ) {
      hits.push(`${f}: ${m[0]}`);
    }
  }
  assertEquals(hits, []);
  // A reminder is one tap into the check-in, never a snooze or a skip button
  const sw = await read("client/src/sw.js");
  assertMatch(sw, /showNotification\(/);
  assertNotMatch(sw, /showNotification\([^)]*actions\s*:/s);
});

Deno.test("pwa - the viewport never locks pinch-zoom", async () => {
  const html = await read("client/index.html");
  const meta = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
  assertEquals(meta !== null, true, "no viewport meta in client/index.html");
  const content = meta![1];
  assertMatch(content, /width=device-width/);
  assertNotMatch(content, /user-scalable\s*=\s*(no|0)/i);
  assertNotMatch(content, /maximum-scale/i);
});

/**
 * The innermost CSS rule blocks of a stylesheet, comments removed: the text
 * before each `{ … }` without nested braces, and its declarations.
 */
function ruleBlocks(css: string): { selector: string; body: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, " "),
    body: m[2],
  }));
}

/** Whether a block's declarations make it a vertical scroller */
function scrollsVertically(body: string): boolean {
  if (/(?:^|[;\s])overflow-y\s*:\s*(auto|scroll)\b/.test(body)) return true;
  // `overflow: <x> <y>` or `overflow: <both>`
  const short = body.match(
    /(?:^|[;\s])overflow\s*:\s*([a-z-]+)(?:\s+([a-z-]+))?/,
  );
  const y = short ? short[2] ?? short[1] : "";
  return y === "auto" || y === "scroll";
}

Deno.test("pwa - the scroller sweep reads rules and overflow shorthands", () => {
  const blocks = ruleBlocks(
    "/* .x { overflow: auto } */ .a { overflow-y: auto; }\n@media (min-width: 1px) { .b { overflow: hidden auto } }",
  );
  assertEquals(blocks.map((b) => b.selector), [".a", ".b"]);
  assertEquals(scrollsVertically("overflow-y: auto;"), true);
  assertEquals(scrollsVertically("overflow: scroll"), true);
  assertEquals(scrollsVertically("overflow: hidden auto"), true);
  assertEquals(scrollsVertically("overflow: hidden"), false);
  assertEquals(
    scrollsVertically("overflow-x: auto; overflow-y: hidden"),
    false,
  );
  assertEquals(scrollsVertically("text-overflow: auto"), false);
});

Deno.test("pwa - every scroller contains its scroll (overscroll-behavior)", async () => {
  const files = await filesUnder(
    "client/src",
    (n) => n.endsWith(".svelte") || n.endsWith(".css"),
  );
  assertEquals(files.length > 10, true);
  const leaks: string[] = [];
  let scrollers = 0;
  for (const f of files) {
    const text = await read(f);
    const css = f.endsWith(".css")
      ? text
      : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1])
        .join("\n");
    for (const { selector, body } of ruleBlocks(css)) {
      if (!scrollsVertically(body)) continue;
      scrollers++;
      if (!/(?:^|[;\s])overscroll-behavior(-y|-block)?\s*:/.test(body)) {
        leaks.push(`${f} ${selector}`);
      }
    }
  }
  // The check-in's main, the sheet's body and the Data overlay, at least
  assertEquals(scrollers >= 3, true);
  assertEquals(
    leaks,
    [],
    "a scroller without overscroll-behavior chains into the page",
  );
});
