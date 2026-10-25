// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the pane bar's sync dot shows and says (ui.md §3):
 * eight states, the first that applies wins; the five looks they share, and
 * the legend's line for each; and the `{time}` of "Synced". One question
 * only — are my check-ins on the server? No counts: a number of unsynced
 * check-ins would put a counter in the chrome.
 */
import type { MessageKey } from "../../../shared/i18n/keys.ts";
import type { SyncStatus } from "./sync.ts";

export type DotState =
  | "signedOut"
  | "update"
  | "offline"
  | "unreachable"
  | "sending"
  | "stale"
  | "waiting"
  | "synced";

/** In priority order: the first that applies wins (ui.md §3) */
export const DOT_STATES: readonly DotState[] = [
  "signedOut",
  "update",
  "offline",
  "unreachable",
  "sending",
  "stale",
  "waiting",
  "synced",
];

/** Everything the dot reads: never an entry, a draft or a reminder */
export interface DotInput {
  signedOut: boolean;
  updateRequired: boolean;
  /** No answer from Emo (network.ts isOffline) */
  offline: boolean;
  /** navigator.onLine (network.ts deviceOnline): tells offline from unreachable */
  deviceOnline: boolean;
  running: boolean;
  status: SyncStatus;
}

export function dotState(s: DotInput): DotState {
  if (s.signedOut) return "signedOut";
  if (s.updateRequired) return "update";
  if (s.offline) return s.deviceOnline ? "unreachable" : "offline";
  if (s.running) return "sending";
  if (s.status === "stale") return "stale";
  if (s.status === "pending") return "waiting";
  return "synced";
}

/**
 * The five looks (SyncGlyph.svelte), told apart by shape, never by colour;
 * the legend's rows in this order
 */
export type Glyph =
  | "synced"
  | "sending"
  | "waiting"
  | "notConnected"
  | "needsLook";

export const GLYPHS: readonly Glyph[] = [
  "synced",
  "sending",
  "waiting",
  "notConnected",
  "needsLook",
];

export const GLYPH_OF: Record<DotState, Glyph> = {
  synced: "synced",
  sending: "sending",
  waiting: "waiting",
  offline: "notConnected",
  unreachable: "notConnected",
  signedOut: "needsLook",
  update: "needsLook",
  stale: "needsLook",
};

/** The legend's line for each look (the sync sheet, ui.md §3) */
export const LEGEND_KEY: Record<Glyph, MessageKey> = {
  synced: "home.sync.legend.synced",
  sending: "home.sync.legend.sending",
  waiting: "home.sync.legend.waiting",
  notConnected: "home.sync.legend.notConnected",
  needsLook: "home.sync.legend.needsLook",
};

/**
 * States a screen reader hears about when they begin (and their end).
 * Never `unreachable`: on a flaky network it would chatter.
 */
export const LOUD: ReadonlySet<DotState> = new Set([
  "stale",
  "signedOut",
  "update",
]);

/** Whether going from `prev` to `next` is announced (ui.md §3). */
export function announced(prev: DotState | null, next: DotState): boolean {
  if (prev === null || prev === next) return false;
  return LOUD.has(next) || (next === "synced" && LOUD.has(prev));
}

/**
 * "just now", "5 min ago" under an hour; then "14:32", "yesterday 14:32",
 * "7 Oct, 14:32" in the interface language.
 */
export function syncTime(
  at: Date,
  locale: string,
  justNow: string,
  now: Date = new Date(),
): string {
  const ms = now.getTime() - at.getTime();
  if (ms < 60_000) return justNow;
  if (ms < 3_600_000) {
    return new Intl.RelativeTimeFormat(locale, { style: "short" })
      .format(-Math.floor(ms / 60_000), "minute");
  }
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  const day = (d: Date) => d.toDateString();
  if (day(at) === day(now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(at) === day(yesterday)) {
    const word = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
      .format(-1, "day");
    return `${word} ${time}`;
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}
