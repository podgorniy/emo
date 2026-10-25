// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One stored entry decrypted and read (reliability.md §1.2, data.md §8.1): the
 * ciphertext opened with the DEK, then the reader table and the validator
 * (`readEntry`). The one path for export and History; it runs in
 * `decrypt.worker.ts`, or on the main thread where a Worker cannot.
 * Never throws: whatever the row is, the caller keeps its ciphertext.
 */

import { decryptEntry } from "../../../shared/crypto/e2e.ts";
import { decodeBase64Url } from "../../../shared/crypto/encoding.ts";
import { type EntryV2, readEntry } from "../../../shared/entry.ts";

/** The part of a stored row that decrypting needs. */
export interface CipherRow {
  id: string;
  key_version: number;
  nonce_b64: string;
  ct_b64: string;
}

export type ReadResult =
  | { id: string; kind: "ok"; entry: EntryV2 }
  /** Decrypts, but is not a valid entry (export keeps it as `_invalid`). */
  | { id: string; kind: "invalid"; value: unknown }
  /** Written by a newer app: kept encrypted, never shown. */
  | { id: string; kind: "newer" }
  | { id: string; kind: "undecryptable" };

export async function readStoredEntry(
  dek: CryptoKey,
  accountId: string,
  row: CipherRow,
): Promise<ReadResult> {
  let value: unknown;
  try {
    value = await decryptEntry(
      dek,
      decodeBase64Url(row.nonce_b64),
      decodeBase64Url(row.ct_b64),
      accountId,
      row.id,
      row.key_version,
    );
  } catch {
    return { id: row.id, kind: "undecryptable" };
  }
  const read = readEntry(value);
  if (read.kind === "ok") return { id: row.id, kind: "ok", entry: read.entry };
  if (read.kind === "invalid") {
    return { id: row.id, kind: "invalid", value: read.value };
  }
  return { id: row.id, kind: "newer" };
}
