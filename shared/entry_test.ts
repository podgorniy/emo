// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalizeJson,
  COPY_VERSION,
  EntryV2,
  KNOWN_MAX_SCHEMA_V,
  padEntryPlaintext,
  readEntry,
  UI_LAYOUTS,
  unpadEntryPlaintext,
  validateEntryV2,
  validateNote,
} from "./entry.ts";
import { PADDING_BLOCK_SIZE } from "./crypto/constants.ts";
import {
  BODY_ZONES,
  forInput,
  QUALITIES,
  URGES,
  WORDS,
} from "./dictionaries.ts";
import { encryptEntry, importDek } from "./crypto/e2e.ts";

Deno.test("note validator - accepts factual notes", () => {
  assertEquals(validateNote("созвон, кухня, 15 минут").valid, true);
  assertEquals(validateNote("15 хвилин тому").valid, true); // "тому" is allowed
  assertEquals(validateNote("meeting with team, desk").valid, true);
});

Deno.test("note validator - rejects stop phrases (why explanations)", () => {
  assertEquals(validateNote("потому что устал").valid, false);
  assertEquals(validateNote("бо не виспався").valid, false);
  assertEquals(validateNote("because I was tired").valid, false);
  assertEquals(validateNote("почему опять").valid, false);
  assertEquals(validateNote("what's wrong with me").valid, false);
  // Hedges are not "why" (2026-10-09): they pass
  assertEquals(validateNote("думаю, все хорошо").valid, true);
  assertEquals(validateNote("it seems weird").valid, true);
});

Deno.test("canonical JSON - sorts object keys deterministically", () => {
  const obj1 = { z: 1, a: 2, m: { y: 3, b: 4 } };
  const obj2 = { a: 2, m: { b: 4, y: 3 }, z: 1 };
  assertEquals(canonicalizeJson(obj1), canonicalizeJson(obj2));
  assertEquals(canonicalizeJson(obj1), '{"a":2,"m":{"b":4,"y":3},"z":1}');
});

Deno.test("padding - pads to multiple of 2048 bytes with spaces and restores", () => {
  const json = canonicalizeJson({ test: "data", value: 123 });
  const padded = padEntryPlaintext(json);
  assertEquals(padded.length % PADDING_BLOCK_SIZE, 0);
  assertEquals(padded.length >= PADDING_BLOCK_SIZE, true);

  const restored = unpadEntryPlaintext(padded);
  assertEquals(restored, json);
});

Deno.test("entry validation - valid entry", () => {
  const entry: EntryV2 = {
    schema_v: 2,
    id: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
    ts: new Date().toISOString(),
    tz_offset_min: 180,
    trigger: "random",
    reminder_id: "0192f1c4-7b43-7000-8000-0000000000aa",
    latency_sec: 15,
    hidden_sec: 0,
    skipped: false,
    abandoned: false,
    untouched: [],
    ui: {
      theme: "3f9a1c0be27d4a65",
      intensity: "slider",
      options: "chips",
      figure: "solid",
    },
    body: {
      locations: ["chest"],
      qualities: ["warmth"],
      intensity: 7,
    },
    affect: {
      valence: 2,
      arousal: 6,
      word: "joy.calm",
      word_confidence: "sure",
    },
    urge: "hug",
    head_mode: 3,
    context_tag: "home",
    context_other: null,
    note: "living room, tea",
  };

  const res = validateEntryV2(entry);
  assertEquals(res.valid, true);
  assertEquals(res.errors, []);
});

Deno.test("entry fixture - entry.v2.json matches the released schema", async () => {
  const fixture = JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/entry.v2.json", import.meta.url),
    ),
  );
  // Exact key set of schema_v 2 (data.md §2); it can never shrink.
  assertEquals(Object.keys(fixture).sort(), [
    "abandoned",
    "affect",
    "body",
    "context_other",
    "context_tag",
    "head_mode",
    "hidden_sec",
    "id",
    "latency_sec",
    "note",
    "reminder_id",
    "schema_v",
    "skipped",
    "trigger",
    "ts",
    "tz_offset_min",
    "ui",
    "untouched",
    "urge",
  ]);
  // `ui` as copy 6 writes it: the copy and the layout too
  assertEquals(Object.keys(fixture.ui).sort(), [
    "copy",
    "figure",
    "intensity",
    "layout",
    "options",
    "theme",
  ]);
  assertEquals(validateEntryV2(fixture), { valid: true, errors: [] });
});

Deno.test("entry validation - tz_offset_min and reminder_id rules", () => {
  const base = JSON.parse(
    Deno.readTextFileSync(new URL("./fixtures/entry.v2.json", import.meta.url)),
  );
  const invalid = (patch: Record<string, unknown>) =>
    validateEntryV2({ ...base, ...patch }).valid;

  assertEquals(invalid({ tz_offset_min: 180.5 }), false);
  assertEquals(invalid({ tz_offset_min: 900 }), false);
  assertEquals(invalid({ tz_offset_min: "Europe/Kyiv" }), false);
  assertEquals(invalid({ tz_offset_min: -720 }), true);
  assertEquals(invalid({ reminder_id: undefined }), false);
  assertEquals(invalid({ reminder_id: "not-a-uuid" }), false);
  assertEquals(invalid({ trigger: "manual" }), false); // reminder_id must be null
  assertEquals(invalid({ trigger: "manual", reminder_id: null }), true);
  assertEquals(invalid({ trigger: "random", reminder_id: null }), true);
});

Deno.test("canonical JSON - only JSON values; never invalid output", () => {
  for (
    const bad of [
      { a: undefined },
      [undefined],
      { f: () => 1 },
      { n: NaN },
      Infinity,
    ]
  ) {
    assertThrows(() => canonicalizeJson(bad), TypeError);
  }
  assertEquals(
    canonicalizeJson({ b: [1, "x", null, true], a: { c: -0.5 } }),
    '{"a":{"c":-0.5},"b":[1,"x",null,true]}',
  );
});

const FIXTURE = JSON.parse(
  Deno.readTextFileSync(new URL("./fixtures/entry.v2.json", import.meta.url)),
);
/** True when the fixture with `patch` applied (deep, by dotted path) is valid. */
function validWith(patch: Record<string, unknown>): boolean {
  const e = structuredClone(FIXTURE);
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split(".");
    let o = e;
    for (const k of keys.slice(0, -1)) o = o[k];
    if (value === undefined) delete o[keys.at(-1)!];
    else o[keys.at(-1)!] = value;
  }
  return validateEntryV2(e).valid;
}

const SKIPPED = {
  skipped: true,
  untouched: null,
  ui: null,
  body: null,
  affect: null,
  urge: null,
  head_mode: null,
  context_tag: null,
  context_other: null,
  note: null,
};

Deno.test("entry validation - each rule rejects what it should (H22)", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["upper-case or non-v4 id", { id: "6F1C2A3E-9B4D-1E7F-8A21-5C3D9E0B1F47" }],
    ["local time without Z", { ts: "2026-10-07T10:00:00" }],
    ["unknown zone", { "body.locations": ["tail"] }],
    ["repeated zone", { "body.locations": ["chest", "chest"] }],
    ["whole body plus a zone", { "body.locations": ["whole_body", "chest"] }],
    ["empty locations", { "body.locations": [] }],
    ["unknown quality", { "body.qualities": ["sparkly"] }],
    ["nothing plus a quality", { "body.qualities": ["nothing", "squeeze"] }],
    ["fractional intensity", { "body.intensity": 5.5 }],
    ["intensity over 10", { "body.intensity": 11 }],
    ["fractional valence", { "affect.valence": 0.5 }],
    ["arousal below 0", { "affect.arousal": -1 }],
    ["unknown word", { "affect.word": "fear.dread_x" }],
    ["word without confidence", { "affect.word_confidence": null }],
    ["confidence without word", { "affect.word": null }],
    ["'unknown' word, guessed", {
      "affect.word": "unknown",
      "affect.word_confidence": "guess",
    }],
    ["unknown confidence", { "affect.word_confidence": "maybe" }],
    ["unknown urge", { urge: "dance" }],
    ["head_mode as text", { head_mode: "5" }],
    ["no context_tag", { context_tag: null }],
    ["unknown context_tag", { context_tag: "garden" }],
    ["context_other without other", { context_other: "kitchen" }],
    ["context_other too long", {
      context_tag: "other",
      context_other: "x".repeat(41),
    }],
    ["empty note string", { note: "" }],
    ["note over 160 code points", { note: "x".repeat(161) }],
    ["untouched with an unknown field", { untouched: ["mood"] }],
    ["untouched twice", { untouched: ["head_mode", "head_mode"] }],
    ["untouched missing", { untouched: undefined }],
    ["ui theme not a hash", { "ui.theme": "calm" }],
    ["ui intensity unknown", { "ui.intensity": "dial" }],
    ["ui options unknown", { "ui.options": "carousel" }],
    ["ui figure missing", { "ui.figure": undefined }],
    ["negative latency", { latency_sec: -1 }],
    ["fractional latency", { latency_sec: 1.5 }],
    ["hidden longer than latency", { hidden_sec: 15 }],
    ["abandoned but not skipped", { abandoned: true }],
    ["skipped with answers", { skipped: true }],
    ["skipped with one answer left", { ...SKIPPED, note: "kitchen" }],
  ];
  for (const [name, patch] of cases) {
    assertEquals(validWith(patch), false, name);
  }
});

Deno.test("entry validation - what the form produces stays valid", () => {
  assertEquals(validWith({}), true);
  assertEquals(validWith(SKIPPED), true);
  assertEquals(validWith({ ...SKIPPED, abandoned: true }), true);
  assertEquals(
    validWith({
      "affect.word": "unknown",
      "affect.word_confidence": "unknown",
    }),
    true,
  );
  assertEquals(
    validWith({ "affect.word": "fear", "affect.word_confidence": "unknown" }),
    true,
  );
  assertEquals(
    validWith({ "affect.word": null, "affect.word_confidence": null }),
    true,
  );
  assertEquals(
    validWith({
      "body.locations": ["nowhere"],
      "body.qualities": ["cant_tell"],
    }),
    true,
  );
  assertEquals(
    validWith({ context_tag: "other", context_other: "кухня" }),
    true,
  );
  assertEquals(validWith({ context_tag: "other", context_other: null }), true);
  assertEquals(validWith({ urge: null, note: null, ui: null }), true);
  assertEquals(
    validWith({ ts: "2026-10-07T10:00:00.123Z", untouched: [] }),
    true,
  );
  assertEquals(validWith({ hidden_sec: 14 }), true);
  // The stop-list is an input rule: a saved note never turns invalid when
  // the list changes (ui.md §8.2)
  assertEquals(validWith({ note: "because I was late" }), true);
});

Deno.test("entry validation - a stopped check-in: answers before stopped_at, null after", () => {
  const partial = (patch: Record<string, unknown>) =>
    validWith({
      skipped: true,
      stopped_at: "arousal",
      untouched: ["intensity"],
      ui: null,
      "body.qualities": ["squeeze"],
      "body.intensity": 5,
      "affect.valence": -1,
      "affect.arousal": null,
      "affect.word": null,
      "affect.word_confidence": null,
      urge: null,
      head_mode: null,
      context_tag: null,
      context_other: null,
      note: null,
      ...patch,
    });
  assertEquals(partial({}), true);
  assertEquals(partial({ "affect.arousal": 4 }), false, "arousal not reached");
  assertEquals(partial({ head_mode: 5 }), false, "head_mode not reached");
  assertEquals(partial({ context_tag: "work" }), false, "context not reached");
  assertEquals(
    partial({ untouched: ["arousal"] }),
    false,
    "untouched not reached",
  );
  assertEquals(partial({ "body.qualities": null }), false, "qualities reached");
  assertEquals(partial({ stopped_at: "step5" }), false, "unknown stop");
  assertEquals(partial({ stopped_at: null }), false, "answers need stopped_at");
  assertEquals(
    partial({ stopped_at: "locations" }),
    false,
    "stopped on step 1 keeps nothing",
  );
  assertEquals(validWith({ ...SKIPPED, stopped_at: "locations" }), true);
  assertEquals(validWith({ stopped_at: "note" }), false, "saved: no stop");
});

Deno.test("entry validation - ui.copy: the instrument's wording and screens version", () => {
  // 6: a slider answers only on a still tap (data.md §3.6)
  assertEquals(COPY_VERSION, 6);
  assertEquals(validWith({ "ui.copy": COPY_VERSION }), true);
  assertEquals(validWith({ "ui.copy": undefined }), true, "older: counts as 1");
  for (const bad of [0, 1.5, "2", null]) {
    assertEquals(validWith({ "ui.copy": bad }), false, String(bad));
  }
});

Deno.test("entry validation - ui.layout: phone, wide, short or mixed; missing = unknown", () => {
  for (const layout of UI_LAYOUTS) {
    assertEquals(validWith({ "ui.layout": layout }), true, layout);
  }
  assertEquals(validWith({ "ui.layout": undefined }), true, "before copy 6");
  for (const bad of ["tablet", "Phone", 1, null, ["phone"]]) {
    assertEquals(validWith({ "ui.layout": bad }), false, String(bad));
  }
  // Keys this build does not know stay readable: a newer app may add some
  assertEquals(validWith({ "ui.density": "compact" }), true);
});

Deno.test("entry validation - a check-in skipped on step 1 keeps its ui, and nothing else", () => {
  const step1 = { ...SKIPPED, stopped_at: "locations" };
  assertEquals(validWith({ ...step1, ui: FIXTURE.ui }), true, "copy 6 on");
  assertEquals(
    validWith({ ...SKIPPED, ui: FIXTURE.ui }),
    true,
    "no stopped_at",
  );
  assertEquals(validWith(step1), true, "written before copy 6: null");
  assertEquals(
    validWith({ ...step1, abandoned: true, ui: FIXTURE.ui }),
    true,
    "abandoned on step 1",
  );
  assertEquals(validWith({ ...step1, ui: undefined }), false, "ui missing");
  assertEquals(
    validWith({ ...step1, ui: { ...FIXTURE.ui, layout: "tablet" } }),
    false,
    "its ui is checked too",
  );
  assertEquals(
    validWith({ ...step1, ui: FIXTURE.ui, untouched: [] }),
    false,
    "still no answers",
  );
});

Deno.test("entry - readEntry: current, newer, invalid; never throws", () => {
  const v2 = JSON.parse(
    Deno.readTextFileSync(new URL("./fixtures/entry.v2.json", import.meta.url)),
  );
  // Every released version's fixture reads as current (data.md §8.1)
  const ok = readEntry(v2);
  assertEquals(ok.kind, "ok");
  assertEquals(ok.kind === "ok" && ok.entry.id, v2.id);

  for (const schema_v of [KNOWN_MAX_SCHEMA_V + 1, 99]) {
    assertEquals(readEntry({ ...v2, schema_v, anything: "new" }), {
      kind: "newer",
      schema_v,
    });
  }
  for (
    const value of [
      { ...v2, ts: "yesterday" },
      { ...v2, schema_v: 1 },
      null,
      "x",
      [],
    ]
  ) {
    assertEquals(readEntry(value).kind, "invalid", JSON.stringify(value));
  }
});

// The corpora of ui.md §8.2 live in i18n/note-stopwords_test.ts

Deno.test("entry - skipped, full and longest-note entries encrypt to the same length", async () => {
  const full: EntryV2 = JSON.parse(
    Deno.readTextFileSync(new URL("./fixtures/entry.v2.json", import.meta.url)),
  );
  const skipped = {
    ...full,
    skipped: true,
    body: { locations: [], qualities: [], intensity: null },
    affect: { valence: null, arousal: null, word: null, word_confidence: null },
    urge: null,
    head_mode: null,
    context_tag: null,
    context_other: null,
    note: null,
    untouched: [],
  } as unknown as EntryV2;
  const longest = { ...full, note: "ж".repeat(160) };
  const dek = await importDek(crypto.getRandomValues(new Uint8Array(32)));
  const lengths = [];
  for (const entry of [skipped, full, longest]) {
    const { ciphertext } = await encryptEntry(
      dek,
      entry,
      crypto.randomUUID(),
      1,
    );
    lengths.push(ciphertext.length);
  }
  // 2 048 bytes of padded plaintext + the 16-byte tag: length says nothing
  assertEquals(lengths, [2064, 2064, 2064]);
});

Deno.test("dictionaries - the 2026-10-09 vocabulary: appended keys, step 2 ≤ 24 options", () => {
  const qualities = forInput(QUALITIES).map((q) => q.key);
  // Resource sensations come right before the null answers
  assertEquals(qualities.slice(-4), [
    "spaciousness",
    "steadiness",
    "nothing",
    "cant_tell",
  ]);
  assertEquals(qualities.length <= 24, true, String(qualities.length));
  const joy = WORDS.find((w) => w.key === "joy")!;
  assertEquals(joy.label.en, "joy / ease");
  assertEquals(joy.l2.map((w) => w.key).slice(-2), ["pride", "hope"]);
  assertEquals(
    joy.l2.findIndex((w) => w.key === "calm"),
    2,
    "keys keep places",
  );
  assertEquals(BODY_ZONES.some((z) => z.key === "head_back"), true);
  assertEquals(validWith({ "body.locations": ["head_back", "neck"] }), true);
  assertEquals(validWith({ "affect.word": "joy.hope" }), true);
  assertEquals(validWith({ "body.qualities": ["steadiness"] }), true);
});

Deno.test("dictionaries - a retired key leaves the input but old entries stay valid", () => {
  const joy = WORDS.find((w) => w.key === "joy")!;
  const relief = joy.l2.find((w) => w.key === "relief")!;
  const hug = URGES.find((u) => u.key === "hug")!;
  relief.retired = true;
  hug.retired = true;
  try {
    assertEquals(forInput(joy.l2).some((w) => w.key === "relief"), false);
    assertEquals(forInput(joy.l2).length, joy.l2.length - 1);
    assertEquals(forInput(URGES).includes(hug), false);
    assertEquals(
      validWith({
        "affect.word": "joy.relief",
        "affect.word_confidence": "sure",
        urge: "hug",
      }),
      true,
    );
  } finally {
    delete relief.retired;
    delete hug.retired;
  }
});
