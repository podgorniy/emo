// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The History pane's data (ui.md): the words for every null and
 * "don't know" answer (ui.md §15.8), nothing evaluative on a row (ui.md §15.6), each
 * entry's own local day across DST and travel and the "UTC±h" marker only
 * for travel (ui.md §15.5), pages rounded up to whole days (ui.md §15.12), delete as a
 * tombstone without a draft (ui.md §15.10), the draft gate (ui.md §15.14), and loading and
 * reconciling against the real server (ui.md §15.13).
 */
import "fake-indexeddb/auto";
import { assert, assertEquals } from "@std/assert";
import { startTestServer } from "../../../server/testing/harness.ts";
import { QUALITIES } from "../../../shared/dictionaries.ts";
import type { EntryV2 } from "../../../shared/entry.ts";
import { t as translate } from "../../../shared/i18n/format.ts";
import type { MessageKey } from "../../../shared/i18n/keys.ts";
import { apiPutKeyring } from "./api.ts";
import { setupKeyring } from "./crypto.ts";
import {
  deleteStoredDraft,
  getAllEntries,
  getEntry,
  getOutboxItems,
  getStoredDraft,
  putEntry,
  wipeLocalDatabase,
} from "./db.ts";
import { forgetDraftInMemory, loadDraft } from "./draft.ts";
import * as m from "./machine.ts";
import { openCheckIn, saveCheckIn, stopCheckIn } from "./checkin.ts";
import { runSync, tombstoneEntry } from "./sync.ts";
import {
  dayLabel,
  deleteFromHistory,
  groupByDay,
  hiddenCounts,
  historyGate,
  type HistoryItem,
  loadHistory,
  localDay,
  type OffsetAt,
  pageEnd,
  reconcileHistory,
  rowView,
  timeLabel,
  tzLabel,
  whenLabel,
} from "./history.ts";
import {
  metaText,
  recordFields,
  type TrackField,
  wordText,
} from "./historyRecord.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const en = (key: MessageKey, params?: Record<string, string | number>) =>
  translate("en", key, params);
const ru = (key: MessageKey, params?: Record<string, string | number>) =>
  translate("ru", key, params);
/** ICU puts a narrow no-break space before "PM" */
const plain = (s: string | null) => s?.replace(/\s/g, " ");

/** Europe/Kyiv: UTC+3 in summer, UTC+2 from 2026-10-25 01:00 UTC */
const kyiv: OffsetAt = (ms) =>
  ms >= Date.parse("2026-03-29T01:00:00Z") &&
    ms < Date.parse("2026-10-25T01:00:00Z")
    ? 180
    : 120;

let n = 0;
function entry(over: Partial<EntryV2> = {}): EntryV2 {
  n++;
  return {
    schema_v: 2,
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    ts: "2026-10-09T11:10:00.000Z",
    tz_offset_min: 180,
    trigger: "manual",
    reminder_id: null,
    latency_sec: 40,
    hidden_sec: 0,
    skipped: false,
    abandoned: false,
    untouched: [],
    ui: null,
    body: {
      locations: ["throat", "chest"],
      qualities: ["lump", "squeeze"],
      intensity: 8,
    },
    affect: {
      valence: -2,
      arousal: 9,
      word: "fear.anxiety",
      word_confidence: "guess",
    },
    urge: "shrink",
    head_mode: 2,
    context_tag: "work",
    context_other: null,
    note: "call with manager\nand then the bus",
    ...over,
  };
}

function skipped(over: Partial<EntryV2> = {}): EntryV2 {
  return entry({
    skipped: true,
    untouched: null,
    body: null,
    affect: null,
    urge: null,
    head_mode: null,
    context_tag: null,
    note: null,
    ...over,
  });
}

const item = (e: EntryV2, unsynced = false): HistoryItem => ({
  entry: e,
  at: Date.parse(e.ts),
  day: localDay(e),
  seq: 1,
  ct: "",
  unsynced,
});

const field = (e: EntryV2, label: string) =>
  recordFields(e, "en", en).find((f) => f.label === label);
const text = (e: EntryV2, label: string) => {
  const f = field(e, label);
  return f?.kind === "text"
    ? f.text
    : f?.kind === "word"
    ? wordText(e, "en", en)
    : undefined;
};

Deno.test("history - every null and 'don't know' answer as a plain word (ui.md §15.8)", () => {
  const where = (locations: string[]) =>
    rowView(
      entry({ body: { locations, qualities: ["nothing"], intensity: 0 } }),
      "en",
      en,
      kyiv,
    ).body;
  assertEquals(where(["nowhere"]), "nowhere — nothing");
  assertEquals(where([]), "nowhere — nothing"); // legacy []
  assertEquals(where(["whole_body"]), "whole body — nothing");
  const like = (qualities: string[]) =>
    text(
      entry({ body: { locations: ["belly"], qualities, intensity: 3 } }),
      "QUALITY",
    );
  assertEquals(like(["nothing"]), "nothing");
  assertEquals(like(["cant_tell"]), "can't tell");

  const word = (w: string | null, c: "guess" | "sure" | "unknown" | null) =>
    wordText(
      entry({
        affect: { valence: 0, arousal: 5, word: w, word_confidence: c },
      }),
      "en",
      en,
    );
  assertEquals(word("unknown", "unknown"), "don't know");
  // ui.md §15.7: the certainty follows every word but "don't know"
  assertEquals(word("empty", "sure"), "empty — sure");
  assertEquals(word("empty.numbness", "guess"), "empty · numbness — guessing");
  assertEquals(word("fear.anxiety", "guess"), "fear · anxiety — guessing");
  assertEquals(word(null, null), "not chosen");
  assertEquals(text(entry({ urge: null }), "URGE"), "not chosen");
  assertEquals(text(entry({ urge: "nothing" }), "URGE"), "nothing");

  // An untouched slider: the dashed thumb at the midpoint, "not moved"
  const still = field(
    entry({ untouched: ["head_mode"], head_mode: 5 }),
    "ATTENTION",
  ) as TrackField;
  assertEquals([still.kind, still.untouched, still.at], ["track", true, 0.5]);
  assertEquals(still.aria, "ATTENTION: not moved, in the middle");
  assertEquals(en("history.item.notMoved"), "not moved");

  assertEquals(rowView(skipped(), "en", en).body, "Skipped");
  assertEquals(
    rowView(skipped({ abandoned: true }), "en", en).body,
    "Form left open",
  );
  assertEquals(recordFields(skipped(), "en", en), []);
  assertEquals(recordFields(skipped({ abandoned: true }), "en", en), []);

  // A retired key keeps its label (data.md §8.2)
  const lump = QUALITIES.find((q) => q.key === "lump")!;
  lump.retired = true;
  try {
    assertEquals(like(["lump"]), "lump");
  } finally {
    delete lump.retired;
  }

  // Null answers are text like any other answer: same kind, same element
  for (
    const e of [entry({ urge: null }), entry({ urge: "nothing" }), entry()]
  ) {
    assertEquals(field(e, "URGE")?.kind, "text");
  }
});

Deno.test("history - the open record, in the order it was recorded (ui.md §15.7)", () => {
  const e = entry({
    trigger: "random",
    reminder_id: "0192f1c4-7b43-7000-8000-0000000000aa",
    context_tag: "other",
    context_other: "balcony",
  });
  const fields = recordFields(e, "en", en);
  assertEquals(fields.map((f) => f.label), [
    "BODY",
    "QUALITY",
    "INTENSITY",
    "TONE",
    "CHARGE",
    "WORD",
    "URGE",
    "ATTENTION",
    "SITUATION",
    "NOTE",
  ]);
  assertEquals(text(e, "BODY"), "throat, chest");
  assertEquals(text(e, "QUALITY"), "tight, lump");
  assertEquals(text(e, "SITUATION"), "other: balcony");
  assertEquals(text(e, "NOTE"), "call with manager\nand then the bus");
  const valence = field(e, "TONE") as TrackField;
  assertEquals([valence.bipolar, valence.center], [true, "neutral"]);
  assertEquals(valence.aria, "TONE: closer to “unpleasant”");
  assertEquals(
    (field(e, "INTENSITY") as TrackField).aria,
    "INTENSITY: closer to “very strong”",
  );
  // No number anywhere a person or a screen reader meets
  for (const f of fields) {
    if (f.kind === "track") assert(!/\d/.test(f.aria + f.low + f.high), f.aria);
  }
  assertEquals(
    metaText(item(e, true), en, kyiv),
    "From a reminder · Not synced yet",
  );
  assertEquals(
    metaText(item(entry({ trigger: "after_event" })), en, kyiv),
    "After an event",
  );
  // No note: no NOTE row (an empty optional field is not an answer)
  assertEquals(
    recordFields(entry({ note: null }), "en", en).at(-1)?.label,
    "SITUATION",
  );
});

Deno.test("history - a row is an index: no valence, arousal or word (ui.md §15.6)", () => {
  const e = entry({
    trigger: "after_event",
    context_tag: "other",
    context_other: "balcony",
  });
  const row = rowView(e, "en", en, kyiv);
  assertEquals({ ...row, time: plain(row.time) }, {
    time: "2:10 PM",
    tz: null,
    situation: "balcony",
    afterEvent: true,
    body: "throat, chest — tight, lump",
    note: "“call with manager”",
  });
  const shown = JSON.stringify(row);
  for (const word of ["fear", "anxiety", "guessing", "unpleasant", "9", "-2"]) {
    assert(!shown.includes(word), word);
  }
  assertEquals(rowView(e, "ru", ru, kyiv).note, "«call with manager»");
  assertEquals(rowView(e, "ru", ru, kyiv).time, "14:10");
});

Deno.test("history - each entry's own local day across a DST change (ui.md §15.5)", () => {
  // Before and after Kyiv's clocks went back on 2026-10-25
  const summer = entry({ ts: "2026-10-24T22:30:00.000Z", tz_offset_min: 180 });
  const winter = entry({ ts: "2026-10-25T21:30:00.000Z", tz_offset_min: 120 });
  const late = entry({ ts: "2026-10-25T22:30:00.000Z", tz_offset_min: 120 });
  assertEquals([localDay(summer), localDay(winter), localDay(late)], [
    "2026-10-25",
    "2026-10-25",
    "2026-10-26",
  ]);
  assertEquals(timeLabel(summer, "ru"), "1:30");
  assertEquals(timeLabel(winter, "ru"), "23:30");
  // DST alone never shows a marker
  for (const e of [summer, winter, late]) {
    assertEquals(tzLabel(e, en, kyiv), null);
  }

  const items = [late, winter, summer].map((e) => item(e));
  assertEquals(
    groupByDay(items).map((d) => [d.day, d.items.length]),
    [["2026-10-26", 1], ["2026-10-25", 2]],
  );
  // "Today" and "Yesterday" are this device's dates; other days show weekday
  const now = Date.parse("2026-10-26T10:00:00Z");
  assertEquals(dayLabel("2026-10-26", "en", en, now, kyiv), "Today");
  assertEquals(dayLabel("2026-10-25", "en", en, now, kyiv), "Yesterday");
  assertEquals(dayLabel("2026-10-20", "en", en, now, kyiv), "Tue, Oct 20");
  assertEquals(
    dayLabel("2025-12-31", "en", en, now, kyiv),
    "Wed, Dec 31, 2025",
  );
  // Days without check-ins are simply absent: no gap rows
  assertEquals(groupByDay([item(late), item(summer)]).length, 2);
});

Deno.test("history - travel: the entry's own clock, marked with its offset (ui.md §15.5)", () => {
  // Saved in New York (UTC−4) at 22:30, viewed on a phone set to Kyiv
  const ny = entry({ ts: "2026-10-21T02:30:00.000Z", tz_offset_min: -240 });
  assertEquals(localDay(ny), "2026-10-20");
  assertEquals(timeLabel(ny, "ru"), "22:30");
  assertEquals(tzLabel(ny, en, kyiv), "UTC-4");
  const delhi = entry({ ts: "2026-10-21T04:30:00.000Z", tz_offset_min: 330 });
  assertEquals(tzLabel(delhi, en, kyiv), "UTC+5:30");
  assertEquals(rowView(delhi, "ru", ru, kyiv).tz, "UTC+5:30");
  assertEquals(metaText(item(ny), en, kyiv), "Without a reminder · UTC-4");
  assertEquals(
    plain(whenLabel(ny, "en", Date.parse("2026-10-22T00:00:00Z"), kyiv)),
    "Tue, Oct 20, 10:30 PM",
  );
});

Deno.test("history - pages: 30 check-ins, rounded up to whole days (ui.md §15.12)", () => {
  const day = (d: number, count: number) =>
    Array.from({ length: count }, (_, i) =>
      item(entry({
        ts: new Date(Date.UTC(2026, 9, d, 20 - i % 20, 59 - Math.floor(i / 20)))
          .toISOString(),
        tz_offset_min: 0,
      })));
  // 20 on the 9th, 15 on the 8th: the first page takes all 35
  const a = [...day(9, 20), ...day(8, 15)];
  assertEquals(pageEnd(a, 0), 35);
  // 10 + 10 + 10 end on a day: exactly 30, then the rest
  const b = [...day(9, 10), ...day(8, 10), ...day(7, 10), ...day(6, 5)];
  assertEquals(pageEnd(b, 0), 30);
  assertEquals(pageEnd(b, 30), 35);
  assertEquals(pageEnd([], 0), 0);
  // What is on screen stays: size 0 only completes the last day
  assertEquals(pageEnd(a, 5, 0), 20);
});

async function ready(email: string) {
  await wipeLocalDatabase();
  forgetDraftInMemory();
  const server = startTestServer();
  const restoreFetch = server.installFetch();
  const { accountId } = await server.signUp(email);
  const setup = await setupKeyring(accountId, "a passphrase 1");
  await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
  const save = async (note: string) => {
    let d = await openCheckIn(accountId, 1, "manual", null);
    d = m.toggleLocation(d, "chest", Date.now());
    d = m.toggleQuality(d, "squeeze", Date.now());
    d = m.toggleContext(d, "work", Date.now());
    d = m.setNote(d, note, Date.now());
    return await saveCheckIn(accountId, 1, d, null);
  };
  return { server, restoreFetch, accountId, save };
}

Deno.test({
  name:
    "history - delete: a tombstone and an outbox delete, never a draft (ui.md §15.10)",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, save } = await ready("delete@example.org");
    try {
      const kept = await save("hallway");
      const gone = await save("kitchen");
      await runSync(accountId);
      const data = await loadHistory(accountId);
      assertEquals(data.items.length, 2);

      // Offline: the row leaves the list at once, the delete is queued
      const online = globalThis.fetch;
      globalThis.fetch = () => Promise.reject(new TypeError("offline"));
      const done = deleteFromHistory(data, gone.id, accountId);
      assertEquals(data.items.map((i) => i.entry.id), [kept.id]);
      await done;
      await runSync(accountId).catch(() => {});
      globalThis.fetch = online;

      const row = await getEntry(gone.id);
      assertEquals([row?.deleted, row?.ct_b64, row?.nonce_b64], [
        true,
        null,
        null,
      ]);
      const outbox = await getOutboxItems();
      assertEquals(
        outbox.filter((o) => o.id === gone.id).map((o) => o.op),
        ["delete"],
      );
      assertEquals(await getStoredDraft(), null);
      assertEquals(await loadDraft(accountId), null);

      // The deleted check-in does not come back with the next reconcile
      assertEquals(await reconcileHistory(data, accountId), []);
      assertEquals(data.items.map((i) => i.entry.id), [kept.id]);

      // The shared helper alone: the same, and it never writes a draft
      const { sent } = await tombstoneEntry(kept.id, accountId);
      await sent;
      assertEquals((await getEntry(kept.id))?.deleted, true);
      assertEquals(await getStoredDraft(), null);
      assertEquals((await getAllEntries()).every((e) => e.deleted), true);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "history - load, then reconcile after sync, saves and deletes (ui.md §15.12–§15.14)",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId, save } = await ready(
      "reconcile@example.org",
    );
    try {
      const first = await save("one");
      await runSync(accountId);
      // Offline save: still in the outbox, shown with the ring
      const online = globalThis.fetch;
      globalThis.fetch = () => Promise.reject(new TypeError("offline"));
      const second = await save("two");
      await runSync(accountId).catch(() => {});
      globalThis.fetch = online;

      // One row this device could not read: counted, never listed
      await putEntry({
        id: "00000000-0000-4000-8000-00000000ffff",
        seq: 1,
        key_version: 1,
        nonce_b64: "AAAAAAAAAAAAAAAA",
        ct_b64: "AAAA",
        deleted: false,
        received_at: "2026-10-09T10:00:00.000Z",
        check: "undecryptable",
      });

      const data = await loadHistory(accountId);
      assertEquals(data.items.map((i) => [i.entry.id, i.unsynced]), [
        [second.id, true],
        [first.id, false],
      ]);
      assertEquals(hiddenCounts(data), { corrupt: 1, newer: 0 });

      // Saved on another tab, then everything synced
      const third = await save("three");
      await runSync(accountId);
      assertEquals(await reconcileHistory(data, accountId), []);
      assertEquals(data.items.map((i) => [i.entry.note, i.unsynced]), [
        ["three", false],
        ["two", false],
        ["one", false],
      ]);
      assert(data.items.every((i) => i.seq > 0));

      // Deleted on another device: gone after the pull
      const other = (await getEntry(third.id))!;
      await putEntry({
        ...other,
        deleted: true,
        ct_b64: null,
        nonce_b64: null,
        seq: other.seq + 10,
      });
      assertEquals(await reconcileHistory(data, accountId), [third.id]);
      assertEquals(data.items.length, 2);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "history - hidden while a check-in is in progress, here or elsewhere (ui.md §15.14)",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await ready("gate@example.org");
    const nav = globalThis.navigator as unknown as { locks?: unknown };
    const saved = Object.getOwnPropertyDescriptor(nav, "locks");
    try {
      const T0 = Date.now();
      assertEquals(await historyGate(accountId, 1, T0), { kind: "list" });

      // Started, then Close: the draft stays and gates the list
      let d = await openCheckIn(accountId, 1, "after_event", null, T0);
      d = m.toggleLocation(d, "jaw", T0);
      assertEquals(await historyGate(accountId, 1, T0 + 60_000), {
        kind: "draft",
        trigger: "after_event",
        reminderId: null,
      });
      // Saved or skipped: the list again
      await stopCheckIn(accountId, 1, d, T0 + 70_000);
      assertEquals(await historyGate(accountId, 1, T0 + 80_000), {
        kind: "list",
      });

      // Saved in another tab: the stale copy in this tab's memory does not gate
      await openCheckIn(accountId, 1, "manual", null, T0 + 80_000);
      await deleteStoredDraft();
      assertEquals(await historyGate(accountId, 1, T0 + 85_000), {
        kind: "list",
      });

      // A draft idle for 10 minutes is finalized as left open first (one
      // from a reminder: a self-started one never touched leaves nothing)
      await openCheckIn(
        accountId,
        1,
        "random",
        "0192f1c4-7b43-7000-8000-0000000000aa",
        T0 + 90_000,
      );
      assertEquals(
        await historyGate(accountId, 1, T0 + 90_000 + 11 * 60_000),
        { kind: "list" },
      );
      const data = await loadHistory(accountId);
      assertEquals(
        data.items.map((i) => rowView(i.entry, "en", en).body).sort(),
        [
          "Form left open",
          "Skipped",
        ],
      );

      // Another tab holds the form (`emo-draft`): its own message
      await runSync(accountId);
      Object.defineProperty(nav, "locks", {
        value: {
          query: () =>
            Promise.resolve({ held: [{ name: "emo-draft" }], pending: [] }),
        },
        configurable: true,
      });
      assertEquals(await historyGate(accountId, 1), { kind: "otherWindow" });
    } finally {
      if (saved) Object.defineProperty(nav, "locks", saved);
      else delete nav.locks;
      restoreFetch();
    }
  },
});
