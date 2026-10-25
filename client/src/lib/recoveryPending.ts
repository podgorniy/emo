// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `meta.recovery_pending` (content-free): set in the step that uploads a
 * keyring with a new recovery wrap, cleared only once one of the save options
 * was completed. While it is set, the app asks for the passphrase and issues
 * a new key (architecture.md §4.1: shown once, no way forward unsaved).
 */

import { getMeta, removeMeta, setMeta } from "./db.ts";

export async function isRecoveryPending(): Promise<boolean> {
  return (await getMeta<boolean>("recovery_pending")) === true;
}

export async function setRecoveryPending(value: boolean): Promise<void> {
  if (value) await setMeta("recovery_pending", true);
  else await removeMeta("recovery_pending");
}
