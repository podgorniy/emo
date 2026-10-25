// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One tab owns the check-in draft (ui.md §6.2): the Web Lock
 * `emo-draft`, held while the form is open. A second tab shows
 * `checkin.otherWindow` instead of a form that would overwrite the first
 * one's draft. Without Web Locks (very old browsers) there is no guard.
 */

/** How many forms in this tab hold the lock (one, but a remount may overlap) */
let held = 0;

/** This tab has the form open: the one a "Go to it" (`draft-ping`) means */
export function holdsDraftLock(): boolean {
  return held > 0;
}

/** Takes the lock; resolves with its release, or null when another tab has it. */
export function holdDraftLock(): Promise<(() => void) | null> {
  const locks = globalThis.navigator?.locks;
  /** Counts this tab's hold until released (once) */
  const hold = (release: () => void) => {
    held++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      held--;
      release();
    };
  };
  if (!locks) return Promise.resolve(hold(() => {}));
  return new Promise((resolve) => {
    locks.request("emo-draft", { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return;
      }
      // Held until released: the callback's promise keeps the lock
      return new Promise<void>((release) => resolve(hold(() => release())));
    }).catch(() => resolve(hold(() => {})));
  });
}

/**
 * Another tab has the form open: History then shows `checkin.otherWindow`
 * instead of past check-ins (ui.md §15.14). Asked without taking the
 * lock; false where Web Locks cannot tell.
 */
export async function draftHeldElsewhere(): Promise<boolean> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.query) return false;
  try {
    const { held = [] } = await locks.query();
    return held.some((lock) => lock.name === "emo-draft");
  } catch {
    return false;
  }
}
