// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pulled entries are checked once this device can decrypt them
 * (reliability.md §1.2, data.md §8.1): each one is decrypted, read through the reader
 * table and validated (`readEntry`), and flagged `ok`, `undecryptable`,
 * `invalid` or `newer`. The ciphertext is always kept; nothing is uploaded or
 * tombstoned. A row not `ok` is tried again on later passes: an undecryptable
 * one may open after a keyring change, and an invalid or newer one may read
 * under a newer build of the app (one an older build rejected, such as a
 * copy-6 step-1 skip with its `ui`: data.md §8.1), so its flag never
 * outlives the update. The counts go to `meta` for Settings → Data and "Copy
 * diagnostics".
 */
import { readEntry } from "../../../shared/entry.ts";
import { decryptEntryLocally, isLocked } from "./crypto.ts";
import {
  type EntryCheck,
  getAllEntries,
  setEntryChecks,
  setMeta,
  type StoredEntry,
} from "./db.ts";
import { recordDiag } from "./diag.ts";

export interface EntryCounts {
  undecryptable: number;
  invalid: number;
  newer: number;
}

/** The flag one stored row earns; decryption errors are `undecryptable`. */
export async function checkEntry(
  row: StoredEntry,
  accountId: string,
): Promise<EntryCheck> {
  try {
    const value: unknown = await decryptEntryLocally(
      row.nonce_b64!,
      row.ct_b64!,
      accountId,
      row.id,
      row.key_version,
    );
    return readEntry(value).kind;
  } catch {
    return "undecryptable";
  }
}

/** Checks what needs it; null while the device is locked. */
export async function checkEntries(
  accountId: string,
): Promise<EntryCounts | null> {
  if (isLocked()) return null;
  const rows = (await getAllEntries()).filter((r) =>
    !r.deleted && r.nonce_b64 && r.ct_b64
  );
  const results: Array<{ id: string; ct_b64: string; check: EntryCheck }> = [];
  for (const row of rows) {
    if (row.check === "ok") continue;
    const check = await checkEntry(row, accountId);
    if (check !== row.check) {
      results.push({ id: row.id, ct_b64: row.ct_b64!, check });
      if (check !== "ok") await recordDiag(`entry.${check}`, "pull");
    }
    row.check = check;
  }
  if (results.length) await setEntryChecks(results);

  const count = (c: EntryCheck) => rows.filter((r) => r.check === c).length;
  const counts = {
    undecryptable: count("undecryptable"),
    invalid: count("invalid"),
    newer: count("newer"),
  };
  await setMeta("undecryptable", counts.undecryptable);
  await setMeta("invalid_entries", counts.invalid);
  await setMeta("needs_newer_app", counts.newer);
  return counts;
}
