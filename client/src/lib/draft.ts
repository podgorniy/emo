// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The check-in form draft. It is encrypted with the DEK and padded like an
 * entry before it reaches IndexedDB; without a DEK it lives in memory only.
 * Specification: architecture.md §5.5, ui.md §6.2, architecture.md §8.1.
 */

import type { DraftV2 } from "../../../shared/entry.ts";
import { decryptDraft, encryptDraft } from "../../../shared/crypto/e2e.ts";
import {
  decodeBase64Url,
  encodeBase64Url,
} from "../../../shared/crypto/encoding.ts";
import { getCachedDek } from "./crypto.ts";
import { LAST_STEP } from "./machine.ts";
import { deleteStoredDraft, getStoredDraft, putStoredDraft } from "./db.ts";

let memoryDraft: { accountId: string; draft: DraftV2 } | null = null;

export async function saveDraft(
  accountId: string,
  draft: DraftV2,
): Promise<void> {
  memoryDraft = { accountId, draft };
  const dek = getCachedDek();
  if (!dek) return;
  const enc = await encryptDraft(dek, draft, accountId);
  await putStoredDraft({
    nonce_b64: encodeBase64Url(enc.nonce),
    ct_b64: encodeBase64Url(enc.ciphertext),
  });
}

export async function loadDraft(accountId: string): Promise<DraftV2 | null> {
  if (memoryDraft?.accountId === accountId) return memoryDraft.draft;
  const dek = getCachedDek();
  if (!dek) return null;
  const stored = await getStoredDraft();
  if (!stored) return null;
  try {
    const draft = await decryptDraft(
      dek,
      decodeBase64Url(stored.nonce_b64),
      decodeBase64Url(stored.ct_b64),
      accountId,
    );
    // A draft from before the note joined the situation may sit on the
    // tenth screen: that is the last one now
    if (draft.step > LAST_STEP) draft.step = LAST_STEP;
    memoryDraft = { accountId, draft };
    return draft;
  } catch {
    // Another account's draft or a corrupted blob: it cannot be recovered.
    await deleteStoredDraft();
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  memoryDraft = null;
  await deleteStoredDraft();
}

/** Lock: drop the plaintext copy; the encrypted one stays on disk. */
export function forgetDraftInMemory(): void {
  memoryDraft = null;
}
