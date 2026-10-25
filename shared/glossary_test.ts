// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Content rules of the term and scale descriptions, R1–R9 (copy.md §8.3;
 * the writing guidelines are in ui.md §6.5 and data.md §5). Every rule runs per
 * group, so each writer can filter on their own:
 * `--filter "/WORDS|WORD_CONFIDENCE/"`. The negative controls show that each
 * matcher catches a planted example, as in `i18n/forbidden_test.ts`.
 */
import { assert, assertEquals } from "@std/assert";
import {
  BODY_ZONES,
  CONTEXT_TAGS,
  type DictItem,
  forInput,
  type Locale,
  QUALITIES,
  URGES,
  WORD_CONFIDENCE,
  WORDS,
} from "./dictionaries.ts";
import { findForbiddenWord } from "./i18n/forbidden.ts";
import { findStopPhrase } from "./entry.ts";
import {
  type Description,
  glossaryPendingReview,
  SCALE_DESCRIPTIONS,
  type ScaleId,
  TERM_DESCRIPTIONS,
} from "./glossary.ts";

const LOCALES: Locale[] = ["en", "ru", "uk"];

type Group =
  | "BODY_ZONES"
  | "QUALITIES"
  | "SCALES"
  | "WORDS"
  | "WORD_CONFIDENCE"
  | "URGES"
  | "CONTEXT_TAGS";

const GROUPS: Group[] = [
  "BODY_ZONES",
  "QUALITIES",
  "SCALES",
  "WORDS",
  "WORD_CONFIDENCE",
  "URGES",
  "CONTEXT_TAGS",
];

const SCALES: ScaleId[] = ["intensity", "valence", "arousal", "head_mode"];

/** The two zone options the figure does not define (ui.md §6.5). */
const NON_SPATIAL_ZONES = ["whole_body", "nowhere"];

/**
 * The measurement steps whose labels R7 compares: zones (1), qualities (2),
 * words with their certainty (6) and urges (7). Situations (9) are not one:
 * their labels are everyday nouns ("body / sport" would ban "body").
 */
type LabelStep = 1 | 2 | 6 | 7;

const OWN_STEP: Record<Group, LabelStep | null> = {
  BODY_ZONES: 1,
  QUALITIES: 2,
  SCALES: null,
  WORDS: 6,
  WORD_CONFIDENCE: 6,
  URGES: 7,
  CONTEXT_TAGS: null,
};

interface Term {
  key: string;
  label: Record<Locale, string> | null;
}

/** Every key a group must describe, in dictionary order, with its label. */
function expectedTerms(group: Group): Term[] {
  const plain = (items: DictItem[]) =>
    forInput(items).map((i) => ({ key: i.key, label: i.label }));
  switch (group) {
    case "BODY_ZONES":
      return plain(BODY_ZONES).filter((z) => NON_SPATIAL_ZONES.includes(z.key));
    case "QUALITIES":
      return plain(QUALITIES);
    case "SCALES":
      return SCALES.map((key) => ({ key, label: null }));
    case "WORDS":
      return forInput(WORDS).flatMap((l1) => [
        { key: l1.key, label: l1.label },
        ...forInput(l1.l2).map((l2) => ({
          key: `${l1.key}.${l2.key}`,
          label: l2.label,
        })),
      ]);
    case "WORD_CONFIDENCE":
      return plain(WORD_CONFIDENCE);
    case "URGES":
      return plain(URGES);
    case "CONTEXT_TAGS":
      return plain(CONTEXT_TAGS);
  }
}

function recordOf(group: Group): Record<string, Description> {
  return group === "SCALES" ? SCALE_DESCRIPTIONS : TERM_DESCRIPTIONS[group];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `’` counts as `'`, as in the note validator. */
function plainQuotes(s: string): string {
  return s.replaceAll("’", "'");
}

/**
 * R7's normalisation of a label: parenthesised parts removed, split on "/",
 * trimmed, lower case, `’` as `'`.
 */
function labelParts(label: string): string[] {
  return plainQuotes(label.replace(/\s*\([^)]*\)/g, ""))
    .split("/")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p !== "");
}

function phraseRegex(phrase: string, flags: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}'’])${escapeRegex(plainQuotes(phrase))}(?![\\p{L}'’])`,
    flags,
  );
}

/** A whole word or phrase, case-insensitive. */
function hasPhrase(text: string, phrase: string): boolean {
  return phraseRegex(phrase, "iu").test(plainQuotes(text));
}

function labelsOf(items: DictItem[], locale: Locale): string[] {
  return forInput(items).flatMap((i) => labelParts(i.label[locale]));
}

/** The labels a person sees on each measurement step, per language. */
function stepLabels(step: LabelStep, locale: Locale): Set<string> {
  switch (step) {
    case 1:
      return new Set(labelsOf(BODY_ZONES, locale));
    case 2:
      return new Set(labelsOf(QUALITIES, locale));
    case 6:
      return new Set([
        ...labelsOf(WORDS, locale),
        ...forInput(WORDS).flatMap((l1) => labelsOf(l1.l2, locale)),
        ...labelsOf(WORD_CONFIDENCE, locale),
      ]);
    case 7:
      return new Set(labelsOf(URGES, locale));
  }
}

/** Labels of another measurement step that are not also the group's own. */
function foreignLabels(group: Group, locale: Locale): Set<string> {
  const own = OWN_STEP[group];
  const ownLabels = own === null ? new Set<string>() : stepLabels(own, locale);
  const out = new Set<string>();
  for (const step of [1, 2, 6, 7] as LabelStep[]) {
    if (step === own) continue;
    for (const label of stepLabels(step, locale)) {
      if (!ownLabels.has(label)) out.add(label);
    }
  }
  return out;
}

/**
 * R7: the foreign labels a text contains, before its `allow` entries. The
 * group's own labels are set aside first, so a near term quoted in full
 * ("tense waiting") does not count as the foreign label inside it ("tense").
 */
function findForeignLabels(
  group: Group,
  locale: Locale,
  text: string,
): string[] {
  const own = OWN_STEP[group];
  let rest = plainQuotes(text);
  if (own !== null) {
    const labels = [...stepLabels(own, locale)].sort((a, b) =>
      b.length - a.length
    );
    for (const label of labels) {
      rest = rest.replace(phraseRegex(label, "giu"), " ");
    }
  }
  return [...foreignLabels(group, locale)].filter((l) => hasPhrase(rest, l));
}

/** What is wrong with a description's R7 exceptions; empty when valid. */
function allowProblems(group: Group, d: Description): string[] {
  const out: string[] = [];
  for (const a of d.allow ?? []) {
    const label = plainQuotes(a.label.trim().toLowerCase());
    if (!foreignLabels(group, a.locale).has(label)) {
      out.push(`"${a.label}" is not a ${a.locale} label of another step`);
    }
    if (!hasPhrase(d.text[a.locale], label)) {
      out.push(`"${a.label}" is not in the ${a.locale} text`);
    }
    if (a.reason.trim() === "") out.push(`"${a.label}" has no reason`);
  }
  return out;
}

/** R7 after the reviewed exceptions. */
function crossLabelHits(
  group: Group,
  locale: Locale,
  d: Description,
): string[] {
  const allowed = new Set(
    (d.allow ?? []).filter((a) => a.locale === locale).map((a) =>
      plainQuotes(a.label.trim().toLowerCase())
    ),
  );
  return findForeignLabels(group, locale, d.text[locale]).filter((l) =>
    !allowed.has(l)
  );
}

/** R5, whole words: norms, frequency, coaching, clinical terms (en). */
const NORM_WORDS = [
  "should",
  "must",
  "normal",
  "normally",
  "healthy",
  "supposed",
  "try",
  "usually",
  "typically",
  "most people",
  "breathe",
  "relax",
  "dissociation",
  "dissociative",
  "alexithymia",
  "disorder",
  "symptom",
  "symptoms",
  "trauma",
  "traumatic",
  "therapy",
  "therapeutic",
  "progress",
  "learning to",
];

/** R5, stems at a word start (ru, then uk). */
const NORM_STEMS = [
  "должн",
  "нужн",
  "нормальн",
  "постарайтесь",
  "попробуйте",
  "обычн",
  "большинств",
  "дышите",
  "расслабьтесь",
  "диссоциац",
  "алекситими",
  "расстройств",
  "симптом",
  "травм",
  "терап",
  "прогресс",
  "повинн",
  "треба",
  "нормальн",
  "спробуйте",
  "постарайтеся",
  "зазвичай",
  "звичайн",
  "більшіст",
  "дихайте",
  "розслабтеся",
  "дисоціац",
  "алекситимі",
  "розлад",
  "симптом",
  "травм",
  "терап",
  "прогрес",
];

const NORM_REGEX = new RegExp(
  `(?<![\\p{L}'’])(?:(?:${NORM_WORDS.map(escapeRegex).join("|")})` +
    `(?![\\p{L}'’])|(?:${NORM_STEMS.map(escapeRegex).join("|")}))`,
  "iu",
);

function findNormWord(text: string): string | null {
  return text.match(NORM_REGEX)?.[0] ?? null;
}

/** R8, stems at a word start: the vocabulary of the scales of steps 3–5. */
const SCALE_STEMS = [
  "strong",
  "strength",
  "charg",
  "energ",
  "pleasant",
  "unpleasant",
  "сил",
  "заряд",
  "энерг",
  "приятн",
  "неприятн",
  "енерг",
  "приємн",
  "неприємн",
];

const SCALE_REGEX = new RegExp(
  `(?<![\\p{L}'’])(?:${SCALE_STEMS.map(escapeRegex).join("|")})`,
  "iu",
);

function findScaleWord(text: string): string | null {
  return text.match(SCALE_REGEX)?.[0] ?? null;
}

/** R9: the part of its own label a text starts with, ignoring quotes. */
function startsWithLabel(text: string, label: string): string | null {
  const head = plainQuotes(text).replace(/^[\s«“"'„]+/u, "");
  for (const part of labelParts(label)) {
    if (new RegExp(`^${escapeRegex(part)}(?![\\p{L}'])`, "iu").test(head)) {
      return part;
    }
  }
  return null;
}

/** R1's global check: keys no dictionary offers for input. */
function orphanProblems(group: Group, keys: string[]): string[] {
  const out: string[] = [];
  const check = (key: string, items: DictItem[]) => {
    const item = items.find((i) => i.key === key);
    if (!item) out.push(`${group}.${key}: no such key in dictionaries.ts`);
    else if (item.retired) out.push(`${group}.${key}: retired`);
    return item;
  };
  for (const key of keys) {
    switch (group) {
      case "BODY_ZONES":
        if (check(key, BODY_ZONES) && !NON_SPATIAL_ZONES.includes(key)) {
          out.push(`BODY_ZONES.${key}: a spatial zone (the figure defines it)`);
        }
        break;
      case "QUALITIES":
        check(key, QUALITIES);
        break;
      case "SCALES":
        if (!(SCALES as string[]).includes(key)) {
          out.push(`SCALES.${key}: not one of the four scales`);
        }
        break;
      case "WORDS": {
        const [l1, l2, ...rest] = key.split(".");
        const word = WORDS.find((w) => w.key === l1);
        if (!word || rest.length > 0) {
          out.push(`WORDS.${key}: no such key in dictionaries.ts`);
        } else if (word.retired) out.push(`WORDS.${key}: retired`);
        else if (l2 !== undefined) check(l2, word.l2);
        break;
      }
      case "WORD_CONFIDENCE":
        check(key, WORD_CONFIDENCE);
        break;
      case "URGES":
        check(key, URGES);
        break;
      case "CONTEXT_TAGS":
        check(key, CONTEXT_TAGS);
        break;
    }
  }
  return out;
}

/** Every description of a group with its own label, in record order. */
function entries(group: Group): [string, Description, Term | undefined][] {
  const terms = expectedTerms(group);
  return Object.entries(recordOf(group)).map((
    [key, d],
  ) => [key, d, terms.find((t) => t.key === key)]);
}

for (const group of GROUPS) {
  const isScale = group === "SCALES";

  Deno.test(`glossary - ${group}: R1 every key has en, ru and uk text, in dictionary order`, () => {
    const record = recordOf(group);
    const want = expectedTerms(group).map((t) => t.key);
    const missing = want.flatMap((key) =>
      LOCALES.filter((l) => !record[key]?.text[l]?.trim()).map((l) =>
        `${key}.${l}`
      )
    );
    assertEquals(missing, [], "descriptions without text");
    assertEquals(orphanProblems(group, Object.keys(record)), []);
    assertEquals(Object.keys(record), want, "keys in dictionary order");
  });

  Deno.test(`glossary - ${group}: R2 length in code points`, () => {
    const limit: Record<Locale, number> = isScale
      ? { en: 320, ru: 380, uk: 380 }
      : { en: 200, ru: 240, uk: 240 };
    const over = entries(group).flatMap(([key, d]) =>
      LOCALES.filter((l) => Array.from(d.text[l]).length > limit[l]).map((
        l,
      ) => `${key}.${l}: ${Array.from(d.text[l]).length} > ${limit[l]}`)
    );
    assertEquals(over, []);
  });

  Deno.test(`glossary - ${group}: R3 no forbidden word`, () => {
    const hits = entries(group).flatMap(([key, d]) =>
      LOCALES.map((l) => [l, findForbiddenWord(d.text[l])] as const)
        .filter(([, hit]) => hit !== null)
        .map(([l, hit]) => `${key}.${l}: "${hit}"`)
    );
    assertEquals(hits, []);
  });

  Deno.test(`glossary - ${group}: R4 no stop-phrase (causes, meanings, why)`, () => {
    const hits = entries(group).flatMap(([key, d]) =>
      LOCALES.map((l) => [l, findStopPhrase(d.text[l])] as const)
        .filter(([, hit]) => hit !== null)
        .map(([l, hit]) => `${key}.${l}: "${hit?.phrase}"`)
    );
    assertEquals(hits, []);
  });

  Deno.test(`glossary - ${group}: R5 no norm, frequency, coaching or clinical word`, () => {
    const hits = entries(group).flatMap(([key, d]) =>
      LOCALES.map((l) => [l, findNormWord(d.text[l])] as const)
        .filter(([, hit]) => hit !== null)
        .map(([l, hit]) => `${key}.${l}: "${hit}"`)
    );
    assertEquals(hits, []);
  });

  Deno.test(`glossary - ${group}: R6 no digit`, () => {
    const hits = entries(group).flatMap(([key, d]) =>
      LOCALES.filter((l) => /\d/.test(d.text[l])).map((l) => `${key}.${l}`)
    );
    assertEquals(hits, []);
  });

  Deno.test(`glossary - ${group}: R7 no label of another measurement step`, () => {
    const problems = entries(group).flatMap(([key, d]) => [
      ...allowProblems(group, d).map((p) => `${key} allow: ${p}`),
      ...LOCALES.flatMap((l) =>
        crossLabelHits(group, l, d).map((hit) => `${key}.${l}: "${hit}"`)
      ),
    ]);
    assertEquals(problems, []);
  });

  if (group === "WORDS") {
    Deno.test("glossary - WORDS: R8 no vocabulary of the scales of steps 3–5", () => {
      const hits = entries(group).flatMap(([key, d]) =>
        LOCALES.map((l) => [l, findScaleWord(d.text[l])] as const)
          .filter(([, hit]) => hit !== null)
          .map(([l, hit]) => `${key}.${l}: "${hit}"`)
      );
      assertEquals(hits, []);
    });
  }

  // A scale has no dictionary label: the sheet's title is the step's question.
  if (!isScale) {
    Deno.test(`glossary - ${group}: R9 no text starts with its own label`, () => {
      const hits = entries(group).flatMap(([key, d, term]) =>
        term
          ? LOCALES.map((l) =>
            [l, startsWithLabel(d.text[l], term.label![l])] as const
          )
            .filter(([, hit]) => hit !== null)
            .map(([l, hit]) => `${key}.${l}: "${hit}"`)
          : []
      );
      assertEquals(hits, []);
    });
  }
}

Deno.test("glossary - all: R1 no description for a missing, spatial or retired key", () => {
  const problems = GROUPS.flatMap((g) =>
    orphanProblems(g, Object.keys(recordOf(g)))
  );
  assertEquals(problems, []);
});

Deno.test("glossary - all: glossaryPendingReview lists every draft as GROUP.key", () => {
  const want = GROUPS.flatMap((g) =>
    Object.entries(recordOf(g))
      .filter(([, d]) => d.review)
      .map(([key]) => `${g}.${key}`)
  );
  assertEquals(glossaryPendingReview().toSorted(), want.toSorted());
});

Deno.test("glossary - all: negative controls, each matcher catches a planted example", () => {
  // R5: norms in each language, whole words in en
  assertEquals(findNormWord("You should rest"), "should");
  assertEquals(findNormWord("Вам нужно отдохнуть"), "нужн");
  assertEquals(findNormWord("Треба відпочити"), "Треба");
  assertEquals(findNormWord("Most people notice it"), "Most people");
  assertEquals(findNormWord("the shoulders drop"), null);
  // R7: a zone in a quality, an urge in a word; whole words only
  assertEquals(
    findForeignLabels("QUALITIES", "en", "As if the chest is squeezed"),
    [
      "chest",
    ],
  );
  assertEquals(findForeignLabels("WORDS", "ru", "Хочется уйти отсюда"), [
    "уйти",
  ]);
  assertEquals(findForeignLabels("WORDS", "en", "A lightness, a lift"), []);
  // R7: a label of the group's own step is not foreign, nor what it contains
  assertEquals(
    findForeignLabels("WORDS", "en", "Compared with “tense waiting”"),
    [],
  );
  assertEquals(findForeignLabels("WORDS", "en", "A tense wait"), ["tense"]);
  assertEquals(findForeignLabels("WORDS", "en", "Not the same as nothing"), []);
  assertEquals(findForeignLabels("WORDS", "uk", "Радість чи легкість"), []);
  // R7: situation labels are never foreign
  assertEquals(
    findForeignLabels("SCALES", "en", "How charged the body is as a whole"),
    [],
  );
  // R8: scale vocabulary in a word
  assertEquals(findScaleWord("A strong pull away"), "strong");
  assertEquals(findScaleWord("Заряд будто на нуле"), "Заряд");
  // R9: a text that starts with its own label, also behind a quote
  assertEquals(
    startsWithLabel("Nothing noticeable right now.", "nothing"),
    "nothing",
  );
  assertEquals(startsWithLabel("«Тревога» без предмета", "тревога"), "тревога");
  assertEquals(startsWithLabel("Calmness of a lake", "calm"), null);
  // R3, R4, R6 use the shared matchers
  assert(findForbiddenWord("A feeling of dread") !== null);
  assert(findStopPhrase("It comes because of work") !== null);
  assert(/\d/.test("For 5 minutes"));
  // R1: orphans, spatial zones and second levels that don't exist
  assertEquals(orphanProblems("BODY_ZONES", ["chest", "nowhere"]).length, 1);
  assertEquals(
    orphanProblems("WORDS", ["fear.nope", "fear.anxiety"]).length,
    1,
  );
  assertEquals(orphanProblems("SCALES", ["mood_level"]).length, 1);
});

Deno.test("glossary - all: allow entries must name a foreign label in the text, with a reason", () => {
  const d = (en: string, allow: Description["allow"]): Description => ({
    text: { en, ru: "", uk: "" },
    allow,
  });
  // Valid: a foreign label, present, with a reason; R7 then passes
  const ok = d("Near the chest", [{
    locale: "en",
    label: "chest",
    reason: "r",
  }]);
  assertEquals(allowProblems("QUALITIES", ok), []);
  assertEquals(crossLabelHits("QUALITIES", "en", ok), []);
  // The group's own label is not foreign
  assertEquals(
    allowProblems(
      "QUALITIES",
      d("Heavy, as if", [{ locale: "en", label: "heavy", reason: "r" }]),
    ).length,
    1,
  );
  // Not in the text
  assertEquals(
    allowProblems(
      "QUALITIES",
      d("Squeezed", [{ locale: "en", label: "chest", reason: "r" }]),
    ).length,
    1,
  );
  // No reason
  assertEquals(
    allowProblems(
      "QUALITIES",
      d("The chest", [{ locale: "en", label: "chest", reason: " " }]),
    ).length,
    1,
  );
});
