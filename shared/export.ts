// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The readable export files: `entries.jsonl`, `entries.csv`,
 * `reminders.jsonl` and `dictionaries.json`. Written by Settings → Data and
 * by `emo decrypt-bundle`, so both produce the same files.
 * Specification: architecture.md §10.1.
 */

import {
  BODY_ZONES,
  CONTEXT_TAGS,
  type DictItem,
  type Locale,
  QUALITIES,
  QUALITY_GROUPS,
  SCHEMA_V,
  URGES,
  WORD_CONFIDENCE,
  WORDS,
} from "./dictionaries.ts";
import type { EntryV2 } from "./entry.ts";
import type { Kdf, Wrapped } from "./protocol.ts";

/** `emo-bundle` v1, the portable encrypted export (architecture.md §10.1). Fixed:
 * fields are only ever added. No email. */
export interface EmoBundleV1 {
  format: "emo-bundle";
  version: 1;
  exported_at: string;
  app_version: string;
  instance: string;
  account_id: string;
  keyrings: Array<{
    key_version: number;
    rev: number;
    kdf: Kdf;
    dek_wrapped_pass: Wrapped;
    dek_wrapped_recovery: Wrapped;
  }>;
  entries: Array<{
    id: string;
    key_version: number;
    nonce_b64: string | null;
    ct_b64: string | null;
    deleted: boolean;
    received_at: string;
  }>;
  prefs: {
    key_version: number;
    nonce_b64: string;
    ct_b64: string;
    updated_at: string;
  } | null;
  reminders: ExportedReminder[];
}

/**
 * An entry as exported: the open payload as it is, plus `received_at`. On a
 * skipped entry, `stopped_at` says which fields are answers (the steps before
 * it) and which were not reached (`null`); the CSV has it as a column.
 */
export type ExportedEntry = EntryV2 & { received_at: string };

/**
 * The reminder journal row as the API returns it. `tz` (the zone the day was
 * planned in) gives the local time of a moment nobody answered; `reason`
 * says why a `cancelled` one was never sent. Both are missing on rows pulled
 * from a server before 2026-10-10.
 */
export interface ExportedReminder {
  id: string;
  local_date: string;
  tz?: string;
  scheduled_for: string;
  sent_at: string | null;
  status: string;
  reason?: string | null;
}

/** The fields of a stored or pulled journal row that are exported. */
export function exportedReminder(r: ExportedReminder): ExportedReminder {
  return {
    id: r.id,
    local_date: r.local_date,
    tz: r.tz,
    scheduled_for: r.scheduled_for,
    sent_at: r.sent_at,
    status: r.status,
    reason: r.reason ?? null,
  };
}

export function toJsonl(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") +
    (rows.length ? "\n" : "");
}

export function dictionariesJson(): string {
  return JSON.stringify(
    {
      schema_v: SCHEMA_V,
      methodology: {
        anti_why: true,
        gamification: false,
        null_answers_are_data: true,
        principles: [
          "Somatic primacy: bodily awareness before cognitive labelling",
          "Anti-why: capture state without retrospective rationalization",
          "Null answers are data: unselected fields represent genuine absence, not omission",
          "No gamification: no streaks, badges, or behavioural steering",
          "Low cognitive burden: momentary sampling completed in under 30 seconds",
          "High fidelity: exact moment capture with zero judgment",
          "Privacy and sovereignty: end-to-end encryption with local-first export",
        ],
      },
      body_zones: BODY_ZONES,
      qualities: QUALITIES,
      quality_groups: QUALITY_GROUPS,
      words: WORDS,
      word_confidence: WORD_CONFIDENCE,
      urges: URGES,
      context_tags: CONTEXT_TAGS,
    },
    null,
    2,
  ) + "\n";
}

function labelOf(items: DictItem[], key: string, locale: Locale): string {
  return items.find((i) => i.key === key)?.label[locale] ?? key;
}

/** `fear` or `fear.anxiety` → its label in `locale`. */
function wordLabel(word: string, locale: Locale): string {
  const [l1, l2] = word.split(".");
  const top = WORDS.find((w) => w.key === l1);
  if (!top) return word;
  if (!l2) return top.label[locale];
  return top.l2.find((w) => w.key === l2)?.label[locale] ?? word;
}

export const CSV_COLUMNS = [
  "id",
  "ts",
  "tz_offset_min",
  "trigger",
  "reminder_id",
  "latency_sec",
  "hidden_sec",
  "skipped",
  "abandoned",
  "stopped_at",
  "body_locations",
  "body_qualities",
  "body_intensity",
  "affect_valence",
  "affect_arousal",
  "affect_word",
  "affect_word_confidence",
  "urge",
  "head_mode",
  "context_tag",
  "context_other",
  "note",
  "untouched",
  "ui_theme",
  "ui_intensity",
  "ui_options",
  "ui_figure",
  "ui_copy",
  "received_at",
  "schema_v",
  // Appended (2026-10-11): the columns before it keep their places
  "ui_layout",
] as const;

const LABEL_COLUMNS = [
  "body_locations_label",
  "body_qualities_label",
  "affect_word_label",
  "affect_word_confidence_label",
  "urge_label",
  "context_tag_label",
] as const;

type Cell = string | number | boolean | null | undefined;

function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n;]/.test(text) || /^\s|\s$/.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

/**
 * One row per entry, arrays joined with `;`, UTF-8 with a BOM for Excel.
 * Keys stay keys; `labels` adds `*_label` columns in that language.
 */
export function entriesToCsv(
  entries: ExportedEntry[],
  labels?: Locale,
): string {
  const header: string[] = [...CSV_COLUMNS, ...(labels ? LABEL_COLUMNS : [])];
  const lines = [header.join(",")];
  for (const e of entries) {
    const row: Cell[] = [
      e.id,
      e.ts,
      e.tz_offset_min,
      e.trigger,
      e.reminder_id,
      e.latency_sec,
      e.hidden_sec,
      e.skipped,
      e.abandoned,
      e.stopped_at ?? null,
      e.body?.locations.join(";"),
      e.body?.qualities?.join(";"),
      e.body?.intensity,
      e.affect?.valence,
      e.affect?.arousal,
      e.affect?.word,
      e.affect?.word_confidence,
      e.urge,
      e.head_mode,
      e.context_tag,
      e.context_other,
      e.note,
      e.untouched?.join(";"),
      e.ui?.theme,
      e.ui?.intensity,
      e.ui?.options,
      e.ui?.figure,
      // The wording version: answers compare only within one
      // (methodology.md §5.4); an entry without it is version 1
      e.ui ? e.ui.copy ?? 1 : null,
      e.received_at,
      e.schema_v,
      // phone, wide, short or mixed; empty when unknown (before copy 6)
      e.ui?.layout,
    ];
    if (labels) {
      row.push(
        e.body?.locations.map((k) => labelOf(BODY_ZONES, k, labels)).join(";"),
        e.body?.qualities?.map((k) => labelOf(QUALITIES, k, labels)).join(
          ";",
        ),
        e.affect?.word ? wordLabel(e.affect.word, labels) : null,
        e.affect?.word_confidence
          ? labelOf(WORD_CONFIDENCE, e.affect.word_confidence, labels)
          : null,
        e.urge ? labelOf(URGES, e.urge, labels) : null,
        e.context_tag ? labelOf(CONTEXT_TAGS, e.context_tag, labels) : null,
      );
    }
    lines.push(row.map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
