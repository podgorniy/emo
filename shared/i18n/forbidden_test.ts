// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Forbidden words (methodology.md §3, copy.md §8.2) in every
 * string a user can read: UI tables (i18n_test.ts), dictionary and group
 * labels, the glossary's descriptions, theme names, mail and push copy, and
 * the copy that still lives in components and the service worker.
 */
import { assertEquals } from "@std/assert";
import { findForbiddenWord } from "./forbidden.ts";
import {
  BODY_ZONES,
  CONTEXT_TAGS,
  type Locale,
  QUALITIES,
  QUALITY_GROUPS,
  URGES,
  WORD_CONFIDENCE,
  WORDS,
} from "../dictionaries.ts";
import { SCALE_DESCRIPTIONS, TERM_DESCRIPTIONS } from "../glossary.ts";
import { PRESETS } from "../theme/presets.ts";
import { MailService } from "../../server/services/mail.ts";
import type { Config } from "../../server/config.ts";

const LOCALES: Locale[] = ["en", "ru", "uk"];

function assertClean(where: string, text: string) {
  const hit = findForbiddenWord(text);
  assertEquals(hit, null, `Forbidden word "${hit}" in ${where}: "${text}"`);
}

Deno.test("forbidden - negative control: the matcher catches each language", () => {
  assertEquals(findForbiddenWord("How are you feeling?"), "feeling");
  assertEquals(findForbiddenWord("Какое у вас настроение"), "настроение");
  assertEquals(findForbiddenWord("Яке почуття зараз"), "почуття");
  // Whole words only
  assertEquals(findForbiddenWord("unfeeling Emo"), null);
});

Deno.test("forbidden - dictionary and group labels", () => {
  const items = [
    ...BODY_ZONES,
    ...QUALITIES,
    ...URGES,
    ...CONTEXT_TAGS,
    ...WORD_CONFIDENCE,
    ...WORDS,
    ...WORDS.flatMap((w) => w.l2),
  ];
  for (const item of items) {
    for (const l of LOCALES) {
      assertClean(`label ${item.key}.${l}`, item.label[l]);
    }
  }
  for (const [group, labels] of Object.entries(QUALITY_GROUPS)) {
    for (const l of LOCALES) assertClean(`group ${group}.${l}`, labels[l]);
  }
});

Deno.test("forbidden - glossary descriptions, every language", () => {
  const groups = { SCALES: SCALE_DESCRIPTIONS, ...TERM_DESCRIPTIONS };
  for (const [group, record] of Object.entries(groups)) {
    for (const [key, d] of Object.entries(record)) {
      for (const l of LOCALES) {
        assertClean(`glossary ${group}.${key}.${l}`, d.text[l]);
      }
    }
  }
});

Deno.test("forbidden - theme names and descriptions", () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    for (const [field, value] of Object.entries(preset)) {
      if (typeof value === "string") assertClean(`theme ${id}.${field}`, value);
    }
  }
});

Deno.test("forbidden - mail copy in every locale", () => {
  const mail = new MailService({} as Config, null);
  for (const l of LOCALES) {
    const code = mail.renderLoginCodeMail("123456", l);
    const key = mail.renderRecoveryKeyMail("0000-0000", l, true);
    for (
      const [part, text] of Object.entries({
        ...code,
        k: key.text,
        ks: key.subject,
      })
    ) {
      assertClean(`mail ${l}.${part}`, text);
    }
  }
});

Deno.test("forbidden - copy in components, the service worker and push", async () => {
  const root = new URL("../../", import.meta.url);
  const files: string[] = [
    "client/src/sw.js",
    "client/index.html",
    "server/services/scheduler.ts",
  ];
  async function walk(dir: string) {
    for await (const e of Deno.readDir(new URL(dir, root))) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (e.name.endsWith(".svelte")) files.push(p);
    }
  }
  await walk("client/src");
  assertEquals(files.length > 10, true);
  for (const f of files) {
    const text = (await Deno.readTextFile(new URL(f, root)))
      .replace(/<style[\s\S]*?<\/style>/g, ""); // CSS is not copy
    for (const [i, line] of text.split("\n").entries()) {
      assertClean(`${f}:${i + 1}`, line);
    }
  }
});

/** A name of a theory, scale or work on the methodology page: kept as
 * published, so outside the rule (methodology.html's header comment) */
const NAME = /<cite>([\s\S]*?)<\/cite>|<i class="term">([\s\S]*?)<\/i>/g;

/**
 * What a person reads on a built-in page: the text between tags and the
 * attribute values that are read out or shown (alt, title, aria-label).
 * With `names`, names (NAME) are cut out first and returned on their own.
 */
function pageText(html: string, names?: string[]): string {
  let page = html.replace(/<!--[\s\S]*?-->/g, "");
  if (names) {
    page = page.replace(NAME, (_, cite, term) => {
      names.push(cite ?? term);
      return " ";
    });
  }
  const attrs = [...page.matchAll(/\s(?:alt|title|aria-label)="([^"]*)"/g)]
    .map((m) => m[1]);
  return [page.replace(/<[^>]+>/g, " "), ...attrs].join("\n");
}

function assertPageClean(where: string, text: string) {
  for (const sentence of text.split(/[.!?;:\n]+/)) {
    if (sentence.trim()) assertClean(where, sentence.trim());
  }
}

const readPublic = (file: string) =>
  Deno.readTextFile(new URL(`../../client/public/${file}`, import.meta.url));

Deno.test("forbidden - the built-in privacy notice, every language", async () => {
  assertPageClean("privacy.html", pageText(await readPublic("privacy.html")));
});

Deno.test("forbidden - the methodology page: own prose clean, names exempt", async () => {
  const html = await readPublic("methodology.html");
  for (const lang of LOCALES) {
    const article = html.match(
      new RegExp(`<article id="${lang}"[\\s\\S]*?</article>`),
    )?.[0];
    assertEquals(typeof article, "string", `no #${lang} article`);
    const names: string[] = [];
    const text = pageText(article!, names);
    assertPageClean(`methodology.html#${lang}`, text);
    // The exemption covers names, not prose: short, no markup inside,
    // and most of the page is still checked
    for (const name of names) {
      assertEquals(name.length <= 200, true, `long name: "${name}"`);
      assertEquals(/[<>]/.test(name), false, `markup in a name: "${name}"`);
    }
    const checked = text.replace(/\s+/g, " ").length;
    assertEquals(checked >= 10_000, true, `#${lang}: ${checked} characters`);
  }
});

Deno.test("forbidden - negative control: a page's prose is checked, its names are not", () => {
  const names: string[] = [];
  const text = pageText(
    '<p>Barrett, <cite>How Emotions Are Made</cite>; <i class="term">' +
      'emotional granularity</i></p><img alt="" title="Mood">',
    names,
  );
  assertEquals(names, ["How Emotions Are Made", "emotional granularity"]);
  assertEquals(findForbiddenWord(text), "Mood");
  assertEquals(
    findForbiddenWord(pageText("<p>Track your feelings</p>")),
    "feelings",
  );
});
