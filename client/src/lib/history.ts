// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The History pane's data: every check-in on this device decrypted in memory
 * (in the Worker of `decrypt.ts`, newest `seq` first), sorted newest first by
 * `ts`, grouped by each entry's own local day and shown about 30 at a time,
 * rounded up to whole days; then kept in step with sync, other tabs and other
 * devices. The formatters turn a row into the words on screen (the open
 * record's are in `historyRecord.ts`): null answers are plain words, and no
 * value is ever a number. Nothing decrypted is written anywhere.
 * Specification: ui.md §15.5, §15.12–§15.14, §15.17.
 */

import type { EntryV2 } from "../../../shared/entry.ts";
import {
  BODY_ZONES,
  CONTEXT_TAGS,
  type DictItem,
  type Locale,
  QUALITIES,
} from "../../../shared/dictionaries.ts";
import type { MessageKey } from "../../../shared/i18n/keys.ts";
import { ZONE_ORDER } from "./bodyFigure.ts";
import { finalizeIfAbandoned } from "./checkin.ts";
import {
  getAllEntries,
  getEntriesChangedSince,
  getOutboxItems,
  getStoredDraft,
  type OutboxItem,
  type StoredEntry,
} from "./db.ts";
import { decryptRows } from "./decrypt.ts";
import { forgetDraftInMemory, loadDraft } from "./draft.ts";
import { draftHeldElsewhere } from "./draftLock.ts";
import { tombstoneEntry } from "./sync.ts";

export type Translate = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

/** The device's UTC offset in minutes at an instant (injected by tests). */
export type OffsetAt = (ms: number) => number;
export const deviceOffset: OffsetAt = (ms) => -new Date(ms).getTimezoneOffset();

const MINUTE = 60_000;
const DAY = 86_400_000;

// ----- Loading and reconciling (ui.md §15.12, §15.13) -----

export interface HistoryItem {
  entry: EntryV2;
  /** `ts` in ms, and the entry's own local day ("2026-10-09") */
  at: number;
  day: string;
  seq: number;
  /** The ciphertext it came from: a changed one is decrypted again */
  ct: string;
  /** Still in the outbox: a hollow ring and "Not synced yet" */
  unsynced: boolean;
}

export interface HistoryData {
  /** Newest first by `ts`, ties by id */
  items: HistoryItem[];
  /** The highest `seq` read: a reconcile reads only what came after it */
  maxSeq: number;
  /** Rows not in the list (ui.md §15.14): unreadable or invalid, or from a newer app */
  hidden: Map<string, "corrupt" | "newer">;
  /** Deleted here: never back in the list, even from a merge under way */
  deleted: Set<string>;
}

const FLAGGED = new Set(["undecryptable", "invalid", "newer"]);

export function hiddenCounts(data: HistoryData) {
  let corrupt = 0;
  for (const kind of data.hidden.values()) if (kind === "corrupt") corrupt++;
  return { corrupt, newer: data.hidden.size - corrupt };
}

/** The entry's own local day: its `ts` shifted by its own offset. */
export function localDay(entry: EntryV2): string {
  return wallClock(entry).toISOString().slice(0, 10);
}

/** The entry's own wall-clock time, as a UTC date (format it in UTC). */
function wallClock(entry: EntryV2): Date {
  return new Date(Date.parse(entry.ts) + entry.tz_offset_min * MINUTE);
}

/** Newest first by `ts`; ties by id, so the order is stable */
export function compareItems(a: HistoryItem, b: HistoryItem): number {
  return b.at - a.at ||
    (a.entry.id === b.entry.id ? 0 : a.entry.id < b.entry.id ? 1 : -1);
}

/**
 * Takes `rows` in: tombstones and queued deletes leave the list, new or
 * changed ciphertext is decrypted, everything else keeps its decrypted
 * copy. With `ids` (every id still on this device), evicted rows leave too.
 * Returns the ids that left the list.
 */
async function absorb(
  data: HistoryData,
  rows: StoredEntry[],
  outbox: OutboxItem[],
  accountId: string,
  ids?: Set<string>,
): Promise<string[]> {
  const queued = new Set<string>();
  const deleting = new Set<string>();
  for (const o of outbox) (o.op === "delete" ? deleting : queued).add(o.id);
  const byId = new Map(data.items.map((i) => [i.entry.id, i]));
  const gone = new Set<string>();
  const fresh: Array<StoredEntry & { nonce_b64: string; ct_b64: string }> = [];

  for (const row of rows) {
    data.maxSeq = Math.max(data.maxSeq, row.seq);
    if (
      row.deleted || !row.nonce_b64 || !row.ct_b64 || deleting.has(row.id) ||
      data.deleted.has(row.id)
    ) {
      gone.add(row.id);
      data.hidden.delete(row.id);
    } else if (row.check && FLAGGED.has(row.check)) {
      gone.add(row.id);
      data.hidden.set(row.id, row.check === "newer" ? "newer" : "corrupt");
    } else {
      const known = byId.get(row.id);
      if (known?.ct === row.ct_b64) known.seq = row.seq;
      else {
        fresh.push(row as StoredEntry & { nonce_b64: string; ct_b64: string });
      }
    }
  }
  for (const id of deleting) gone.add(id);
  if (ids) {
    for (const id of byId.keys()) if (!ids.has(id)) gone.add(id);
    for (const id of data.hidden.keys()) {
      if (!ids.has(id)) data.hidden.delete(id);
    }
  }

  // Newest upload first; not uploaded yet (seq 0) before everything
  const rank = (r: StoredEntry) => r.seq || Number.MAX_SAFE_INTEGER;
  fresh.sort((a, b) => rank(b) - rank(a));
  const rowOf = new Map(fresh.map((r) => [r.id, r]));
  for (const read of await decryptRows(fresh, accountId)) {
    const row = rowOf.get(read.id)!;
    if (read.kind === "ok") {
      byId.set(read.id, {
        entry: read.entry,
        at: Date.parse(read.entry.ts),
        day: localDay(read.entry),
        seq: row.seq,
        ct: row.ct_b64,
        unsynced: false,
      });
      data.hidden.delete(read.id);
    } else {
      byId.delete(read.id);
      data.hidden.set(read.id, read.kind === "newer" ? "newer" : "corrupt");
    }
  }

  const left = [...gone].filter((id) => byId.delete(id));
  // A changed item is a new object, so the screen sees the change
  data.items = [...byId.values()].sort(compareItems)
    .filter((item) => !data.deleted.has(item.entry.id)).map((item) => {
      const unsynced = queued.has(item.entry.id);
      return item.unsynced === unsynced ? item : { ...item, unsynced };
    });
  return left;
}

/** Everything on this device, decrypted (ui.md §15.12 "Load"). */
export async function loadHistory(accountId: string): Promise<HistoryData> {
  const data: HistoryData = {
    items: [],
    maxSeq: 0,
    hidden: new Map(),
    deleted: new Set(),
  };
  const [rows, outbox] = await Promise.all([getAllEntries(), getOutboxItems()]);
  await absorb(data, rows, outbox, accountId);
  return data;
}

/**
 * After a sync pass, on return to the tab, or on `entries` from another tab
 * (ui.md §15.13): only rows after `maxSeq`, rows not uploaded yet, and the outbox.
 * Returns the ids that left the list.
 */
export async function reconcileHistory(
  data: HistoryData,
  accountId: string,
): Promise<string[]> {
  const [{ rows, ids }, outbox] = await Promise.all([
    getEntriesChangedSince(data.maxSeq),
    getOutboxItems(),
  ]);
  return await absorb(data, rows, outbox, accountId, ids);
}

/**
 * Delete from History (ui.md §15.10): the row leaves the list at once; the local
 * tombstone and the outbox `delete` follow in one transaction (never
 * waiting for a running pass), and the server hears in the background.
 * Never a draft: the form does not reopen.
 */
export async function deleteFromHistory(
  data: HistoryData,
  entryId: string,
  accountId: string,
): Promise<void> {
  data.deleted.add(entryId);
  data.items = data.items.filter((i) => i.entry.id !== entryId);
  try {
    await tombstoneEntry(entryId, accountId);
  } catch (err) {
    data.deleted.delete(entryId); // not deleted: it may come back
    throw err;
  }
}

// ----- Pages and days (ui.md §15.5, §15.12) -----

/** About the time between two weekly sessions (ui.md §15.12) */
export const PAGE = 30;

/**
 * Where the list ends once `shown` items are on screen and one more page is
 * asked for: `size` more, rounded up to the end of the last one's day.
 */
export function pageEnd(
  items: HistoryItem[],
  shown: number,
  size = PAGE,
): number {
  let end = Math.min(shown + size, items.length);
  while (
    end > 0 && end < items.length && items[end].day === items[end - 1].day
  ) {
    end++;
  }
  return end;
}

/** The items in days, in order; days without check-ins do not appear. */
export function groupByDay(
  items: HistoryItem[],
): Array<{ day: string; items: HistoryItem[] }> {
  const days: Array<{ day: string; items: HistoryItem[] }> = [];
  for (const item of items) {
    const last = days.at(-1);
    if (last?.day === item.day) last.items.push(item);
    else days.push({ day: item.day, items: [item] });
  }
  return days;
}

// ----- Words for dates and times (ui.md §15.5) -----

const formats = new Map<string, Intl.DateTimeFormat>();
function format(locale: Locale, options: Intl.DateTimeFormatOptions) {
  const key = locale + JSON.stringify(options);
  let f = formats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formats.set(key, f);
  }
  return f;
}

/** The device's local date at `now`. */
function deviceDay(now: number, offsetAt: OffsetAt): string {
  return new Date(now + offsetAt(now) * MINUTE).toISOString().slice(0, 10);
}

/** "Today", "Yesterday" (on this device), else "Thu, 9 Oct" (+ the year). */
export function dayLabel(
  day: string,
  locale: Locale,
  t: Translate,
  now = Date.now(),
  offsetAt: OffsetAt = deviceOffset,
): string {
  const today = deviceDay(now, offsetAt);
  if (day === today) return t("history.day.today");
  const yesterday = new Date(Date.parse(today) - DAY).toISOString().slice(
    0,
    10,
  );
  if (day === yesterday) return t("history.day.yesterday");
  return format(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
  }).format(Date.parse(day));
}

/**
 * "UTC+3" when the entry's own offset differs from this device's offset at
 * that instant: travel. DST alone never shows it.
 */
export function tzLabel(
  entry: EntryV2,
  t: Translate,
  offsetAt: OffsetAt = deviceOffset,
): string | null {
  const own = entry.tz_offset_min;
  if (own === offsetAt(Date.parse(entry.ts))) return null;
  const abs = Math.abs(own);
  const minutes = abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : "";
  return t("history.item.timezone", {
    offset: `${own < 0 ? "-" : "+"}${Math.floor(abs / 60)}${minutes}`,
  });
}

/** The time on the entry's own clock, in the UI language. */
export function timeLabel(entry: EntryV2, locale: Locale): string {
  return format(locale, { hour: "numeric", minute: "2-digit" })
    .format(wallClock(entry));
}

/** "Thu, 9 Oct, 14:10": the delete sheet's `{when}`. */
export function whenLabel(
  entry: EntryV2,
  locale: Locale,
  now = Date.now(),
  offsetAt: OffsetAt = deviceOffset,
): string {
  const sameYear =
    localDay(entry).slice(0, 4) === deviceDay(now, offsetAt).slice(0, 4);
  return format(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(wallClock(entry));
}

// ----- Words for answers (ui.md §15.6–§15.8) -----

const QUOTES: Record<Locale, [string, string]> = {
  en: ["“", "”"],
  ru: ["«", "»"],
  uk: ["«", "»"],
};

export function labelOf(
  items: DictItem[],
  key: string,
  locale: Locale,
): string {
  return items.find((i) => i.key === key)?.label[locale] ?? key;
}

/** `keys` in the order of `order`, as labels (unknown keys last) */
function listOf(
  keys: string[],
  order: string[],
  items: DictItem[],
  locale: Locale,
): string {
  const rank = (k: string) => (order.indexOf(k) + 1) || order.length + 1;
  return [...keys].sort((a, b) => rank(a) - rank(b))
    .map((k) => labelOf(items, k, locale)).join(", ");
}

/** Where: zones in the order of ui.md §7.5; legacy `[]` is "nowhere". */
export function whereText(locations: string[], locale: Locale): string {
  if (locations.length === 0) return labelOf(BODY_ZONES, "nowhere", locale);
  return listOf(locations, ZONE_ORDER, BODY_ZONES, locale);
}

/** What it is like: qualities in dictionary order. */
export function likeText(qualities: string[], locale: Locale): string {
  return listOf(qualities, QUALITIES.map((q) => q.key), QUALITIES, locale);
}

/** The situation: its label, or the person's own words for "other". */
export function situationText(
  entry: EntryV2,
  locale: Locale,
  t: Translate,
  inRecord = false,
): string | null {
  if (!entry.context_tag) return null;
  if (entry.context_tag === "other" && entry.context_other) {
    return inRecord
      ? t("history.item.other", { text: entry.context_other })
      : entry.context_other;
  }
  return labelOf(CONTEXT_TAGS, entry.context_tag, locale);
}

/** A collapsed row (ui.md §15.6): no valence, arousal or word, ever. */
export interface RowView {
  time: string;
  tz: string | null;
  situation: string | null;
  afterEvent: boolean;
  /** "chest, throat — tight, lump", "Skipped" or "Form left open" */
  body: string;
  /** The note's first line, in quotes */
  note: string | null;
}

export function rowView(
  entry: EntryV2,
  locale: Locale,
  t: Translate,
  offsetAt: OffsetAt = deviceOffset,
): RowView {
  const [open, close] = QUOTES[locale];
  const firstLine = entry.note?.split("\n")[0].trim();
  return {
    time: timeLabel(entry, locale),
    tz: tzLabel(entry, t, offsetAt),
    situation: situationText(entry, locale, t),
    afterEvent: entry.trigger === "after_event",
    body: entry.abandoned
      ? t("history.item.leftOpen")
      : entry.skipped || !entry.body
      ? t("history.item.skipped")
      : t("history.item.body", {
        where: whereText(entry.body.locations, locale),
        like: likeText(entry.body.qualities ?? [], locale),
      }),
    note: firstLine ? `${open}${firstLine}${close}` : null,
  };
}

// ----- The draft gate (ui.md §15.2, §15.14) -----

export type Gate =
  | { kind: "list" }
  | { kind: "draft"; trigger: EntryV2["trigger"]; reminderId: string | null }
  | { kind: "otherWindow" };

/**
 * No past answers while a check-in is in progress, in this tab or another:
 * an idle draft is finalized first (ui.md §6.2), then any draft left
 * gates the list. Continue resumes it.
 */
export async function historyGate(
  accountId: string,
  keyVersion: number,
  now = Date.now(),
): Promise<Gate> {
  if (await draftHeldElsewhere()) return { kind: "otherWindow" };
  // A copy in memory whose stored draft another tab has saved since
  if (!(await getStoredDraft())) forgetDraftInMemory();
  await finalizeIfAbandoned(accountId, keyVersion, now).catch(() => false);
  const draft = await loadDraft(accountId).catch(() => null);
  return draft
    ? { kind: "draft", trigger: draft.trigger, reminderId: draft.reminder_id }
    : { kind: "list" };
}
