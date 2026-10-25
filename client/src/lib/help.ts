// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The descriptions behind the check-in's help link and Settings → Words
 * (ui.md §6.5, §11.9): which steps have a link, what each
 * step's sheet lists and the glossary's sections in check-in order. Pure
 * functions, no Svelte: `t` is passed in, labels come from the dictionaries
 * (only what a check-in offers) and texts from `shared/glossary.ts`.
 */
import type { StepId } from "./machine.ts";
import type { MessageKey } from "../../../shared/i18n/keys.ts";
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
} from "../../../shared/dictionaries.ts";

/** The glossary module's type only: it is never imported statically. */
export type Glossary = typeof import("../../../shared/glossary.ts");
type Description = Glossary["SCALE_DESCRIPTIONS"][Scale];

type Scale = "intensity" | "valence" | "arousal" | "head_mode";

let loading: Promise<Glossary> | null = null;

/**
 * The descriptions, a lazy chunk fetched on first use (performance.md §1.1);
 * precached like every build file, so it opens offline. A failed load
 * is forgotten, so the next tap tries again.
 */
export function loadGlossary(): Promise<Glossary> {
  loading ??= import("../../../shared/glossary.ts").catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * Which steps have a help link, and its label (ui.md §6.5). None
 * on step 1: the figure defines the zones.
 */
export const HELP_OF: Partial<Record<StepId, "words" | "question">> = {
  qualities: "words",
  intensity: "question",
  valence: "question",
  arousal: "question",
  word: "words",
  urge: "words",
  head_mode: "question",
  context: "words",
};

/** One label and its description; `text` is empty while a draft is missing. */
export interface Term {
  key: string;
  label: string;
  text: string;
}

export interface TermGroup {
  heading: string | null;
  terms: Term[];
}

export type HelpContent =
  | { kind: "scale"; text: string }
  | { kind: "terms"; groups: TermGroup[] };

type Translate = (k: MessageKey) => string;

/** The plain title that names a scale (the sheet's title too). */
const SCALE_TITLE: Record<Scale, MessageKey> = {
  intensity: "checkin.step.3.title",
  valence: "checkin.step.4.title",
  arousal: "checkin.step.5.title",
  head_mode: "checkin.step.8.title",
};

function termsOf(
  items: DictItem[],
  texts: Record<string, Description>,
  locale: Locale,
  prefix = "",
): Term[] {
  return forInput(items).map((item) => ({
    key: prefix + item.key,
    label: item.label[locale],
    text: texts[prefix + item.key]?.text[locale] ?? "",
  }));
}

function wordL1(locale: Locale, g: Glossary): Term[] {
  return termsOf(WORDS, g.TERM_DESCRIPTIONS.WORDS, locale);
}

function wordL2(l1: string, locale: Locale, g: Glossary): Term[] {
  const word = forInput(WORDS).find((w) => w.key === l1);
  return word
    ? termsOf(word.l2, g.TERM_DESCRIPTIONS.WORDS, locale, `${l1}.`)
    : [];
}

function certainty(locale: Locale, g: Glossary): Term[] {
  return termsOf(WORD_CONFIDENCE, g.TERM_DESCRIPTIONS.WORD_CONFIDENCE, locale);
}

/**
 * What a step's sheet lists (ui.md §6.5): step 6 the level-1
 * words, the certainties, and only the chosen level-1 word's level-2 terms
 * (titration, methodology.md §2.12); a slider step its scale's text.
 * `null` for a step without a link.
 */
export function helpContent(
  step: StepId,
  word: string | null,
  locale: Locale,
  g: Glossary,
  t: Translate,
): HelpContent | null {
  const one = (terms: Term[]): HelpContent => ({
    kind: "terms",
    groups: [{ heading: null, terms }],
  });
  switch (step) {
    case "locations":
      return null;
    case "qualities":
      return one(termsOf(QUALITIES, g.TERM_DESCRIPTIONS.QUALITIES, locale));
    case "intensity":
    case "valence":
    case "arousal":
    case "head_mode":
      return { kind: "scale", text: g.SCALE_DESCRIPTIONS[step].text[locale] };
    case "word": {
      const groups: TermGroup[] = [
        { heading: null, terms: wordL1(locale, g) },
        {
          heading: t("checkin.step.6.confidence.title"),
          terms: certainty(locale, g),
        },
      ];
      const l1 = word?.split(".")[0] ?? null;
      const l2 = l1 && l1 !== "unknown" ? wordL2(l1, locale, g) : [];
      if (l2.length > 0) {
        groups.push({ heading: t("checkin.step.6.l2.title"), terms: l2 });
      }
      return { kind: "terms", groups };
    }
    case "urge":
      return one(termsOf(URGES, g.TERM_DESCRIPTIONS.URGES, locale));
    case "context":
      return one(
        termsOf(CONTEXT_TAGS, g.TERM_DESCRIPTIONS.CONTEXT_TAGS, locale),
      );
  }
}

export type GlossarySection =
  | { id: string; heading: string; kind: "terms"; terms: Term[] }
  | { id: string; heading: string; kind: "scale"; term: Term }
  | {
    id: "word";
    heading: string;
    kind: "words";
    words: { l1: Term; l2: Term[] }[];
    certaintyHeading: string;
    certainty: Term[];
  };

/**
 * Settings → Words (ui.md §11.9): every description in
 * check-in order, headed by the step eyebrows. A scale is named by its
 * step's plain title; under WORD each level-1 word carries its level-2
 * terms, then the certainties.
 */
export function glossarySections(
  locale: Locale,
  g: Glossary,
  t: Translate,
): GlossarySection[] {
  const eyebrow = (n: number) => t(`checkin.eyebrow.${n}` as MessageKey);
  const scale = (id: Scale, n: number): GlossarySection => ({
    id,
    heading: eyebrow(n),
    kind: "scale",
    term: {
      key: id,
      label: t(SCALE_TITLE[id]),
      text: g.SCALE_DESCRIPTIONS[id].text[locale],
    },
  });
  const zones = BODY_ZONES.filter((z) =>
    z.key === "whole_body" || z.key === "nowhere"
  );
  return [
    {
      id: "locations",
      heading: eyebrow(1),
      kind: "terms",
      terms: termsOf(zones, g.TERM_DESCRIPTIONS.BODY_ZONES, locale),
    },
    {
      id: "qualities",
      heading: eyebrow(2),
      kind: "terms",
      terms: termsOf(QUALITIES, g.TERM_DESCRIPTIONS.QUALITIES, locale),
    },
    scale("intensity", 3),
    scale("valence", 4),
    scale("arousal", 5),
    {
      id: "word",
      heading: eyebrow(6),
      kind: "words",
      words: wordL1(locale, g).map((l1) => ({
        l1,
        l2: wordL2(l1.key, locale, g),
      })),
      certaintyHeading: t("checkin.step.6.confidence.title"),
      certainty: certainty(locale, g),
    },
    {
      id: "urge",
      heading: eyebrow(7),
      kind: "terms",
      terms: termsOf(URGES, g.TERM_DESCRIPTIONS.URGES, locale),
    },
    scale("head_mode", 8),
    {
      id: "context",
      heading: eyebrow(9),
      kind: "terms",
      terms: termsOf(CONTEXT_TAGS, g.TERM_DESCRIPTIONS.CONTEXT_TAGS, locale),
    },
  ];
}
