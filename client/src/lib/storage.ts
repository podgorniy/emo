// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Asks the browser to keep this app's storage (no prompt in most browsers);
 * the answer goes to `meta.persisted`, with no UI either way.
 * Specification: reliability.md §5.1.
 */

import { setMeta } from "./db.ts";

export async function requestPersistence(): Promise<void> {
  try {
    if (!navigator.storage?.persist) return;
    const persisted = (await navigator.storage.persisted?.()) ||
      (await navigator.storage.persist());
    await setMeta("persisted", persisted);
  } catch {
    // Quiet: the 24 h stale-outbox warning is the fallback (iOS)
  }
}
