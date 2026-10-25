// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The check-in form as a pure state machine: no Svelte, no I/O, `now` passed
 * in. Every function returns a new draft. Specification: ui.md §6.2,
 * ui.md §6–§7, data.md §3, §4.
 */

import type {
  AnswerStep,
  DraftAnswers,
  DraftV2,
  EntryUI,
  EntryV2,
  SliderField,
  TriggerType,
  UiLayout,
  WordConfidence,
} from "../../../shared/entry.ts";
import { ANSWER_STEPS, validateNote } from "../../../shared/entry.ts";

/**
 * The screens, strictly in this order (data.md §4), each named
 * by the first answer group it holds (`ANSWER_STEPS`). Nine since
 * 2026-10-09: the note sits under the situation, on the last screen
 * (ui.md §6.12).
 */
export const STEPS = [
  "locations",
  "qualities",
  "intensity",
  "valence",
  "arousal",
  "word",
  "urge",
  "head_mode",
  "context",
] as const satisfies readonly AnswerStep[];
export type StepId = typeof STEPS[number];

/** The screen that holds an answer group. */
export function screenOf(step: AnswerStep): number {
  const at = ANSWER_STEPS.indexOf(step);
  let screen = 0;
  STEPS.forEach((s, i) => {
    if (ANSWER_STEPS.indexOf(s) <= at) screen = i;
  });
  return screen;
}
export const LAST_STEP = STEPS.length - 1;

/** Canonical order of `untouched`. */
export const SLIDER_FIELDS: SliderField[] = [
  "intensity",
  "valence",
  "arousal",
  "head_mode",
];
/**
 * Where a slider starts. Next waits for a touch (owner decision 2026-10-10);
 * one left untouched before then (a resumed draft, an entry reopened by Undo)
 * is saved here (D6).
 */
export const MIDPOINT: Record<SliderField, number> = {
  intensity: 5,
  valence: 0,
  arousal: 5,
  head_mode: 5,
};
export const SLIDER_RANGE: Record<SliderField, [number, number]> = {
  intensity: [0, 10],
  valence: [-3, 3],
  arousal: [0, 10],
  head_mode: [0, 10],
};

/** A draft untouched this long is finalized as abandoned (ui.md §6.2). */
export const ABANDON_AFTER_MS = 10 * 60 * 1000;
export const CONTEXT_OTHER_MAX = 40;
export const NOTE_MAX = 160;

const EXCLUSIVE_LOCATIONS = ["whole_body", "nowhere"];
const EXCLUSIVE_QUALITIES = ["nothing", "cant_tell"];

/** Truncates to N code points (not UTF-16 units: `maxlength` is wrong for this). */
export function cut(text: string, maxCodePoints: number): string {
  const cps = Array.from(text);
  return cps.length > maxCodePoints
    ? cps.slice(0, maxCodePoints).join("")
    : text;
}

/** Step 1 first shown. */
export function newDraft(
  trigger: TriggerType,
  reminderId: string | null,
  now: number,
): DraftV2 {
  return {
    schema_v: 2,
    step: 0,
    trigger,
    reminder_id: trigger === "random" ? reminderId : null,
    started_at: now,
    last_interaction_at: now,
    hidden_ms: 0,
    hidden_since: null,
    touched: [],
    answers: {
      locations: [],
      qualities: [],
      intensity: MIDPOINT.intensity,
      valence: MIDPOINT.valence,
      arousal: MIDPOINT.arousal,
      word: null,
      word_confidence: null,
      urge: null,
      head_mode: MIDPOINT.head_mode,
      context_tag: null,
      context_other: "",
      note: "",
    },
  };
}

function answer(
  d: DraftV2,
  now: number,
  patch: Partial<DraftAnswers>,
  touched = d.touched,
): DraftV2 {
  return {
    ...d,
    last_interaction_at: now,
    touched,
    answers: { ...d.answers, ...patch },
  };
}

// ---------------------------------------------------------------- answers

/**
 * Step 1 while it is on screen (ui.md §7.4): Whole body and
 * Nowhere set the zones chosen so far aside (`kept`) and give them back when
 * they are turned off again, so one mis-tap never wipes the map. A zone tap
 * while one of them is on starts a new choice. Saved data are unchanged:
 * `kept` lives in the form only and is dropped when step 1 is left.
 */
export function toggleLocationKeeping(
  d: DraftV2,
  key: string,
  now: number,
  kept: string[] | null,
): { draft: DraftV2; kept: string[] | null } {
  const cur = d.answers.locations;
  const exclusiveOn = cur.length === 1 && EXCLUSIVE_LOCATIONS.includes(cur[0]);
  if (EXCLUSIVE_LOCATIONS.includes(key)) {
    if (exclusiveOn && cur[0] === key) {
      // Turned off: the zones set aside come back
      return { draft: answer(d, now, { locations: kept ?? [] }), kept: null };
    }
    const zones = cur.filter((k) => !EXCLUSIVE_LOCATIONS.includes(k));
    return {
      draft: answer(d, now, { locations: [key] }),
      kept: zones.length > 0 ? zones : kept,
    };
  }
  return { draft: toggleLocation(d, key, now), kept: null };
}

/** Zones toggle; Whole body / Nowhere are exclusive with everything (ui.md §7.4). */
export function toggleLocation(d: DraftV2, key: string, now: number): DraftV2 {
  const cur = d.answers.locations;
  let next: string[];
  if (EXCLUSIVE_LOCATIONS.includes(key)) {
    next = cur.length === 1 && cur[0] === key ? [] : [key];
  } else {
    const zones = cur.filter((k) => !EXCLUSIVE_LOCATIONS.includes(k));
    next = zones.includes(key)
      ? zones.filter((k) => k !== key)
      : [...zones, key];
  }
  return answer(d, now, { locations: next });
}

/** Multi-select; "nothing" and "can't tell" are exclusive (ui.md §6.8). */
export function toggleQuality(d: DraftV2, key: string, now: number): DraftV2 {
  const cur = d.answers.qualities;
  let next: string[];
  if (cur.includes(key)) {
    next = cur.filter((k) => k !== key);
  } else if (EXCLUSIVE_QUALITIES.includes(key)) {
    next = [key];
  } else {
    next = [...cur.filter((k) => !EXCLUSIVE_QUALITIES.includes(k)), key];
  }
  return answer(d, now, { qualities: next });
}

/** Any input event marks the slider as touched, even at the midpoint. */
export function setSlider(
  d: DraftV2,
  field: SliderField,
  value: number,
  now: number,
): DraftV2 {
  const [min, max] = SLIDER_RANGE[field];
  const v = Math.min(max, Math.max(min, Math.round(value)));
  const touched = d.touched.includes(field) ? d.touched : [...d.touched, field];
  return answer(d, now, { [field]: v } as Partial<DraftAnswers>, touched);
}

/**
 * Level 1: tapping the selected word clears word, level 2 and certainty;
 * "don't know" sets word = certainty = "unknown" (ui.md §6.10).
 */
export function chooseWordL1(d: DraftV2, l1: string, now: number): DraftV2 {
  const current = d.answers.word?.split(".")[0] ?? null;
  if (current === l1) {
    return answer(d, now, { word: null, word_confidence: null });
  }
  if (l1 === "unknown") {
    return answer(d, now, { word: "unknown", word_confidence: "unknown" });
  }
  return answer(d, now, { word: l1, word_confidence: null });
}

/** Level 2 is optional, single select; tap again to clear. */
export function chooseWordL2(d: DraftV2, l2: string, now: number): DraftV2 {
  const l1 = d.answers.word?.split(".")[0];
  if (!l1 || l1 === "unknown") return d;
  const word = d.answers.word === `${l1}.${l2}` ? l1 : `${l1}.${l2}`;
  return answer(d, now, { word });
}

export function setConfidence(
  d: DraftV2,
  c: WordConfidence,
  now: number,
): DraftV2 {
  if (!d.answers.word || d.answers.word === "unknown") return d;
  return answer(d, now, { word_confidence: c });
}

/** One option, optional; tap again to clear. */
export function toggleUrge(d: DraftV2, key: string, now: number): DraftV2 {
  return answer(d, now, { urge: d.answers.urge === key ? null : key });
}

/** One option (required to continue); tap again to clear. */
export function toggleContext(d: DraftV2, key: string, now: number): DraftV2 {
  return answer(d, now, {
    context_tag: d.answers.context_tag === key ? null : key,
  });
}

export function setContextOther(
  d: DraftV2,
  text: string,
  now: number,
): DraftV2 {
  return answer(d, now, { context_other: cut(text, CONTEXT_OTHER_MAX) });
}

export function setNote(d: DraftV2, text: string, now: number): DraftV2 {
  return answer(d, now, { note: cut(text, NOTE_MAX) });
}

// ------------------------------------------------------------- navigation

/** ui.md §6.2 "Validity". */
export function isStepValid(d: DraftV2, step = d.step): boolean {
  const a = d.answers;
  const id = STEPS[step];
  switch (id) {
    case "intensity":
    case "valence":
    case "arousal":
    case "head_mode": // a touch, even where it is (owner decision 2026-10-10)
      return d.touched.includes(id);
    case "locations":
      return a.locations.length > 0;
    case "qualities":
      return a.qualities.length > 0;
    case "word":
      return a.word === null || a.word_confidence !== null;
    case "context": // and the optional note under it
      return a.context_tag !== null && validateNote(a.note).valid;
    default: // urge
      return true;
  }
}

/**
 * ui.md §5.1: for this long after any step change, Next, → and
 * a swipe commit are ignored, so a second tap meant for the screen that just
 * left never answers (or skips) the question that just arrived. The same
 * under reduced motion.
 */
export const STEP_SETTLE_MS = 350;

/** Whether a forward action may run, given when the step last changed. */
export function settled(stepChangedAt: number, now: number): boolean {
  return now - stepChangedAt >= STEP_SETTLE_MS;
}

/** Forward only when the screen is valid; never past the last screen. */
export function next(d: DraftV2, now: number): DraftV2 {
  if (d.step >= LAST_STEP || !isStepValid(d)) return d;
  return { ...d, step: d.step + 1, last_interaction_at: now };
}

/** Back always keeps the answers; disabled on step 1. */
export function back(d: DraftV2, now: number): DraftV2 {
  if (d.step === 0) return d;
  return { ...d, step: d.step - 1, last_interaction_at: now };
}

// --------------------------------------------------------- time and hiding

/** `visibilitychange → hidden` (not an interaction). */
export function hide(d: DraftV2, now: number): DraftV2 {
  return d.hidden_since === null ? { ...d, hidden_since: now } : d;
}

/** `→ visible`, or resuming a draft after a reload. */
export function show(d: DraftV2, now: number): DraftV2 {
  if (d.hidden_since === null) return d;
  return {
    ...d,
    hidden_ms: d.hidden_ms + Math.max(0, now - d.hidden_since),
    hidden_since: null,
  };
}

export function isAbandoned(d: DraftV2, now: number): boolean {
  return now - d.last_interaction_at >= ABANDON_AFTER_MS;
}

/**
 * Whether the person did anything at all in the form (an answer, Next,
 * Back). A form opened by mistake and left untouched has not.
 */
export function hasInteraction(d: DraftV2): boolean {
  return d.last_interaction_at !== d.started_at;
}

/**
 * ui.md §6.2: a check-in the person started themselves
 * (manual, after an event) and closed — or left to the abandon rule — with
 * no interaction at all leaves no record. One opened from a reminder keeps
 * it: an unanswered reminder is compliance data (methodology.md §1.1).
 */
export function discardable(d: DraftV2): boolean {
  return d.trigger !== "random" && !hasInteraction(d);
}

function timing(d: DraftV2, end: number) {
  const latencyMs = Math.max(0, end - d.started_at);
  const openHidden = d.hidden_since !== null
    ? Math.max(0, end - d.hidden_since)
    : 0;
  const hiddenMs = Math.min(latencyMs, d.hidden_ms + openHidden);
  return {
    latency_sec: Math.round(latencyMs / 1000),
    hidden_sec: Math.min(
      Math.round(latencyMs / 1000),
      Math.round(hiddenMs / 1000),
    ),
  };
}

// --------------------------------------------------------------- controls

/**
 * The form's layout over the check-in (`ui.layout`, data.md §3.6):
 * the one seen so far, with the one seen now. The same one stays; a second
 * one makes `mixed`, which stays. A missing side is unknown and adds nothing.
 */
export function mergeLayout(
  prev: UiLayout | undefined,
  now: UiLayout | undefined,
): UiLayout | undefined {
  if (!prev) return now;
  if (!now || now === prev) return prev;
  return "mixed";
}

/**
 * The entry's `ui` (data.md §3.6): the controls in use `now`
 * (`currentEntryUi`) over those the draft recorded (`prev`). The draft's
 * `copy` stays — the wording its first answers were given with, even across
 * an update — and the layouts merge (`mergeLayout`). Run when the form opens
 * and at save; never writes an `undefined` key (the draft is canonical JSON).
 */
export function mergeUi(
  prev: EntryUI | null | undefined,
  now: EntryUI | null | undefined,
): EntryUI | null {
  if (!now) return prev ?? null;
  if (!prev) return now;
  const { copy: _copy, layout: _layout, ...controls } = now;
  const layout = mergeLayout(prev.layout, now.layout);
  return {
    ...controls,
    ...(prev.copy !== undefined ? { copy: prev.copy } : {}),
    ...(layout ? { layout } : {}),
  };
}

/**
 * A layout seen while the form is on screen (turned sideways, a window
 * resized): merged into the draft's `ui` (`mergeLayout`). Not an
 * interaction. The same draft when nothing changes or it has no `ui`.
 */
export function recordLayout(
  d: DraftV2,
  layout: UiLayout | undefined,
): DraftV2 {
  if (!d.ui) return d;
  const merged = mergeLayout(d.ui.layout, layout);
  return merged === undefined || merged === d.ui.layout
    ? d
    : { ...d, ui: { ...d.ui, layout: merged } };
}

// --------------------------------------------------------------- results

export interface EntryContext {
  id: string;
  now: number;
  tzOffsetMin: number;
}

/**
 * The saved check-in ("Save" on the last screen). `ctx.ui` is the controls
 * at save, merged with the draft's (`mergeUi`).
 */
export function toEntry(
  d: DraftV2,
  ctx: EntryContext & { ui: EntryUI | null },
): EntryV2 {
  const a = d.answers;
  const other = a.context_other.trim();
  return {
    schema_v: 2,
    id: ctx.id,
    ts: new Date(ctx.now).toISOString(),
    tz_offset_min: ctx.tzOffsetMin,
    trigger: d.trigger,
    reminder_id: d.trigger === "random" ? d.reminder_id : null,
    ...timing(d, ctx.now),
    skipped: false,
    abandoned: false,
    stopped_at: null,
    untouched: SLIDER_FIELDS.filter((f) => !d.touched.includes(f)),
    ui: mergeUi(d.ui, ctx.ui),
    body: {
      locations: [...a.locations],
      qualities: [...a.qualities],
      intensity: a.intensity,
    },
    affect: {
      valence: a.valence,
      arousal: a.arousal,
      word: a.word,
      word_confidence: a.word ? a.word_confidence : null,
    },
    urge: a.urge,
    head_mode: a.head_mode,
    context_tag: a.context_tag,
    context_other: a.context_tag === "other" && other ? other : null,
    note: a.note.trim() || null,
  };
}

/**
 * A check-in that ends unsaved: "Skip check-in" on step 1 and "Stop here"
 * from step 2 on (`abandoned: false`, now), or a draft finalized by the
 * abandon rule (`abandoned: true`, ending at the last interaction). Always
 * `skipped: true` (compliance: methodology.md §5.3). `stopped_at` is
 * the step on screen; the answers of every step before it are kept as they
 * were confirmed with Next — observed data, not imputed — and that step and
 * all later ones are `null`. On step 1 no answer is kept. `untouched` lists
 * the kept sliders never moved; sliders not reached are `null`, not listed.
 * `ui` is the draft's on every screen, step 1 included: which copy and
 * layout the check-in was shown in (data.md §3.6, ui.md §6.2); `null` only for
 * a draft that never recorded one.
 */
export function toStoppedEntry(
  d: DraftV2,
  ctx: EntryContext & { abandoned: boolean },
): EntryV2 {
  const end = ctx.abandoned ? d.last_interaction_at : ctx.now;
  const stoppedAt: AnswerStep = STEPS[d.step];
  const stop = ANSWER_STEPS.indexOf(stoppedAt);
  const kept = (s: AnswerStep) => ANSWER_STEPS.indexOf(s) < stop;
  const base = {
    schema_v: 2 as const,
    id: ctx.id,
    ts: new Date(end).toISOString(),
    tz_offset_min: ctx.tzOffsetMin,
    trigger: d.trigger,
    reminder_id: d.trigger === "random" ? d.reminder_id : null,
    ...timing(d, end),
    skipped: true,
    abandoned: ctx.abandoned,
    stopped_at: stoppedAt,
    ui: d.ui ?? null,
  };
  if (stop === 0) {
    return {
      ...base,
      untouched: null,
      body: null,
      affect: null,
      urge: null,
      head_mode: null,
      context_tag: null,
      context_other: null,
      note: null,
    };
  }
  const a = d.answers;
  const other = a.context_other.trim();
  const note = a.note.trim();
  return {
    ...base,
    untouched: SLIDER_FIELDS.filter((f) => kept(f) && !d.touched.includes(f)),
    body: {
      locations: [...a.locations],
      qualities: kept("qualities") ? [...a.qualities] : null,
      intensity: kept("intensity") ? a.intensity : null,
    },
    affect: kept("valence")
      ? {
        valence: a.valence,
        arousal: kept("arousal") ? a.arousal : null,
        word: kept("word") ? a.word : null,
        word_confidence: kept("word") && a.word ? a.word_confidence : null,
      }
      : null,
    urge: kept("urge") ? a.urge : null,
    head_mode: kept("head_mode") ? a.head_mode : null,
    context_tag: kept("context") ? a.context_tag : null,
    context_other: kept("context") && a.context_tag === "other" && other
      ? other
      : null,
    note: kept("note") && note && validateNote(note).valid ? note : null,
  };
}

/**
 * Undo: an entry back into a draft, answers intact — a saved one on the
 * last screen, a stopped one on the screen where it stopped. A check-in
 * skipped on step 1 gives a fresh draft. The entry's `ui` comes back with
 * it, so its copy and layout carry on (`mergeUi`).
 */
export function draftFromEntry(e: EntryV2, now: number): DraftV2 {
  const d: DraftV2 = {
    ...newDraft(e.trigger, e.reminder_id, now),
    ...(e.ui ? { ui: e.ui } : {}),
  };
  const stopped = e.skipped ? e.stopped_at ?? null : null;
  if (!e.body || (e.skipped && (stopped === null || stopped === "locations"))) {
    return d;
  }
  const untouched = e.untouched ?? [];
  const value: Record<SliderField, number | null> = {
    intensity: e.body.intensity,
    valence: e.affect?.valence ?? null,
    arousal: e.affect?.arousal ?? null,
    head_mode: e.head_mode,
  };
  return {
    ...d,
    step: stopped === null ? LAST_STEP : screenOf(stopped),
    started_at: now - e.latency_sec * 1000,
    hidden_ms: e.hidden_sec * 1000,
    touched: SLIDER_FIELDS.filter((f) =>
      value[f] !== null && !untouched.includes(f)
    ),
    answers: {
      locations: [...e.body.locations],
      qualities: [...(e.body.qualities ?? [])],
      intensity: e.body.intensity ?? MIDPOINT.intensity,
      valence: e.affect?.valence ?? MIDPOINT.valence,
      arousal: e.affect?.arousal ?? MIDPOINT.arousal,
      word: e.affect?.word ?? null,
      word_confidence: e.affect?.word_confidence ?? null,
      urge: e.urge,
      head_mode: e.head_mode ?? MIDPOINT.head_mode,
      context_tag: e.context_tag,
      context_other: e.context_other ?? "",
      note: e.note ?? "",
    },
  };
}
