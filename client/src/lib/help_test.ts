// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The help link's steps, its sheets and the Settings → Words sections
 * (ui.md §6.5, §11.9), over the real glossary: its texts may
 * still be empty drafts, so only shape and order are checked here.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import * as glossary from "../../../shared/glossary.ts";
import type { MessageKey } from "../../../shared/i18n/keys.ts";
import { t as translate } from "../../../shared/i18n/format.ts";
import {
  glossarySections,
  HELP_OF,
  type HelpContent,
  helpContent,
  loadGlossary,
  type TermGroup,
} from "./help.ts";
import { STEPS } from "./machine.ts";

const t = (k: MessageKey) => translate("en", k);

function groups(content: HelpContent | null): TermGroup[] {
  assert(content?.kind === "terms");
  return content.groups;
}

const sizes = (word: string | null) =>
  groups(helpContent("word", word, "en", glossary, t)).map((g) =>
    g.terms.length
  );

Deno.test("help - step 6 lists 8 words, 3 certainties and only the chosen word's finer words", () => {
  assertEquals(sizes("fear"), [8, 3, 8]);
  assertEquals(sizes("fear.anxiety"), [8, 3, 8]);
  assertEquals(sizes(null), [8, 3]);
  assertEquals(sizes("unknown"), [8, 3]);
  assertEquals(sizes("empty"), [8, 3, 6]);
  const [, sure, l2] = groups(helpContent("word", "fear", "en", glossary, t));
  assertEquals(sure.heading, "How sure are you of the word?");
  assertEquals(l2.heading, "More precisely (optional)");
  assert(l2.terms.every((term) => term.key.startsWith("fear.")));
  assertEquals(
    groups(helpContent("word", "fear", "en", glossary, t))[0].heading,
    null,
  );
});

Deno.test("help - steps 2, 7 and 9 list every option, nulls included", () => {
  const one = (step: "qualities" | "urge" | "context") =>
    groups(helpContent(step, null, "en", glossary, t));
  assertEquals(one("qualities").map((g) => g.terms.length), [23]);
  assertEquals(one("urge").map((g) => g.terms.length), [13]);
  assertEquals(one("context").map((g) => g.terms.length), [10]);
  const keys = one("qualities")[0].terms.map((term) => term.key);
  assertEquals(keys.slice(-2), ["nothing", "cant_tell"]);
});

Deno.test("help - a slider step shows its scale, step 1 nothing", () => {
  for (
    const step of ["intensity", "valence", "arousal", "head_mode"] as const
  ) {
    const content = helpContent(step, null, "ru", glossary, t);
    assertEquals(content?.kind, "scale");
    assert(content?.kind === "scale");
    assertEquals(content.text, glossary.SCALE_DESCRIPTIONS[step].text.ru);
  }
  assertEquals(helpContent("locations", null, "en", glossary, t), null);
});

Deno.test("help - the link is on steps 2–9, never on step 1", () => {
  assertEquals(HELP_OF.locations, undefined);
  assertEquals(
    STEPS.map((s) => HELP_OF[s] ?? null),
    [
      null,
      "words",
      "question",
      "question",
      "question",
      "words",
      "words",
      "question",
      "words",
    ],
  );
  // Every linked step has a sheet
  for (const step of STEPS) {
    assertEquals(
      helpContent(step, null, "en", glossary, t) !== null,
      HELP_OF[step] !== undefined,
    );
  }
});

Deno.test("help - labels come from the dictionaries, texts from the glossary", () => {
  const [l1] = groups(helpContent("word", null, "uk", glossary, t));
  const joy = l1.terms.find((term) => term.key === "joy");
  assertEquals(joy?.label, "радість / легкість");
  assertEquals(joy?.text, glossary.TERM_DESCRIPTIONS.WORDS.joy?.text.uk ?? "");
});

Deno.test("help - Settings → Words follows the check-in's nine eyebrows", () => {
  const sections = glossarySections("en", glossary, t);
  assertEquals(
    sections.map((s) => s.heading),
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
      t(`checkin.eyebrow.${n}` as MessageKey)
    ),
  );
  assertEquals(sections.map((s) => s.kind), [
    "terms",
    "terms",
    "scale",
    "scale",
    "scale",
    "words",
    "terms",
    "scale",
    "terms",
  ]);
  const body = sections[0];
  assert(body.kind === "terms");
  assertEquals(body.terms.map((term) => term.key), ["whole_body", "nowhere"]);
  const valence = sections[3];
  assert(valence.kind === "scale");
  assertEquals(valence.term.label, t("checkin.step.4.title"));
  const word = sections[5];
  assert(word.kind === "words");
  assertEquals(word.words.length, 8);
  assertEquals(
    word.words.map((w) => w.l2.length),
    [8, 8, 8, 5, 11, 4, 6, 0],
  );
  assertEquals(word.certainty.length, 3);
  assertEquals(word.certaintyHeading, t("checkin.step.6.confidence.title"));
});

Deno.test("help - no label repeats inside a group", () => {
  const lists: string[][] = [];
  for (const step of STEPS) {
    const content = helpContent(step, "fear", "en", glossary, t);
    if (content?.kind === "terms") {
      for (const g of content.groups) lists.push(g.terms.map((x) => x.label));
    }
  }
  for (const s of glossarySections("ru", glossary, t)) {
    if (s.kind === "terms") lists.push(s.terms.map((x) => x.label));
    if (s.kind === "words") {
      lists.push(s.words.map((w) => w.l1.label));
      for (const w of s.words) lists.push(w.l2.map((x) => x.label));
      lists.push(s.certainty.map((x) => x.label));
    }
  }
  for (const labels of lists) assertEquals(new Set(labels).size, labels.length);
});

Deno.test("help - the descriptions load once, as their own module", async () => {
  const first = loadGlossary();
  assertStrictEquals(loadGlossary(), first);
  const g = await first;
  assertStrictEquals(g.TERM_DESCRIPTIONS, glossary.TERM_DESCRIPTIONS);
});
