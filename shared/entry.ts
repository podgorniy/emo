// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Entry definitions, validators, canonical JSON serialization, and padding.
 * Specification: architecture.md §6, data.md §3, ui.md §8.
 */

import {
  BODY_ZONES,
  CONTEXT_TAGS,
  QUALITIES,
  SCHEMA_V,
  URGES,
  WORD_CONFIDENCE,
  WORDS,
} from "./dictionaries.ts";
import { PADDING_BLOCK_SIZE } from "./crypto/constants.ts";
import {
  FIGURE_VARIANTS,
  INTENSITY_VARIANTS,
  OPTION_VARIANTS,
  type ThemeVariants,
} from "./theme/schema.ts";
import { STOP_PHRASES } from "./i18n/note-stopwords.ts";

export { STOP_PHRASES };

export type TriggerType = "random" | "manual" | "after_event";

/**
 * The answer groups in the order the form records them (data.md §4).
 * `stopped_at` names one of them: keys, not screen numbers, so a
 * change of layout (two groups on one screen) never changes their meaning.
 */
export const ANSWER_STEPS = [
  "locations",
  "qualities",
  "intensity",
  "valence",
  "arousal",
  "word",
  "urge",
  "head_mode",
  "context",
  "note",
] as const;
export type AnswerStep = typeof ANSWER_STEPS[number];

/**
 * The wording of the instrument — questions, poles, option labels — the
 * answers were given with, so analyses compare like with like
 * (methodology.md §5.4, data.md §3.6 `ui`):
 * 1 — before 2026-10-09 (an entry without `ui.copy` counts as 1);
 * 2 — the smoothing pass of 2026-10-09 (ui.md v1.6): neutral
 *     arousal poles, "Overall:" on valence, attention anchored to opening
 *     Emo, the certainty "can't say", the richer vocabulary and relabels;
 * 3 — 2026-10-09 (ui.md v1.7): a description of every term and
 *     scale, one tap away on steps 2–9 and in Settings → Words
 *     (`shared/glossary.ts`, drafts pending review); no wording, pole, label
 *     or screen changed;
 * 4 — 2026-10-10: a slider screen's Next waits for a touch (a press where
 *     the thumb is answers the midpoint), and the null hint on step 3 asks
 *     for that press instead of "leave it as it is";
 * 5 — 2026-10-10 (ui.md v1.9): on a phone the screens move under
 *     the thumb — a slider or the urges low on the screen with their
 *     question, step 1's Whole body / Nowhere in the footer and its Front/Back
 *     switch under the figure, the help links at the right edge, Close and
 *     Stop here over Next; no wording changed;
 * 6 — 2026-10-11: a slider answers only to a slide along its track, a still
 *     tap or a key — a still tap within reach of the thumb answers where it
 *     is, one elsewhere on the track sets the value there — so a scroll or
 *     pull that starts on a slider answers nothing. In copy 4–5 such a
 *     scroll or pull could record the midpoint of an untouched slider: there
 *     `untouched` is a lower bound. From copy 6 every entry has `ui` (one
 *     skipped on step 1 too), with `ui.layout` when the layout is known.
 * Bump it with any change of instrument wording, screen composition or
 * description meaning.
 */
export const COPY_VERSION = 6;

/**
 * How the form was laid out while it was answered (data.md §3.6
 * `ui.layout`): `phone` under 900 px wide, `short` a phone under 500 px high
 * (held sideways), `wide` 900 px and over; `mixed` when it changed while the
 * check-in was open. Missing on entries written before copy 6: unknown.
 */
export const UI_LAYOUTS = ["phone", "wide", "short", "mixed"] as const;
export type UiLayout = typeof UI_LAYOUTS[number];

/** Which controls recorded the answers (data.md §3.6) */
export interface EntryUI {
  theme: string;
  intensity: ThemeVariants["intensity"];
  options: ThemeVariants["options"];
  figure: ThemeVariants["figure"];
  /** `COPY_VERSION` at the time; missing on older entries = 1 */
  copy?: number;
  /** The form's layout (`UI_LAYOUTS`); missing = unknown */
  layout?: UiLayout;
}

/**
 * On a saved entry every field is set. On a skipped entry that kept answers
 * (`stopped_at`), a field whose step was not reached is `null`.
 */
export interface EntryBody {
  locations: string[];
  qualities: string[] | null;
  intensity: number | null; // 0..10
}

export interface EntryAffect {
  valence: number | null; // -3..+3
  arousal: number | null; // 0..10
  word: string | null; // e.g. "fear" or "fear.anxiety"
  word_confidence: WordConfidence | null;
}

export interface EntryV2 {
  schema_v: 2;
  id: string; // UUID v4
  ts: string; // ISO 8601 UTC, at save
  tz_offset_min: number; // -new Date().getTimezoneOffset() at save
  trigger: TriggerType;
  reminder_id: string | null; // set only when trigger = "random"
  latency_sec: number;
  hidden_sec: number;
  skipped: boolean;
  abandoned: boolean;
  /**
   * Skipped entries: the step on screen when the check-in ended unsaved
   * ("Skip check-in", "Stop here", or the last interaction before the
   * abandon rule). The answers of the steps before it are kept; that step and
   * every later one are `null`. `null` on a saved entry. Missing on entries
   * written before it existed: read as `null` (then a skipped entry kept
   * nothing). data.md §3.6.
   */
  stopped_at?: AnswerStep | null;
  untouched: SliderField[] | null;
  ui: EntryUI | null;
  body: EntryBody | null;
  affect: EntryAffect | null;
  urge: string | null;
  head_mode: number | null; // 0..10
  context_tag: string | null;
  context_other: string | null;
  note: string | null;
}

export type SliderField = "intensity" | "valence" | "arousal" | "head_mode";
export type WordConfidence = "guess" | "sure" | "unknown";

/** Answers as the form holds them; `toEntry` turns them into an entry. */
export interface DraftAnswers {
  locations: string[];
  qualities: string[];
  intensity: number;
  valence: number;
  arousal: number;
  word: string | null; // "fear" or "fear.anxiety"
  word_confidence: WordConfidence | null;
  urge: string | null;
  head_mode: number;
  context_tag: string | null;
  context_other: string; // kept while "other" is deselected; saved only with it
  note: string;
}

/**
 * The check-in in progress — what the encrypted draft holds (ui.md §6.2). Times
 * are wall-clock milliseconds (`Date.now()`), so they survive a
 * reload.
 */
export interface DraftV2 {
  schema_v: 2;
  step: number; // 0-based index into the 9 screens (10 before 2026-10-09)
  trigger: TriggerType;
  reminder_id: string | null;
  started_at: number; // step 1 first shown
  last_interaction_at: number;
  hidden_ms: number; // background time already accumulated
  hidden_since: number | null; // set while the app is hidden
  touched: SliderField[]; // sliders that received at least one input
  answers: DraftAnswers;
  /**
   * Set by Close: the person left on purpose, so a later app start does not
   * reopen the form; opening it again clears it (ui.md §6.2).
   * Absent = false.
   */
  closed_by_user?: boolean;
  /**
   * The controls the form is answered with, for the entry's `ui`: set when
   * the form opens, keeping the copy it started with, its layouts merged
   * (`machine.mergeUi`). Missing on drafts from before `ui` existed.
   */
  ui?: EntryUI;
}

// -------------------------------------------------------------
// Note stop-phrases validator (rejects "why" rationalizations)
// -------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STOP_PHRASE_REGEX = new RegExp(
  "(?<![\\p{L}'’])(" + STOP_PHRASES.map(escapeRegex).join("|") +
    ")(?![\\p{L}'’])",
  "iu",
);

/**
 * The first stop-phrase in a note, as the person typed it, and where it
 * starts (UTF-16 index), for the message that quotes it and for "Remove …",
 * which cuts the note there (ui.md §8). `’` counts as `'`.
 */
export function findStopPhrase(
  note: string,
): { phrase: string; start: number } | null {
  const m = STOP_PHRASE_REGEX.exec(note.replaceAll("’", "'"));
  return m
    ? { phrase: note.slice(m.index, m.index + m[0].length), start: m.index }
    : null;
}

/**
 * The note as the form checks it while it is typed: ≤ 160 code points and no
 * stop-phrase. The stop-list is a rule of input, not of the stored schema:
 * `validateEntryV2` checks only the length, so changing the list never makes
 * an entry already saved invalid.
 */
export function validateNote(note: string | null | undefined): {
  valid: boolean;
  codePoints: number;
  error?: "too_long" | "stop_phrase_detected";
} {
  if (!note || note.trim() === "") {
    return { valid: true, codePoints: 0 };
  }

  const codePoints = Array.from(note).length;
  if (codePoints > 160) {
    return { valid: false, codePoints, error: "too_long" };
  }

  if (findStopPhrase(note)) {
    return { valid: false, codePoints, error: "stop_phrase_detected" };
  }

  return { valid: true, codePoints };
}

// -------------------------------------------------------------
// Canonical JSON Serializer
// -------------------------------------------------------------

/**
 * Serializes an object to deterministic canonical JSON with sorted keys
 * (architecture.md §5.5). Only JSON values are accepted: `undefined`, functions,
 * symbols and non-finite numbers throw, because the output is encrypted and
 * must parse back to exactly what was saved.
 */
export function canonicalizeJson(value: unknown): string {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonical JSON: ${value} is not a JSON number`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`canonical JSON: ${typeof value} is not a JSON value`);
  }

  if (Array.isArray(value)) {
    const elements = value.map((el) => canonicalizeJson(el));
    return `[${elements.join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => {
    const val = canonicalizeJson(obj[key]);
    return `${JSON.stringify(key)}:${val}`;
  });

  return `{${pairs.join(",")}}`;
}

// -------------------------------------------------------------
// Plaintext padding (fixed 2048-byte multiple)
// -------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Pads canonical JSON with trailing ASCII space characters (0x20)
 * to a multiple of 2048 bytes (PADDING_BLOCK_SIZE).
 */
export function padEntryPlaintext(canonicalJson: string): Uint8Array {
  const bytes = textEncoder.encode(canonicalJson);
  const remainder = bytes.length % PADDING_BLOCK_SIZE;
  const paddingNeeded = remainder === 0 ? 0 : PADDING_BLOCK_SIZE - remainder;

  const padded = new Uint8Array(bytes.length + paddingNeeded);
  padded.set(bytes, 0);
  padded.fill(0x20, bytes.length); // Fill with ASCII space (0x20)

  return padded;
}

/**
 * Removes trailing ASCII spaces and parses canonical JSON.
 */
export function unpadEntryPlaintext(padded: Uint8Array): string {
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0x20) {
    end--;
  }
  return textDecoder.decode(padded.subarray(0, end));
}

// -------------------------------------------------------------
// Entry Validator
// -------------------------------------------------------------

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** UTC−12:00 … UTC+14:00 are the real extremes; ±14 h keeps the check simple. */
const MAX_TZ_OFFSET_MIN = 14 * 60;

/** A month: a draft can be resumed later, but not by more than that. */
const MAX_LATENCY_SEC = 30 * 86_400;
const TS_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const SLIDERS: SliderField[] = ["intensity", "valence", "arousal", "head_mode"];
const EXCLUSIVE_LOCATIONS = ["whole_body", "nowhere"];
const EXCLUSIVE_QUALITIES = ["nothing", "cant_tell"];

const keysOf = (items: Array<{ key: string }>) =>
  new Set(items.map((i) => i.key));
const ZONE_KEYS = keysOf(BODY_ZONES);
const QUALITY_KEYS = keysOf(QUALITIES);
const URGE_KEYS = keysOf(URGES);
const CONTEXT_KEYS = keysOf(CONTEXT_TAGS);
const CONFIDENCE_KEYS = keysOf(WORD_CONFIDENCE);

/** `fear` or `fear.anxiety`; retired keys stay valid so old entries read. */
function isWordKey(word: string): boolean {
  const [l1, l2, rest] = word.split(".");
  const top = WORDS.find((w) => w.key === l1);
  if (!top || rest !== undefined) return false;
  return l2 === undefined || top.l2.some((w) => w.key === l2);
}

const isInt = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

const codePoints = (s: string) => Array.from(s).length;

/** The newest `schema_v` this build can read (data.md §8.1). */
export const KNOWN_MAX_SCHEMA_V = 2;

/**
 * The reader table (data.md §8.1): how an older `schema_v` becomes the
 * current in-memory shape; the stored blob is never rewritten. Empty today:
 * v2 is the first released version, and the first row comes with v3.
 */
const READERS: Record<
  number,
  (older: Record<string, unknown>) => Record<string, unknown>
> = {};

/** What a decrypted entry turned out to be. */
export type ReadEntry =
  | { kind: "ok"; entry: EntryV2 }
  /** Written by a newer app: kept encrypted, never shown or exported. */
  | { kind: "newer"; schema_v: number }
  /** Readable but not a valid entry (reliability.md §1.2). */
  | { kind: "invalid"; value: unknown; errors: string[] };

/**
 * A decrypted entry through the reader table and the validator. Never
 * throws: whatever it is, the caller keeps the ciphertext and flags it.
 */
export function readEntry(value: unknown): ReadEntry {
  const v = value as Record<string, unknown> | null;
  const schemaV = typeof v === "object" && v !== null ? v.schema_v : undefined;
  if (typeof schemaV === "number" && schemaV > KNOWN_MAX_SCHEMA_V) {
    return { kind: "newer", schema_v: schemaV };
  }
  const reader = typeof schemaV === "number" ? READERS[schemaV] : undefined;
  const current = reader && v ? reader(v) : value;
  const check = validateEntryV2(current);
  return check.valid
    ? { kind: "ok", entry: current as EntryV2 }
    : { kind: "invalid", value: current, errors: check.errors };
}

/**
 * The full schema of an entry (data.md §2, §3): field
 * types, dictionary membership, the skipped/abandoned shape and the links
 * between fields. Runs before save and after decrypting a pulled entry.
 */
export function validateEntryV2(
  entry: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { valid: false, errors: ["Entry must be an object"] };
  }
  const e = entry as Record<string, unknown>;
  const fail = (msg: string) => errors.push(msg);

  if (e.schema_v !== SCHEMA_V) {
    fail(`Invalid schema_v: expected ${SCHEMA_V}, got ${e.schema_v}`);
  }
  if (typeof e.id !== "string" || !UUID_V4_REGEX.test(e.id)) {
    fail("Invalid id: must be UUID v4");
  }
  if (
    typeof e.ts !== "string" || !TS_REGEX.test(e.ts) || isNaN(Date.parse(e.ts))
  ) {
    fail("Invalid ts: must be ISO 8601 UTC with Z");
  }
  if (!isInt(e.tz_offset_min, -MAX_TZ_OFFSET_MIN, MAX_TZ_OFFSET_MIN)) {
    fail("Invalid tz_offset_min: must be an integer within ±14 h");
  }
  if (!["random", "manual", "after_event"].includes(e.trigger as string)) {
    fail(`Invalid trigger: ${e.trigger}`);
  }
  if (e.reminder_id === undefined) {
    fail("reminder_id is required (null when not a reminder)");
  } else if (e.reminder_id !== null) {
    if (e.trigger !== "random") {
      fail("reminder_id is only allowed when trigger is 'random'");
    } else if (
      typeof e.reminder_id !== "string" || !UUID_REGEX.test(e.reminder_id)
    ) {
      fail("Invalid reminder_id: must be a UUID");
    }
  }

  if (!isInt(e.latency_sec, 0, MAX_LATENCY_SEC)) {
    fail("latency_sec must be a whole number of seconds, 0 to 30 days");
  }
  if (!isInt(e.hidden_sec, 0, MAX_LATENCY_SEC)) {
    fail("hidden_sec must be a whole number of seconds, 0 to 30 days");
  } else if (
    Number.isInteger(e.latency_sec) &&
    (e.hidden_sec as number) > (e.latency_sec as number)
  ) {
    fail("hidden_sec cannot exceed latency_sec");
  }

  if (typeof e.skipped !== "boolean") fail("skipped must be a boolean");
  if (typeof e.abandoned !== "boolean") fail("abandoned must be a boolean");
  if (e.abandoned === true && e.skipped !== true) {
    fail("An abandoned entry is always skipped");
  }

  // stopped_at (data.md §3.6): missing on older entries = null
  const stoppedAt = e.stopped_at ?? null;
  if (
    stoppedAt !== null &&
    !(ANSWER_STEPS as readonly unknown[]).includes(stoppedAt)
  ) {
    fail(`Invalid stopped_at: ${stoppedAt}`);
  }
  if (stoppedAt !== null && e.skipped !== true) {
    fail("stopped_at is set only on a skipped entry");
  }
  /** Steps before this index hold answers; the rest are null */
  const stop = e.skipped !== true
    ? ANSWER_STEPS.length
    : stoppedAt === null
    ? 0
    : Math.max(0, ANSWER_STEPS.indexOf(stoppedAt as AnswerStep));
  const reached = (step: AnswerStep) => ANSWER_STEPS.indexOf(step) < stop;
  const notReached = (step: AnswerStep, field: string, value: unknown) => {
    if (!reached(step) && value !== null) {
      fail(`${field} = null: its step comes after stopped_at`);
      return true;
    }
    return !reached(step);
  };

  // ui: on every entry since copy 6, one skipped on step 1 too; null on
  // older ones. Keys this build does not know are left alone, so a newer
  // app may add some.
  if (e.ui === undefined) {
    fail("ui is required");
  } else if (e.ui !== null) {
    const ui = e.ui as Record<string, unknown>;
    if (
      typeof ui !== "object" || typeof ui.theme !== "string" ||
      !/^[0-9a-f]{16}$/.test(ui.theme)
    ) {
      fail("ui.theme must be 16 hex characters");
    }
    const known = [
      ["intensity", INTENSITY_VARIANTS],
      ["options", OPTION_VARIANTS],
      ["figure", FIGURE_VARIANTS],
    ] as const;
    for (const [field, variants] of known) {
      if (!(variants as readonly unknown[]).includes(ui[field])) {
        fail(`Invalid ui.${field}: ${ui[field]}`);
      }
    }
    if (ui.copy !== undefined && !isInt(ui.copy, 1, 1000)) {
      fail("ui.copy must be a whole number from 1");
    }
    if (
      ui.layout !== undefined &&
      !(UI_LAYOUTS as readonly unknown[]).includes(ui.layout)
    ) {
      fail(`Invalid ui.layout: ${ui.layout}`);
    }
  }

  const answerFields = [
    "untouched",
    "body",
    "affect",
    "urge",
    "head_mode",
    "context_tag",
    "context_other",
    "note",
  ];
  // Skipped on step 1 (or before stopped_at existed): no answers at all
  if (stop === 0) {
    for (const f of answerFields) {
      if (e[f] !== null) fail(`A skipped entry has ${f} = null`);
    }
    return { valid: errors.length === 0, errors };
  }
  for (const f of answerFields) {
    if (e[f] === undefined) fail(`${f} is required`);
  }

  // untouched: a subset of the slider fields reached, each at most once
  if (!Array.isArray(e.untouched)) {
    fail("untouched must be an array");
  } else if (
    e.untouched.some((f) => !SLIDERS.includes(f) || !reached(f)) ||
    new Set(e.untouched).size !== e.untouched.length
  ) {
    fail(
      "untouched holds only intensity, valence, arousal, head_mode (reached), once each",
    );
  }

  const body = e.body as Partial<EntryBody> | null | undefined;
  if (!body || typeof body !== "object") {
    fail("A saved entry has body");
  } else {
    const { locations, qualities } = body;
    if (!Array.isArray(locations) || locations.length === 0) {
      fail("locations must be a non-empty array");
    } else {
      if (locations.some((k) => !ZONE_KEYS.has(k))) {
        fail("locations holds an unknown zone");
      }
      if (new Set(locations).size !== locations.length) {
        fail("locations repeats a zone");
      }
      if (
        locations.length > 1 &&
        locations.some((k) => EXCLUSIVE_LOCATIONS.includes(k))
      ) {
        fail(
          "'whole_body' and 'nowhere' cannot be combined with other locations",
        );
      }
    }
    if (notReached("qualities", "qualities", qualities)) {
      // a skipped entry that stopped before step 2
    } else if (!Array.isArray(qualities) || qualities.length === 0) {
      fail("qualities must be a non-empty array");
    } else {
      if (qualities.some((k) => !QUALITY_KEYS.has(k))) {
        fail("qualities holds an unknown quality");
      }
      if (new Set(qualities).size !== qualities.length) {
        fail("qualities repeats a quality");
      }
      if (
        qualities.length > 1 &&
        qualities.some((k) => EXCLUSIVE_QUALITIES.includes(k))
      ) {
        fail(
          "'nothing' and 'cant_tell' cannot be combined with other qualities",
        );
      }
    }
    if (
      !notReached("intensity", "intensity", body.intensity) &&
      !isInt(body.intensity, 0, 10)
    ) {
      fail("intensity must be an integer 0 to 10");
    }
  }

  const affect = e.affect as Partial<EntryAffect> | null | undefined;
  if (notReached("valence", "affect", affect ?? null)) {
    // stopped before step 4: no affect at all
  } else if (!affect || typeof affect !== "object") {
    fail("A saved entry has affect");
  } else {
    if (!isInt(affect.valence, -3, 3)) {
      fail("valence must be an integer -3 to +3");
    }
    if (
      !notReached("arousal", "arousal", affect.arousal) &&
      !isInt(affect.arousal, 0, 10)
    ) {
      fail("arousal must be an integer 0 to 10");
    }
    const { word, word_confidence: confidence } = affect;
    if (notReached("word", "word", word)) {
      notReached("word", "word_confidence", confidence);
    } else if (word === null) {
      if (confidence !== null) fail("word_confidence is set only with a word");
    } else if (typeof word !== "string" || !isWordKey(word)) {
      fail(`Invalid word: ${word}`);
    } else if (
      typeof confidence !== "string" || !CONFIDENCE_KEYS.has(confidence)
    ) {
      fail("A word needs word_confidence (guess, sure or unknown)");
    } else if (word === "unknown" && confidence !== "unknown") {
      fail("The word 'unknown' has word_confidence 'unknown'");
    }
  }

  if (
    !notReached("urge", "urge", e.urge) && e.urge !== null &&
    !URGE_KEYS.has(e.urge as string)
  ) {
    fail(`Invalid urge: ${e.urge}`);
  }
  if (
    !notReached("head_mode", "head_mode", e.head_mode) &&
    !isInt(e.head_mode, 0, 10)
  ) {
    fail("head_mode must be an integer 0 to 10");
  }

  if (notReached("context", "context_tag", e.context_tag)) {
    notReached("context", "context_other", e.context_other);
  } else if (
    typeof e.context_tag !== "string" || !CONTEXT_KEYS.has(e.context_tag)
  ) {
    fail(`Invalid context_tag: ${e.context_tag}`);
  }
  if (e.context_other !== null && reached("context")) {
    if (e.context_tag !== "other") {
      fail("context_other only allowed when context_tag is 'other'");
    } else if (
      typeof e.context_other !== "string" || e.context_other.trim() === "" ||
      codePoints(e.context_other) > 40
    ) {
      fail("context_other must be 1 to 40 code points");
    }
  }

  if (e.note !== null && !notReached("note", "note", e.note)) {
    if (typeof e.note !== "string" || e.note.trim() === "") {
      fail("note must be null or non-empty text");
    } else if (codePoints(e.note) > 160) {
      // Length only: the stop-list is checked while typing (validateNote)
      fail("note validation failed: too_long");
    }
  }

  return { valid: errors.length === 0, errors };
}
