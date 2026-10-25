// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Settings → Data → Export (architecture.md §10.1): the entries decrypted in
 * memory as JSONL (with dictionaries.json) or CSV, the reminder journal, and
 * the encrypted `emo-bundle` that `emo decrypt-bundle` reads offline. Files go
 * out through a Blob download; nothing decrypted is written to storage.
 */

import type { Locale } from "../../../shared/dictionaries.ts";
import {
  dictionariesJson,
  type EmoBundleV1,
  entriesToCsv,
  type ExportedEntry,
  exportedReminder,
  toJsonl,
} from "../../../shared/export.ts";
import { apiPullEntries } from "./api.ts";
import { decryptRows } from "./decrypt.ts";
import {
  getAllEntries,
  getAllReminders,
  getMeta,
  getStoredPrefs,
  type StoredEntry,
} from "./db.ts";
import { cachedKeyring, fetchKeyring } from "./session.ts";
import { runSync } from "./sync.ts";
import { CLIENT_VERSION } from "./version.ts";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The files just downloaded; `partial` when check-ins this device evicted
 * could not be fetched from the server, so older ones are missing.
 */
export interface ExportResult {
  files: string[];
  partial: boolean;
}

/**
 * Every entry row of the account, after a sync when the network allows. A
 * device that evicted old rows to make room (`meta.evicted`, `db.ts`
 * `evictSyncedEntries`) pulls the server's copy into memory and lays its own
 * rows over it (they win: an Undo not uploaded yet), so the export still
 * holds every check-in; nothing pulled is stored. Offline, the rows here go
 * out with `partial` (methodology.md §5.3: a lost row would read as
 * a reminder nobody answered).
 */
async function freshLocal(
  accountId: string,
): Promise<{ rows: StoredEntry[]; partial: boolean }> {
  await runSync(accountId).catch(() => {});
  const local = await getAllEntries();
  if ((await getMeta<boolean>("evicted")) !== true) {
    return { rows: local, partial: false };
  }
  try {
    const all = new Map<string, StoredEntry>();
    for (let since = 0;;) {
      const page = await apiPullEntries(since, 500);
      for (const item of page.items) all.set(item.id, item);
      if (!page.has_more) break;
      since = page.next_seq;
    }
    for (const row of local) all.set(row.id, row);
    return { rows: [...all.values()], partial: false };
  } catch {
    return { rows: local, partial: true };
  }
}

/**
 * What can be exported (reliability.md §1.2, data.md §8.1): valid entries; entries
 * that decrypt but fail validation separately (JSONL only, marked
 * `_invalid`); the rest only counted (undecryptable, or from a newer app).
 * Decrypted in the Worker of `decrypt.ts`, in batches.
 */
export async function decryptedEntries(
  accountId: string,
  onProgress?: (n: number) => void,
): Promise<{
  entries: ExportedEntry[];
  invalid: Array<Record<string, unknown>>;
  unreadable: number;
  newer: number;
  partial: boolean;
}> {
  const { rows: all, partial } = await freshLocal(accountId);
  const rows = all.filter((r) =>
    !r.deleted && r.nonce_b64 && r.ct_b64
  ) as Array<StoredEntry & { nonce_b64: string; ct_b64: string }>;
  onProgress?.(rows.length);
  const receivedAt = new Map(rows.map((r) => [r.id, r.received_at]));
  const entries: ExportedEntry[] = [];
  const invalid: Array<Record<string, unknown>> = [];
  let unreadable = 0;
  let newer = 0;
  for (const read of await decryptRows(rows, accountId)) {
    const received_at = receivedAt.get(read.id)!;
    if (read.kind === "ok") {
      entries.push({ ...read.entry, received_at });
    } else if (read.kind === "invalid") {
      invalid.push({
        ...(read.value as Record<string, unknown>),
        received_at,
        _invalid: true,
      });
    } else if (read.kind === "newer") newer++;
    else unreadable++;
  }
  entries.sort((a, b) => a.ts.localeCompare(b.ts));
  return { entries, invalid, unreadable, newer, partial };
}

/** Downloads `content` as `name`; returns the name (for "Saved {filename}"). */
export function saveFile(name: string, content: string, type: string): string {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export async function exportJsonl(
  accountId: string,
  onProgress?: (n: number) => void,
): Promise<ExportResult> {
  const { entries, invalid, partial } = await decryptedEntries(
    accountId,
    onProgress,
  );
  return {
    files: [
      saveFile(
        "entries.jsonl",
        toJsonl([...entries, ...invalid]),
        "application/x-ndjson",
      ),
      saveFile("dictionaries.json", dictionariesJson(), "application/json"),
    ],
    partial,
  };
}

export async function exportCsv(
  accountId: string,
  labels: Locale | undefined,
  onProgress?: (n: number) => void,
): Promise<ExportResult> {
  const { entries, partial } = await decryptedEntries(accountId, onProgress);
  return {
    files: [saveFile(
      "entries.csv",
      entriesToCsv(entries, labels),
      "text/csv;charset=utf-8",
    )],
    partial,
  };
}

export async function exportReminders(
  accountId: string,
): Promise<ExportResult> {
  await runSync(accountId).catch(() => {});
  const rows = (await getAllReminders()).map(exportedReminder)
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
  return {
    files: [
      saveFile("reminders.jsonl", toJsonl(rows), "application/x-ndjson"),
    ],
    partial: false,
  };
}

/** The `emo-bundle` v1: ciphertext exactly as stored, no email. */
export async function buildBundle(accountId: string): Promise<EmoBundleV1> {
  return (await bundleOf(accountId)).bundle;
}

async function bundleOf(
  accountId: string,
): Promise<{ bundle: EmoBundleV1; partial: boolean }> {
  const { rows, partial } = await freshLocal(accountId);
  const keyring = (await fetchKeyring()) ?? (await cachedKeyring());
  if (!keyring) throw new Error("No keyring on this device");
  const prefs = await getStoredPrefs();
  const bundle: EmoBundleV1 = {
    format: "emo-bundle",
    version: 1,
    exported_at: new Date().toISOString(),
    app_version: CLIENT_VERSION,
    instance: globalThis.location?.host ?? "",
    account_id: accountId,
    keyrings: [{
      key_version: keyring.key_version,
      rev: keyring.rev,
      kdf: keyring.kdf,
      dek_wrapped_pass: keyring.dek_wrapped_pass,
      dek_wrapped_recovery: keyring.dek_wrapped_recovery,
    }],
    entries: rows.map((r) => ({
      id: r.id,
      key_version: r.key_version,
      nonce_b64: r.nonce_b64,
      ct_b64: r.ct_b64,
      deleted: r.deleted,
      received_at: r.received_at,
    })),
    prefs: prefs
      ? {
        key_version: prefs.key_version,
        nonce_b64: prefs.nonce_b64,
        ct_b64: prefs.ct_b64,
        updated_at: prefs.updated_at ?? new Date().toISOString(),
      }
      : null,
    reminders: (await getAllReminders()).map(exportedReminder),
  };
  return { bundle, partial };
}

export async function exportBundle(accountId: string): Promise<ExportResult> {
  const { bundle, partial } = await bundleOf(accountId);
  return {
    files: [saveFile(
      `emo-bundle-${today()}.json`,
      JSON.stringify(bundle),
      "application/json",
    )],
    partial,
  };
}
