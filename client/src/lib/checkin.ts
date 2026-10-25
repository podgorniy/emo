// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The check-in around the pure machine: opening (resume or new), Close, the
 * abandon rule, saving, stopping (Skip check-in / Stop here / Skip it) and
 * Undo. Specification: ui.md §6.2, architecture.md §7.1, ui.md §6.
 */

import type {
  DraftV2,
  EntryUI,
  EntryV2,
  TriggerType,
} from "../../../shared/entry.ts";
import { validateEntryV2 } from "../../../shared/entry.ts";
import * as machine from "./machine.ts";
import {
  clearDraft,
  forgetDraftInMemory,
  loadDraft,
  saveDraft,
} from "./draft.ts";
import { emergencyUndo, saveAndQueueEntry } from "./sync.ts";

const tzOffsetMin = () => -new Date().getTimezoneOffset();

async function store(accountId: string, keyVersion: number, entry: EntryV2) {
  const check = validateEntryV2(entry);
  if (!check.valid) {
    throw new Error(
      `Refusing to save an invalid entry: ${check.errors.join("; ")}`,
    );
  }
  // The entry, its outbox item and the draft's removal: one transaction
  await saveAndQueueEntry(entry, accountId, keyVersion);
  forgetDraftInMemory();
}

/**
 * The only abandon rule (ui.md §6.2): a draft whose last interaction
 * was ≥ 10 min ago is saved as `skipped, abandoned`, keeping the answers of
 * the steps before the one on screen (`machine.toStoppedEntry`). A
 * self-started form never touched leaves no record (`machine.discardable`).
 * Run at app start, on `visibilitychange → visible` and on a timer while the
 * form is visible. Returns true when a draft was finalized or dropped.
 */
export async function finalizeIfAbandoned(
  accountId: string,
  keyVersion: number,
  now = Date.now(),
): Promise<boolean> {
  const draft = await loadDraft(accountId);
  if (!draft || !machine.isAbandoned(draft, now)) return false;
  if (machine.discardable(draft)) {
    await clearDraft();
    return true;
  }
  await store(
    accountId,
    keyVersion,
    machine.toStoppedEntry(draft, {
      id: crypto.randomUUID(),
      now,
      tzOffsetMin: tzOffsetMin(),
      abandoned: true,
    }),
  );
  return true;
}

/**
 * Resumes the draft on the same screen (also after a reload), or starts one.
 * Opening clears "closed by the person"; `ui` is the controls in use,
 * recorded on the draft for every entry it may end as: a resumed draft keeps
 * its copy, and a layout other than its own makes it `mixed`
 * (`machine.mergeUi`). A new `manual` one asks `link` for a reminder it
 * answers (`reminderLink.ts`): then it starts as `random`.
 */
export async function openCheckIn(
  accountId: string,
  keyVersion: number,
  trigger: TriggerType,
  reminderId: string | null,
  now = Date.now(),
  ui: EntryUI | null = null,
  link: (now: number) => Promise<string | null> = () => Promise.resolve(null),
): Promise<DraftV2> {
  await finalizeIfAbandoned(accountId, keyVersion, now);
  const existing = await loadDraft(accountId);
  const linked = !existing && trigger === "manual" ? await link(now) : null;
  let draft = existing
    ? machine.show(existing, now)
    : linked
    ? machine.newDraft("random", linked, now)
    : machine.newDraft(trigger, reminderId, now);
  if (draft.closed_by_user) {
    const { closed_by_user: _closed, ...open } = draft;
    draft = open;
  }
  const merged = machine.mergeUi(draft.ui, ui);
  if (merged) draft = { ...draft, ui: merged };
  await saveDraft(accountId, draft);
  return draft;
}

/**
 * Close (ui.md §6.2): the draft stays, marked as closed by the
 * person, so the next app start shows Home with "Continue" instead of
 * reopening the form. A self-started form closed untouched is dropped.
 */
export async function closeCheckIn(
  accountId: string,
  draft: DraftV2,
): Promise<void> {
  if (machine.discardable(draft)) {
    await clearDraft();
    return;
  }
  await saveDraft(accountId, { ...draft, closed_by_user: true });
}

/**
 * Save on the last screen. `ui` is the controls at this moment, merged with
 * the draft's: its copy stays, and a layout other than the draft's makes
 * `mixed` (`machine.toEntry`).
 */
export async function saveCheckIn(
  accountId: string,
  keyVersion: number,
  draft: DraftV2,
  ui: EntryUI | null,
  now = Date.now(),
): Promise<EntryV2> {
  const entry = machine.toEntry(draft, {
    id: crypto.randomUUID(),
    now,
    tzOffsetMin: tzOffsetMin(),
    ui,
  });
  await store(accountId, keyVersion, entry);
  return entry;
}

/**
 * "Skip check-in" on step 1, "Stop here" from step 2 on: saved as skipped,
 * with the answers of the steps before this one and the draft's `ui`
 * (`machine.toStoppedEntry`).
 */
export async function stopCheckIn(
  accountId: string,
  keyVersion: number,
  draft: DraftV2,
  now = Date.now(),
): Promise<EntryV2> {
  const entry = machine.toStoppedEntry(draft, {
    id: crypto.randomUUID(),
    now,
    tzOffsetMin: tzOffsetMin(),
    abandoned: false,
  });
  await store(accountId, keyVersion, entry);
  return entry;
}

/**
 * "Skip it" on Home or in the History gate: the open draft ends as if
 * stopped on its screen. Null when there is none (another tab took it).
 */
export async function skipOpenDraft(
  accountId: string,
  keyVersion: number,
  now = Date.now(),
): Promise<EntryV2 | null> {
  if (await finalizeIfAbandoned(accountId, keyVersion, now)) return null;
  const draft = await loadDraft(accountId);
  return draft ? await stopCheckIn(accountId, keyVersion, draft, now) : null;
}

/**
 * Undo (Saved screen or Home toast): the entry is deleted and its answers
 * become the draft again, so the form re-opens on the last screen — or, for
 * a check-in stopped with answers, on the screen where it stopped. One
 * skipped on step 1 comes back as a fresh draft, still with its trigger and
 * reminder: whoever reopens the form, the draft decides (`openCheckIn`).
 * Rejects only when the entry could not be deleted (it stays saved); once
 * it is, a failing draft write is not an Undo failure: `saveDraft` holds the
 * draft in memory first, so the form still comes back with its answers.
 */
export async function undoCheckIn(
  accountId: string,
  entryId: string,
  now = Date.now(),
): Promise<void> {
  const entry = await emergencyUndo(entryId, accountId);
  if (!entry) return;
  await saveDraft(accountId, machine.draftFromEntry(entry, now)).catch((err) =>
    console.warn("Undo: the draft was not written:", err)
  );
}
