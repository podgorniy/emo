// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The built-in pages in client/public: every in-page link lands, every
 * stylesheet url() exists, and the methodology page's three languages keep
 * one shape and name only fields the export has (methodology.html mirrors
 * llm/methodology.md; the vocabulary rule is in forbidden_test.ts).
 */
import { assert, assertEquals } from "@std/assert";
import {
  CSV_COLUMNS,
  type ExportedReminder,
  exportedReminder,
} from "../export.ts";

const PUBLIC = new URL("../../client/public/", import.meta.url);
const read = (file: string) => Deno.readTextFile(new URL(file, PUBLIC));
const LANGS = ["en", "uk", "ru"] as const;

const all = (text: string, re: RegExp) =>
  [...text.matchAll(re)].map((m) => m[1]);

Deno.test("pages - ids are unique and every #link lands", async () => {
  for (const file of ["privacy.html", "methodology.html"]) {
    const html = (await read(file)).replace(/<!--[\s\S]*?-->/g, "");
    const ids = all(html, /\sid="([^"]+)"/g);
    assertEquals(new Set(ids).size, ids.length, `${file}: a repeated id`);
    for (const target of all(html, /\shref="#([^"]*)"/g)) {
      assert(ids.includes(target), `${file}: #${target} lands nowhere`);
    }
  }
});

/** One language of the methodology page, with its own prefix taken off */
function article(html: string, lang: string) {
  const text = html.match(
    new RegExp(`<article id="${lang}"[\\s\\S]*?</article>`),
  )?.[0];
  assert(text, `no #${lang} article`);
  return {
    sections: all(text, /\sid="([^"]+)"/g)
      .map((id) => id.replace(new RegExp(`^${lang}(-|$)`), "")),
    pills: all(text, /class="ev (ev-[abc])"/g),
    // Field names: the line under a heading, and the field map's terms
    chips: all(
      [...text.matchAll(
        /<p class="tags">([\s\S]*?)<\/p>|<dt>([\s\S]*?)<\/dt>/g,
      )]
        .map((m) => m[1] ?? m[2]).join(" "),
      /<code>([^<]+)<\/code>/g,
    ),
  };
}

Deno.test("pages - methodology: en, uk and ru have one shape", async () => {
  const html = await read("methodology.html");
  const [en, ...rest] = LANGS.map((l) => article(html, l));
  assert(en.sections.includes("s7"), "every section up to §7");
  assert(en.pills.length > 20, String(en.pills.length));
  for (const [i, other] of rest.entries()) {
    const lang = LANGS[i + 1];
    assertEquals(other.sections, en.sections, `${lang}: sections`);
    assertEquals(other.pills, en.pills, `${lang}: evidence levels`);
    assertEquals(other.chips, en.chips, `${lang}: field names`);
  }
});

Deno.test("pages - methodology: every field named is a field of the export", async () => {
  const html = await read("methodology.html");
  const reminderFields = Object.keys(exportedReminder({} as ExportedReminder));
  const known = new Set<string>([...CSV_COLUMNS, ...reminderFields]);
  const { chips } = article(html, "en");
  assert(chips.length > 20, String(chips.length));
  for (const chip of chips) {
    // JSONL nests what the CSV flattens: affect.valence → affect_valence
    assert(known.has(chip.replaceAll(".", "_")), `not in the export: ${chip}`);
  }
});

Deno.test("pages - every url() in a public stylesheet exists", async () => {
  for await (const entry of Deno.readDir(PUBLIC)) {
    if (!entry.name.endsWith(".css")) continue;
    const css = await read(entry.name);
    for (const url of all(css, /url\("?([^")]+)"?\)/g)) {
      assert(url.startsWith("/"), `${entry.name}: ${url} is not root-relative`);
      const stat = await Deno.stat(new URL(url.slice(1), PUBLIC)).catch(() =>
        null
      );
      assert(stat?.isFile, `${entry.name}: ${url} does not exist`);
    }
  }
});
