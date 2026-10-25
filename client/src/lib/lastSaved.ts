// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The check-in just saved (or skipped), for Home's "Saved · Undo" toast
 * (ui.md §6.5): its id and an absolute wall-clock deadline, 10 s
 * after it reached Home (`fromSaved`, `savedAt`). The deadline is never paused or restarted: Home shows the
 * toast only for what is left of it, never a fresh 10 s, so an Undo can never
 * delete a check-in minutes old. App forgets it at once when Home is left,
 * on a lock, when a new check-in starts and when the page is hidden, Saved
 * showing included.
 */

/** How long Undo is offered after a save, in ms */
export const UNDO_MS = 10_000;

/** How long Saved shows before it returns Home by itself, in ms */
export const SAVED_MS = 5_000;

export interface LastSaved {
  readonly id: string;
  /** Epoch ms (`Date.now()`) after which there is no Undo */
  readonly until: number;
}

/** Saved now (or at `now`): Undo until UNDO_MS later */
export function savedAt(id: string, now = Date.now()): LastSaved {
  return { id, until: now + UNDO_MS };
}

/**
 * Saved handed the check-in saved at `savedTime` over to Home at `now`:
 * Undo until 10 s after that (`savedAt`), but never past 10 s after Saved's
 * own 5 s would have ended, so a Saved screen that stood longer (a hidden
 * page stalls its timer) never hands Home a fresh 10 s. None when the page
 * was hidden since the save (`savedTime` null): that ends it, as on Home.
 */
export function fromSaved(
  id: string,
  savedTime: number | null,
  now = Date.now(),
): LastSaved | null {
  if (savedTime === null) return null;
  return savedAt(id, Math.min(now, savedTime + SAVED_MS));
}

/**
 * What is left of the Undo time at `now`, in ms: 0 without a save or past its
 * deadline, and never more than UNDO_MS (a clock set back does not stretch it).
 */
export function undoLeft(saved: LastSaved | null, now = Date.now()): number {
  if (!saved) return 0;
  return Math.min(UNDO_MS, Math.max(0, saved.until - now));
}

/** The same, without `id` (that check-in was deleted, in History) */
export function forget(saved: LastSaved | null, id: string): LastSaved | null {
  return saved?.id === id ? null : saved;
}
