// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The words of an open History record (ui.md §15.7–§15.8): every
 * answer in the order it was recorded, null answers as plain words, sliders
 * as a position and the instrument's word scale — never a number. A chunk of
 * its own, fetched once the list is on screen.
 */

import {
  ANSWER_STEPS,
  type AnswerStep,
  type EntryV2,
  type SliderField,
} from "../../../shared/entry.ts";
import { type Locale, URGES, WORDS } from "../../../shared/dictionaries.ts";
import type { MessageKey } from "../../../shared/i18n/keys.ts";
import {
  deviceOffset,
  type HistoryItem,
  labelOf,
  likeText,
  type OffsetAt,
  situationText,
  type Translate,
  tzLabel,
  whereText,
} from "./history.ts";

/** The word: `l1` muted before `l2`, then the certainty after a dash. */
export function wordParts(
  entry: EntryV2,
  locale: Locale,
  t: Translate,
): { l1: string | null; text: string } {
  const word = entry.affect?.word ?? null;
  if (word === null) return { l1: null, text: t("history.item.notChosen") };
  const [k1, k2] = word.split(".");
  const top = WORDS.find((w) => w.key === k1);
  const l1 = top?.label[locale] ?? k1;
  if (k1 === "unknown") return { l1: null, text: l1 };
  const confidence = entry.affect?.word_confidence;
  const certainty = confidence
    ? t(`checkin.step.6.confidence.${confidence}` as MessageKey)
    : null;
  const shown = k2 ? labelOf(top?.l2 ?? [], k2, locale) : l1;
  return {
    l1: k2 ? l1 : null,
    text: certainty
      ? t("history.item.word", { word: shown, certainty })
      : shown,
  };
}

export function wordText(entry: EntryV2, locale: Locale, t: Translate): string {
  const { l1, text } = wordParts(entry, locale, t);
  return l1 ? `${l1} · ${text}` : text;
}

/** A read-only slider (ui.md §15.7, 8): a position and words, no number. */
export interface TrackField {
  kind: "track";
  label: string;
  /** 0 … 1 along the track */
  at: number;
  bipolar: boolean;
  untouched: boolean;
  low: string;
  high: string;
  center?: string;
  /** `a11y.history.track`: "INTENSITY: closer to “very strong”" */
  aria: string;
}

export type RecordField =
  | { kind: "text"; label: string; text: string; locations?: string[] }
  | { kind: "word"; label: string; l1: string | null; text: string }
  | TrackField;

const SLIDERS: Array<{
  field: SliderField;
  step: number;
  min: number;
  max: number;
  value: (e: EntryV2) => number;
}> = [
  {
    field: "intensity",
    step: 3,
    min: 0,
    max: 10,
    value: (e) => e.body!.intensity!,
  },
  {
    field: "valence",
    step: 4,
    min: -3,
    max: 3,
    value: (e) => e.affect!.valence!,
  },
  {
    field: "arousal",
    step: 5,
    min: 0,
    max: 10,
    value: (e) => e.affect!.arousal!,
  },
  { field: "head_mode", step: 8, min: 0, max: 10, value: (e) => e.head_mode! },
];

function track(entry: EntryV2, n: number, t: Translate): TrackField {
  const s = SLIDERS[n];
  const at = (s.value(entry) - s.min) / (s.max - s.min);
  const bipolar = s.field === "valence";
  const untouched = entry.untouched?.includes(s.field) ?? false;
  const low = t(`checkin.step.${s.step}.pole.low` as MessageKey);
  const high = t(`checkin.step.${s.step}.pole.high` as MessageKey);
  // The instrument's own word scale (Slider.svelte), never a number
  const words = at < 0.35
    ? t("a11y.slider.low", { pole: low })
    : at > 0.65
    ? t("a11y.slider.high", { pole: high })
    : bipolar
    ? t("a11y.valence.neutral")
    : t("a11y.slider.mid");
  const label = t(`checkin.eyebrow.${s.step}` as MessageKey);
  return {
    kind: "track",
    label,
    at,
    bipolar,
    untouched,
    low,
    high,
    center: bipolar ? t("checkin.step.4.pole.center") : undefined,
    aria: t("a11y.history.track", {
      label,
      value: untouched ? t("a11y.slider.untouched", { text: words }) : words,
    }),
  };
}

/**
 * The expanded record (ui.md §15.7), in the order it was recorded. A skipped or
 * abandoned record shows the answers it kept — the steps before `stopped_at`
 * (ui.md §15.8) — under its own label, and nothing for the steps not reached; one
 * skipped on step 1 has no fields. The metadata line is `metaText`.
 */
export function recordFields(
  entry: EntryV2,
  locale: Locale,
  t: Translate,
): RecordField[] {
  const body = entry.body;
  if (!body) return [];
  const stop = entry.skipped
    ? ANSWER_STEPS.indexOf(entry.stopped_at ?? "locations")
    : ANSWER_STEPS.length;
  const reached = (s: AnswerStep) => ANSWER_STEPS.indexOf(s) < stop;
  const eyebrow = (n: number) => t(`checkin.eyebrow.${n}` as MessageKey);
  const fields: RecordField[] = [
    {
      kind: "text",
      label: eyebrow(1),
      text: whereText(body.locations, locale),
      locations: body.locations,
    },
  ];
  if (reached("qualities") && body.qualities) {
    fields.push({
      kind: "text",
      label: eyebrow(2),
      text: likeText(body.qualities, locale),
    });
  }
  for (
    const [n, s] of [[0, "intensity"], [1, "valence"], [2, "arousal"]] as const
  ) {
    if (reached(s)) fields.push(track(entry, n, t));
  }
  if (reached("word")) {
    fields.push({
      kind: "word",
      label: eyebrow(6),
      ...wordParts(entry, locale, t),
    });
  }
  if (reached("urge")) {
    fields.push({
      kind: "text",
      label: eyebrow(7),
      text: entry.urge === null
        ? t("history.item.notChosen")
        : labelOf(URGES, entry.urge, locale),
    });
  }
  if (reached("head_mode")) fields.push(track(entry, 3, t));
  if (reached("context")) {
    fields.push({
      kind: "text",
      label: eyebrow(9),
      text: situationText(entry, locale, t, true) ?? "",
    });
  }
  // An empty note is the absence of text, not an answer (ui.md §15.7)
  if (reached("note") && entry.note) {
    fields.push({ kind: "text", label: eyebrow(10), text: entry.note });
  }
  return fields;
}

/** "From a reminder · UTC+3 · Not synced yet" */
export function metaText(
  item: HistoryItem,
  t: Translate,
  offsetAt: OffsetAt = deviceOffset,
): string {
  const trigger = item.entry.trigger;
  return [
    t(
      trigger === "random"
        ? "history.item.trigger.random"
        : trigger === "manual"
        ? "history.item.trigger.manual"
        : "history.item.trigger.afterEvent",
    ),
    tzLabel(item.entry, t, offsetAt),
    item.unsynced ? t("history.item.unsynced") : null,
  ].filter(Boolean).join(" · ");
}
