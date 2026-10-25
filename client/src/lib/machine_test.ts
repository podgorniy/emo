// SPDX-License-Identifier: AGPL-3.0-or-later
/** The form state machine (ui.md §6.2, development.md §5.1; ui.md §6). */
import { assertEquals } from "@std/assert";
import { validateEntryV2 } from "../../../shared/entry.ts";
import type { DraftV2 } from "../../../shared/entry.ts";
import * as m from "./machine.ts";

const T0 = Date.parse("2026-10-08T10:00:00Z");
const ctx = (now: number) => ({
  id: crypto.randomUUID(),
  now,
  tzOffsetMin: 180,
});
const UI = {
  theme: "3f9a1c0be27d4a65",
  intensity: "slider",
  options: "grid",
  figure: "solid",
} as const;
/** As copy 6 records it on a phone */
const UI6 = { ...UI, copy: 6, layout: "phone" } as const;

/**
 * Fills every required screen and walks to the last one (situation and note);
 * each slider pressed where it is, the midpoint.
 */
function filled(now = T0): DraftV2 {
  let d = m.newDraft("manual", null, now);
  d = m.toggleLocation(d, "chest", now);
  d = m.next(d, now);
  d = m.toggleQuality(d, "squeeze", now);
  for (let i = 0; i < 7; i++) { // sliders, word, urge
    const step = m.STEPS[d.step];
    const slider = m.SLIDER_FIELDS.find((f) => f === step);
    if (slider) d = m.setSlider(d, slider, m.MIDPOINT[slider], now);
    d = m.next(d, now);
  }
  d = m.toggleContext(d, "work", now);
  return d;
}

/** As a draft from before Next waited for a touch: every slider untouched. */
function unpressed(d: DraftV2): DraftV2 {
  return { ...d, touched: [] };
}

function assertValid(entry: unknown) {
  assertEquals(validateEntryV2(entry), { valid: true, errors: [] });
}

Deno.test("machine - 9 screens in the spec order", () => {
  assertEquals(
    m.STEPS.join(" → "),
    "locations → qualities → intensity → valence → arousal → word → urge → head_mode → context",
  );
});

Deno.test("machine - cannot go forward past an unanswered screen", () => {
  let d = m.newDraft("manual", null, T0);
  assertEquals(m.next(d, T0).step, 0); // no location yet
  d = m.next(m.toggleLocation(d, "chest", T0), T0);
  assertEquals(d.step, 1);
  assertEquals(m.next(d, T0).step, 1); // no quality yet
  assertEquals(filled().step, m.LAST_STEP);
  assertEquals(m.next(filled(), T0).step, m.LAST_STEP); // never past the end
});

Deno.test("machine - a slider screen waits for a touch, even where it is", () => {
  for (const f of m.SLIDER_FIELDS) {
    let d: DraftV2 = { ...unpressed(filled()), step: m.STEPS.indexOf(f) };
    assertEquals([m.isStepValid(d), m.next(d, T0).step], [false, d.step], f);
    d = m.setSlider(d, f, m.MIDPOINT[f], T0); // a press without a move
    assertEquals([m.isStepValid(d), m.next(d, T0).step], [true, d.step + 1], f);
    assertEquals(d.answers[f], m.MIDPOINT[f]);
  }
});

Deno.test("machine - back keeps every answer; disabled on step 1", () => {
  const d = filled();
  let b = d;
  for (let i = 0; i < 20; i++) b = m.back(b, T0);
  assertEquals(b.step, 0);
  assertEquals(b.answers, d.answers);
});

Deno.test("machine - untouched lists exactly the sliders never moved", () => {
  let d = unpressed(filled());
  let e = m.toEntry(d, { ...ctx(T0), ui: UI });
  assertEquals(e.untouched, ["intensity", "valence", "arousal", "head_mode"]);
  assertEquals(e.body!.intensity, 5);
  assertEquals(e.affect!.valence, 0);

  // Moving to the midpoint is still "touched"; a deliberate 0 is kept as 0
  d = m.setSlider(d, "intensity", 5, T0);
  d = m.setSlider(d, "arousal", 0, T0);
  e = m.toEntry(d, { ...ctx(T0), ui: UI });
  assertEquals(e.untouched, ["valence", "head_mode"]);
  assertEquals(e.affect!.arousal, 0);
  assertValid(e);

  for (const f of m.SLIDER_FIELDS) d = m.setSlider(d, f, 1, T0);
  assertEquals(m.toEntry(d, { ...ctx(T0), ui: UI }).untouched, []);
});

Deno.test("machine - Skip check-in on step 1 keeps no answer, with stopped_at and ui", () => {
  const d: DraftV2 = {
    ...m.toggleLocation(m.newDraft("manual", null, T0), "chest", T0),
    ui: UI6,
  };
  const e = m.toStoppedEntry(d, { ...ctx(T0 + 30_000), abandoned: false });
  assertEquals([e.skipped, e.abandoned, e.stopped_at], [
    true,
    false,
    "locations",
  ]);
  assertEquals([
    e.body,
    e.affect,
    e.urge,
    e.head_mode,
    e.context_tag,
    e.note,
    e.untouched,
  ], [null, null, null, null, null, null, null]);
  // The copy and layout it was shown in (ui.md §6.2)
  assertEquals(e.ui, UI6);
  assertEquals(e.latency_sec, 30);
  assertValid(e);
  // A draft that never recorded its controls: null, as before copy 6
  const { ui: _ui, ...older } = d;
  assertEquals(
    m.toStoppedEntry(older, { ...ctx(T0), abandoned: false }).ui,
    null,
  );
});

Deno.test("machine - mergeLayout: one layout stays, a second one is mixed", () => {
  assertEquals(m.mergeLayout(undefined, undefined), undefined);
  assertEquals(m.mergeLayout(undefined, "phone"), "phone");
  assertEquals(
    m.mergeLayout("wide", undefined),
    "wide",
    "unknown adds nothing",
  );
  for (const l of ["phone", "wide", "short", "mixed"] as const) {
    assertEquals(m.mergeLayout(l, l), l);
  }
  assertEquals(m.mergeLayout("phone", "short"), "mixed", "turned sideways");
  assertEquals(m.mergeLayout("wide", "phone"), "mixed");
  assertEquals(m.mergeLayout("mixed", "phone"), "mixed", "mixed stays");
  assertEquals(m.mergeLayout("phone", "mixed"), "mixed");
});

Deno.test("machine - mergeUi: the controls now, the draft's copy, the layouts merged", () => {
  const now = { ...UI6, theme: "0123456789abcdef", layout: "wide" } as const;
  // Nothing recorded yet: the controls now
  assertEquals(m.mergeUi(undefined, now), now);
  assertEquals(m.mergeUi(null, null), null);
  assertEquals(m.mergeUi(UI6, null), UI6, "nothing now: the draft's");
  // Started in copy 5 on a phone, saved after an update on a wide screen
  const prev = { ...UI, copy: 5, layout: "phone" } as const;
  assertEquals(m.mergeUi(prev, now), {
    ...UI,
    theme: "0123456789abcdef",
    copy: 5,
    layout: "mixed",
  });
  // The same layout stays; no key is ever undefined (canonical JSON)
  assertEquals(m.mergeUi(UI6, { ...UI6, layout: "phone" }), UI6);
  const unknown = m.mergeUi(UI, UI)!;
  assertEquals(Object.keys(unknown).sort(), [
    "figure",
    "intensity",
    "options",
    "theme",
  ]);
  assertEquals(m.mergeUi({ ...UI, layout: "short" }, UI)?.layout, "short");
});

Deno.test("machine - recordLayout: a turn while the form is open, not an interaction", () => {
  const d: DraftV2 = { ...m.newDraft("manual", null, T0), ui: UI6 };
  assertEquals(m.recordLayout(d, "phone"), d, "same layout: same draft");
  assertEquals(m.recordLayout(d, undefined), d, "unknown: same draft");
  const turned = m.recordLayout(d, "short");
  assertEquals(turned.ui, { ...UI6, layout: "mixed" });
  assertEquals(turned.last_interaction_at, d.last_interaction_at);
  assertEquals(m.discardable(turned), true, "still untouched");
  assertEquals(m.recordLayout(turned, "phone"), turned, "mixed stays");
  // Before its ui is recorded there is nothing to merge into
  const bare = m.newDraft("manual", null, T0);
  assertEquals(m.recordLayout(bare, "wide"), bare);
});

Deno.test("machine - Save keeps the draft's copy; a layout change makes it mixed", () => {
  const d: DraftV2 = { ...filled(), ui: { ...UI6, copy: 5 } };
  const same = m.toEntry(d, { ...ctx(T0), ui: UI6 });
  assertEquals(same.ui, { ...UI6, copy: 5 });
  assertValid(same);
  const turned = m.toEntry(d, { ...ctx(T0), ui: { ...UI6, layout: "short" } });
  assertEquals(turned.ui, { ...UI6, copy: 5, layout: "mixed" });
  assertValid(turned);
  // A draft without ui (from before it was recorded): the controls at save
  assertEquals(m.toEntry(filled(), { ...ctx(T0), ui: UI6 }).ui, UI6);
});

Deno.test("machine - Stop here keeps the steps before the one on screen", () => {
  let d: DraftV2 = { ...unpressed(filled()), ui: UI };
  d = m.setSlider({ ...d, step: 3 }, "valence", -2, T0); // moved
  d = m.chooseWordL1({ ...d, step: 5 }, "fear", T0);
  d = m.setConfidence(d, "guess", T0);
  d = m.setNote(d, "кухня", T0);
  // Every screen from step 2 on: valid, and nothing after it is kept
  for (let step = 1; step <= m.LAST_STEP; step++) {
    const e = m.toStoppedEntry({ ...d, step }, {
      ...ctx(T0 + 30_000),
      abandoned: false,
    });
    assertEquals([e.skipped, e.abandoned, e.stopped_at], [
      true,
      false,
      m.STEPS[step],
    ]);
    assertEquals(e.body?.locations, ["chest"]);
    assertEquals(e.ui, UI);
    assertValid(e);
  }
  const at = (step: m.StepId) =>
    m.toStoppedEntry({ ...d, step: m.STEPS.indexOf(step) }, {
      ...ctx(T0 + 30_000),
      abandoned: false,
    });
  // Stopped on step 2: only the zones; no slider reached
  assertEquals(at("qualities").body, {
    locations: ["chest"],
    qualities: null,
    intensity: null,
  });
  assertEquals([at("qualities").affect, at("qualities").untouched], [null, []]);
  // Stopped on arousal: intensity untouched (midpoint, listed), valence moved
  const arousal = at("arousal");
  assertEquals(arousal.body?.intensity, 5);
  assertEquals(arousal.affect, {
    valence: -2,
    arousal: null,
    word: null,
    word_confidence: null,
  });
  assertEquals(arousal.untouched, ["intensity"]);
  assertEquals([arousal.urge, arousal.head_mode, arousal.context_tag], [
    null,
    null,
    null,
  ]);
  // Stopped on the last screen: everything before the situation and its
  // note (one screen since 2026-10-09)
  const last = at("context");
  assertEquals(last.stopped_at, "context");
  assertEquals(last.affect?.word, "fear");
  assertEquals(last.affect?.word_confidence, "guess");
  assertEquals([last.context_tag, last.note], [null, null]);
  assertEquals(last.untouched, ["intensity", "arousal", "head_mode"]);
});

Deno.test("machine - nine screens: the note sits under the situation", () => {
  assertEquals(m.STEPS.length, 9);
  assertEquals(m.screenOf("note"), m.LAST_STEP);
  assertEquals(m.screenOf("context"), m.LAST_STEP);
  // The last screen needs a situation, and a note that passes the validator
  let d: DraftV2 = { ...filled(), step: m.LAST_STEP };
  assertEquals(m.isStepValid(d), true);
  d = m.setNote(d, "because of work", T0);
  assertEquals(m.isStepValid(d), false);
  d = m.setNote(d, "", T0);
  assertEquals(m.isStepValid(d), true);
  assertEquals(m.isStepValid(m.toggleContext(d, "work", T0)), false);
  // An entry stopped on the old note screen reopens on the last one
  const older = {
    ...m.toStoppedEntry({ ...filled(), step: m.LAST_STEP }, {
      ...ctx(T0),
      abandoned: false,
    }),
    stopped_at: "note" as const,
  };
  assertEquals(m.draftFromEntry(older, T0).step, m.LAST_STEP);
});

Deno.test("machine - a stopped entry with a field after stopped_at is invalid", () => {
  const e = m.toStoppedEntry({ ...filled(), step: 2 }, {
    ...ctx(T0),
    abandoned: false,
  });
  assertValid(e);
  const bad = { ...e, body: { ...e.body!, intensity: 4 } };
  assertEquals(validateEntryV2(bad).valid, false);
  const noStop = { ...e, stopped_at: null };
  assertEquals(validateEntryV2(noStop).valid, false);
  const saved = m.toEntry(filled(), { ...ctx(T0), ui: UI });
  assertEquals(saved.stopped_at, null);
  assertEquals(validateEntryV2({ ...saved, stopped_at: "note" }).valid, false);
  // Written before stopped_at existed: missing = null
  const { stopped_at: _gone, ...older } = saved;
  assertValid(older);
});

Deno.test("machine - Undo of a stopped check-in reopens it where it stopped", () => {
  let d: DraftV2 = { ...filled(), ui: UI };
  d = m.setSlider({ ...d, step: 2 }, "intensity", 8, T0);
  const e = m.toStoppedEntry({ ...d, step: 4 }, {
    ...ctx(T0 + 30_000),
    abandoned: false,
  });
  const back = m.draftFromEntry(e, T0 + 40_000);
  assertEquals(m.STEPS[back.step], "arousal");
  assertEquals(back.answers.intensity, 8);
  assertEquals(back.answers.qualities, ["squeeze"]);
  assertEquals(back.touched, ["intensity", "valence"]); // arousal: not kept
  assertEquals(back.ui, UI, "its copy and layout carry on");
  // Skipped on step 1: a fresh form, still with the entry's ui
  const first = m.toStoppedEntry({ ...d, step: 0 }, {
    ...ctx(T0),
    abandoned: false,
  });
  assertEquals(m.draftFromEntry(first, T0).step, 0);
  assertEquals(m.draftFromEntry(first, T0).answers.locations, []);
  assertEquals(m.draftFromEntry(first, T0).ui, UI);
  // An entry without ui gives a draft without one
  assertEquals("ui" in m.draftFromEntry({ ...first, ui: null }, T0), false);
});

Deno.test("machine - an untouched self-started form is discardable, a reminder's is not", () => {
  const manual = m.newDraft("manual", null, T0);
  assertEquals(m.discardable(manual), true);
  assertEquals(m.discardable(m.newDraft("after_event", null, T0)), true);
  assertEquals(
    m.discardable(
      m.newDraft("random", "0192f1c4-7b43-7000-8000-0000000000aa", T0),
    ),
    false,
  );
  // Shown again after a reload: still untouched
  assertEquals(m.discardable(m.show(m.hide(manual, T0 + 1), T0 + 5)), true);
  // Any interaction, even one undone, counts
  const tapped = m.toggleLocation(
    m.toggleLocation(manual, "chest", T0 + 10),
    "chest",
    T0 + 20,
  );
  assertEquals(m.discardable(tapped), false);
});

Deno.test("machine - 9 minutes in the background → hidden_sec ≈ 540", () => {
  let d = filled(T0);
  d = m.hide(d, T0 + 10_000);
  d = m.show(d, T0 + 10_000 + 540_000);
  const e = m.toEntry(d, { ...ctx(T0 + 600_000), ui: UI });
  assertEquals(e.latency_sec, 600);
  assertEquals(e.hidden_sec, 540);
  // Still hidden at save time counts up to the save
  const h = m.hide(filled(T0), T0 + 1_000);
  assertEquals(m.toEntry(h, { ...ctx(T0 + 61_000), ui: UI }).hidden_sec, 60);
});

Deno.test("machine - abandon after ≥ 10 min of no interaction, else resume (also after a restart)", () => {
  let d = m.toggleLocation(
    m.newDraft("random", "0192f1c4-7b43-7000-8000-0000000000aa", T0),
    "throat",
    T0 + 20_000,
  );
  d = m.hide(d, T0 + 25_000);

  // A restart: the draft goes through JSON (it is stored encrypted)
  const restored = JSON.parse(JSON.stringify(d)) as DraftV2;
  assertEquals(
    m.isAbandoned(restored, T0 + 20_000 + m.ABANDON_AFTER_MS - 1),
    false,
  );
  const resumed = m.show(restored, T0 + 300_000);
  assertEquals([resumed.step, resumed.answers.locations], [0, ["throat"]]);
  assertEquals(resumed.hidden_ms, 275_000);

  assertEquals(m.isAbandoned(restored, T0 + 20_000 + m.ABANDON_AFTER_MS), true);
  const e = m.toStoppedEntry(restored, {
    ...ctx(T0 + 3_600_000),
    abandoned: true,
  });
  assertEquals([e.skipped, e.abandoned], [true, true]);
  assertEquals(e.stopped_at, "locations");
  assertEquals(e.ts, new Date(T0 + 20_000).toISOString()); // last interaction
  assertEquals(e.latency_sec, 20);
  assertEquals(e.hidden_sec, 0); // hidden only after the last interaction
  assertEquals([e.trigger, e.reminder_id], [
    "random",
    "0192f1c4-7b43-7000-8000-0000000000aa",
  ]);
  assertEquals(e.body, null); // left on step 1: no answer kept
  assertValid(e);
  // …but the copy and layout it was shown in are
  const left = m.toStoppedEntry({ ...restored, ui: UI6 }, {
    ...ctx(T0 + 3_600_000),
    abandoned: true,
  });
  assertEquals([left.stopped_at, left.ui], ["locations", UI6]);
  assertValid(left);
  // Left on step 4: the answers of steps 1–3 are kept, as on Stop here
  const later = m.toStoppedEntry({ ...filled(T0), step: 3 }, {
    ...ctx(T0 + 3_600_000),
    abandoned: true,
  });
  assertEquals([later.abandoned, later.stopped_at], [true, "valence"]);
  assertEquals(later.body?.qualities, ["squeeze"]);
  assertValid(later);
});

Deno.test("machine - Whole body / Nowhere are exclusive with zones", () => {
  let d = m.newDraft("manual", null, T0);
  d = m.toggleLocation(d, "chest", T0);
  d = m.toggleLocation(d, "throat", T0);
  assertEquals(d.answers.locations, ["chest", "throat"]);
  d = m.toggleLocation(d, "whole_body", T0);
  assertEquals(d.answers.locations, ["whole_body"]);
  d = m.toggleLocation(d, "nowhere", T0);
  assertEquals(d.answers.locations, ["nowhere"]);
  d = m.toggleLocation(d, "nowhere", T0);
  assertEquals(d.answers.locations, []);
  d = m.toggleLocation(m.toggleLocation(d, "whole_body", T0), "jaw", T0);
  assertEquals(d.answers.locations, ["jaw"]);
});

Deno.test("machine - Whole body / Nowhere set the zones aside and give them back (ui.md §7.4)", () => {
  let d = m.newDraft("manual", null, T0);
  let kept: string[] | null = null;
  const tap = (key: string) => {
    ({ draft: d, kept } = m.toggleLocationKeeping(d, key, T0, kept));
  };
  for (
    const z of ["chest", "throat", "jaw", "neck", "arms_hands", "legs_feet"]
  ) {
    tap(z);
  }
  const six = [...d.answers.locations];
  tap("whole_body");
  assertEquals(d.answers.locations, ["whole_body"]);
  tap("whole_body"); // off: the six zones are back, in their order
  assertEquals(d.answers.locations, six);
  // Whole body → Nowhere → off still gives them back
  tap("whole_body");
  tap("nowhere");
  assertEquals(d.answers.locations, ["nowhere"]);
  tap("nowhere");
  assertEquals(d.answers.locations, six);
  // A zone tap while Nowhere is on starts a new choice and forgets the rest
  tap("nowhere");
  tap("belly");
  assertEquals(d.answers.locations, ["belly"]);
  assertEquals(kept, null);
  tap("whole_body");
  tap("whole_body");
  assertEquals(d.answers.locations, ["belly"]);
  // With nothing chosen before, turning it off leaves nothing
  d = m.newDraft("manual", null, T0);
  kept = null;
  tap("nowhere");
  tap("nowhere");
  assertEquals(d.answers.locations, []);
});

Deno.test("machine - a second Next within 350 ms of a step change does nothing (ui.md §5.1)", () => {
  // Two Next activations 60 ms apart on answered screens
  let d: DraftV2 = { ...filled(), step: 2 };
  let changedAt = T0 - 10_000;
  const activate = (now: number) => {
    if (!m.settled(changedAt, now)) return;
    const n = m.next(d, now);
    if (n.step !== d.step) changedAt = now;
    d = n;
  };
  activate(T0);
  activate(T0 + 60);
  assertEquals(d.step, 3);
  activate(T0 + 349);
  assertEquals(d.step, 3);
  activate(T0 + 350);
  assertEquals(d.step, 4);
});

Deno.test("machine - nothing / can't tell are exclusive with other qualities", () => {
  let d = m.newDraft("manual", null, T0);
  d = m.toggleQuality(m.toggleQuality(d, "squeeze", T0), "lump", T0);
  d = m.toggleQuality(d, "nothing", T0);
  assertEquals(d.answers.qualities, ["nothing"]);
  d = m.toggleQuality(d, "cant_tell", T0);
  assertEquals(d.answers.qualities, ["cant_tell"]);
  d = m.toggleQuality(d, "heaviness", T0);
  assertEquals(d.answers.qualities, ["heaviness"]);
});

Deno.test("machine - word: certainty required, never pre-set; don't know sets both", () => {
  let d = { ...filled(), step: 5 };
  assertEquals(m.isStepValid(d), true); // no word is an answer
  assertEquals(
    m.toEntry(d, { ...ctx(T0), ui: UI }).affect!.word_confidence,
    null,
  );

  d = m.chooseWordL1(d, "fear", T0);
  assertEquals([d.answers.word, d.answers.word_confidence], ["fear", null]);
  assertEquals(m.isStepValid(d), false);
  d = m.chooseWordL2(d, "anxiety", T0);
  assertEquals(d.answers.word, "fear.anxiety");
  d = m.chooseWordL2(d, "anxiety", T0);
  assertEquals(d.answers.word, "fear");
  d = m.setConfidence(d, "guess", T0);
  assertEquals(m.isStepValid(d), true);

  // Tapping the selected level-1 word clears word, level 2 and certainty
  d = m.chooseWordL1(m.chooseWordL2(d, "panic", T0), "fear", T0);
  assertEquals([d.answers.word, d.answers.word_confidence], [null, null]);

  d = m.chooseWordL1(d, "unknown", T0);
  assertEquals([d.answers.word, d.answers.word_confidence], [
    "unknown",
    "unknown",
  ]);
  assertEquals(m.isStepValid(d), true);
  assertEquals(
    m.setConfidence(d, "sure", T0).answers.word_confidence,
    "unknown",
  );
  assertValid(m.toEntry(d, { ...ctx(T0), ui: UI }));
});

Deno.test("machine - context: required; other-text saved only with 'other', ≤ 40 code points", () => {
  let d = { ...filled(), step: 8 };
  d = m.toggleContext(d, "work", T0); // deselect
  assertEquals(m.isStepValid(d), false);
  d = m.toggleContext(d, "other", T0);
  d = m.setContextOther(d, "й".repeat(50), T0);
  assertEquals(Array.from(d.answers.context_other).length, 40);
  assertEquals(
    m.toEntry(d, { ...ctx(T0), ui: UI }).context_other,
    "й".repeat(40),
  );
  d = m.toggleContext(m.toggleContext(d, "other", T0), "home", T0);
  assertEquals(d.answers.context_other, "й".repeat(40)); // kept until save…
  assertEquals(m.toEntry(d, { ...ctx(T0), ui: UI }).context_other, null); // …not saved
});

Deno.test("machine - note: validator blocks Save; ≤ 160 code points", () => {
  let d = filled();
  d = m.setNote(d, "потому что опоздал", T0);
  assertEquals(m.isStepValid(d), false);
  d = m.setNote(d, "созвон, кухня, 15 минут", T0);
  assertEquals(m.isStepValid(d), true);
  d = m.setNote(d, "ё".repeat(200), T0);
  assertEquals(Array.from(d.answers.note).length, 160);
});

Deno.test("machine - Undo puts the entry back into the form intact", () => {
  let d = m.setSlider(unpressed(filled()), "arousal", 0, T0);
  d = m.setNote(d, "кухня", T0);
  const e = m.toEntry(d, { ...ctx(T0 + 60_000), ui: UI });
  const back = m.draftFromEntry(e, T0 + 65_000);
  assertEquals(back.step, m.LAST_STEP);
  assertEquals(back.answers.arousal, 0);
  assertEquals(back.answers.note, "кухня");
  assertEquals(back.touched, ["arousal"]);
  assertEquals(
    m.toEntry(back, { ...ctx(T0 + 70_000), ui: UI }).untouched,
    e.untouched,
  );
});
