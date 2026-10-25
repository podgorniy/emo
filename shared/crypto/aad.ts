// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Additional Authenticated Data (AAD) builder for AES-256-GCM.
 * Specification: architecture.md §5.5.
 * Parts are UTF-8 strings joined with 0x00 (NUL byte).
 */

import {
  AAD_DRAFT_PREFIX,
  AAD_ENTRY_PREFIX,
  AAD_KEYRING_PREFIX,
  AAD_PREFS_PREFIX,
} from "./constants.ts";

const textEncoder = new TextEncoder();

export function buildAad(
  prefix: string,
  ...parts: (string | number)[]
): Uint8Array {
  const partsStr = [prefix, ...parts.map((p) => String(p))];
  return textEncoder.encode(partsStr.join("\0"));
}

export function buildEntryAad(
  accountId: string,
  entryId: string,
  keyVersion: number,
): Uint8Array {
  return buildAad(AAD_ENTRY_PREFIX, accountId, entryId, keyVersion);
}

export function buildKeyringAad(
  accountId: string,
  keyVersion: number,
): Uint8Array {
  return buildAad(AAD_KEYRING_PREFIX, accountId, keyVersion);
}

/** `"emo-prefs/v1" || account_id || key_version` (architecture.md §5.5) */
export function buildPrefsAad(
  accountId: string,
  keyVersion: number,
): Uint8Array {
  return buildAad(AAD_PREFS_PREFIX, accountId, keyVersion);
}

/** `"emo-draft/v1" || account_id` — the draft never leaves the device (architecture.md §5.5) */
export function buildDraftAad(accountId: string): Uint8Array {
  return buildAad(AAD_DRAFT_PREFIX, accountId);
}
