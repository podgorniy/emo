// SPDX-License-Identifier: AGPL-3.0-or-later
/** The sync dot's states, looks, legend and time (ui.md §3). */
import { assert, assertEquals } from "@std/assert";
import {
  announced,
  DOT_STATES,
  type DotInput,
  type DotState,
  dotState,
  GLYPH_OF,
  GLYPHS,
  LEGEND_KEY,
  syncTime,
} from "./syncDot.ts";
import { MESSAGE_KEYS } from "../../../shared/i18n/keys.ts";
import { uiEn } from "../../../shared/i18n/ui.en.ts";
import { uiRu } from "../../../shared/i18n/ui.ru.ts";
import { uiUk } from "../../../shared/i18n/ui.uk.ts";
import { STOP_PHRASES } from "../../../shared/i18n/note-stopwords.ts";

const base: DotInput = {
  signedOut: false,
  updateRequired: false,
  offline: false,
  deviceOnline: true,
  running: false,
  status: "synced",
};

Deno.test("sync dot - the first state that applies wins", () => {
  // One input per state, each with everything below it in force too
  const all: DotInput = {
    signedOut: true,
    updateRequired: true,
    offline: true,
    deviceOnline: false,
    running: true,
    status: "stale",
  };
  const ladder: [DotState, DotInput][] = [
    ["signedOut", all],
    ["update", { ...all, signedOut: false }],
    ["offline", { ...all, signedOut: false, updateRequired: false }],
    ["unreachable", {
      ...all,
      signedOut: false,
      updateRequired: false,
      deviceOnline: true,
    }],
    ["sending", { ...base, running: true, status: "stale" }],
    ["stale", { ...base, status: "stale" }],
    ["waiting", { ...base, status: "pending" }],
    ["synced", base],
  ];
  assertEquals(ladder.map(([s]) => s), [...DOT_STATES]);
  for (const [expected, input] of ladder) {
    assertEquals(dotState(input), expected);
  }
  assertEquals(
    dotState({ ...base, running: true, offline: true }),
    "unreachable",
  );
  assertEquals(
    dotState({ ...base, offline: true, updateRequired: true }),
    "update",
  );
});

Deno.test("sync dot - no answer: offline when the device says so, else unreachable", () => {
  assertEquals(
    dotState({ ...base, offline: true, deviceOnline: true }),
    "unreachable",
  );
  assertEquals(
    dotState({ ...base, offline: true, deviceOnline: false }),
    "offline",
  );
  // The device's own state alone never makes a state: Emo answered
  assertEquals(dotState({ ...base, deviceOnline: false }), "synced");
});

Deno.test("sync dot - only the loud transitions are announced", () => {
  assertEquals(announced("synced", "waiting"), false);
  assertEquals(announced("waiting", "synced"), false);
  assertEquals(announced("waiting", "stale"), true);
  assertEquals(announced("stale", "synced"), true);
  assertEquals(announced("synced", "signedOut"), true);
  assertEquals(announced("update", "update"), false);
  assertEquals(announced(null, "stale"), false);
});

Deno.test("sync dot - unreachable is never announced (it would chatter)", () => {
  for (const other of ["waiting", "offline", "synced", "sending"] as const) {
    assertEquals(announced(other, "unreachable"), false, `${other} →`);
    assertEquals(announced("unreachable", other), false, `→ ${other}`);
  }
});

Deno.test("sync dot - the input has no entry, draft or reminder field", () => {
  // Compile time: a field added to DotInput breaks this object
  const keys: Record<keyof DotInput, true> = {
    signedOut: true,
    updateRequired: true,
    offline: true,
    deviceOnline: true,
    running: true,
    status: true,
  };
  assertEquals(Object.keys(keys).length, 6);
});

Deno.test("sync dot - every state has a look, every look a legend line", () => {
  for (const state of DOT_STATES) {
    assert(GLYPHS.includes(GLYPH_OF[state]), state);
  }
  // Every look is used, and the legend has exactly one row per look
  assertEquals(
    new Set(DOT_STATES.map((s) => GLYPH_OF[s])),
    new Set(GLYPHS),
  );
  assertEquals(GLYPHS.length, 5);
  assertEquals(new Set(Object.values(LEGEND_KEY)).size, 5);
  for (const glyph of GLYPHS) {
    assert(MESSAGE_KEYS.includes(LEGEND_KEY[glyph]), glyph);
  }
  // Waiting and offline no longer look alike; nor stale and waiting
  assert(GLYPH_OF.waiting !== GLYPH_OF.offline);
  assert(GLYPH_OF.stale !== GLYPH_OF.waiting);
});

/** The note's stop-phrases, whole words (methodology.md §2.10) */
const stop = new RegExp(
  `(?<![\\p{L}'])(${STOP_PHRASES.join("|")})(?![\\p{L}'])`,
  "iu",
);

Deno.test("sync dot - no digits, no parameter but {time}, no 'why' in its copy", () => {
  const sync = MESSAGE_KEYS.filter((k) =>
    k.startsWith("home.sync.") || k === "home.wordmark.aria" ||
    k === "common.unreachable" || k === "errors.unreachable"
  );
  assert(sync.length > 20);
  for (const [locale, ui] of [["en", uiEn], ["ru", uiRu], ["uk", uiUk]]) {
    for (const key of sync) {
      const text = (ui as Record<string, string>)[key];
      assertEquals(/\d/.test(text), false, `${locale} ${key}: ${text}`);
      for (const [param] of text.matchAll(/\{[^}]*\}/g)) {
        assertEquals(param, "{time}", `${locale} ${key}: ${text}`);
      }
      assertEquals(stop.exec(text)?.[0], undefined, `${locale} ${key}`);
    }
  }
});

Deno.test("sync dot - {time}: relative under an hour, then absolute", () => {
  const now = new Date(2026, 9, 9, 15, 0);
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  assertEquals(syncTime(ago(0.5), "en-GB", "just now", now), "just now");
  assertEquals(syncTime(ago(5), "en-GB", "just now", now), "5 min ago");
  assertEquals(syncTime(ago(90), "en-GB", "just now", now), "13:30");
  const y = syncTime(new Date(2026, 9, 8, 14, 32), "en-GB", "now", now);
  assertEquals(y, "yesterday 14:32");
  const older = syncTime(new Date(2026, 9, 7, 14, 32), "en-GB", "now", now);
  assert(/7 Oct/.test(older) && older.includes("14:32"), older);
  assertEquals(
    syncTime(new Date(2026, 9, 8, 14, 32), "ru", "now", now),
    "вчера 14:32",
  );
});
