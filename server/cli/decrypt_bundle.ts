// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `emo decrypt-bundle FILE --out DIR [--recovery]` — reads an `emo-bundle`
 * export offline, with no server and no database, using the same `shared/`
 * code as the app. Writes `entries.jsonl`, `entries.csv`, `reminders.jsonl`
 * and `dictionaries.json`. Specification: architecture.md §10.1, ops.md §7.4.
 */

import * as path from "node:path";
import { decryptEntry, importDek } from "../../shared/crypto/e2e.ts";
import { decodeBase64Url } from "../../shared/crypto/encoding.ts";
import {
  unwrapDekWithPassphrase,
  unwrapDekWithRecoveryKey,
} from "../../shared/crypto/keyring.ts";
import {
  dictionariesJson,
  type EmoBundleV1,
  entriesToCsv,
  type ExportedEntry,
  toJsonl,
} from "../../shared/export.ts";
import { readEntry } from "../../shared/entry.ts";
import type { KeyringItem } from "../../shared/protocol.ts";

export type BundleSecret = { passphrase: string } | { recoveryKey: string };

export class BundleError extends Error {}

export function parseBundle(text: string): EmoBundleV1 {
  let bundle: EmoBundleV1;
  try {
    bundle = JSON.parse(text);
  } catch {
    throw new BundleError("Not a JSON file");
  }
  if (bundle?.format !== "emo-bundle") {
    throw new BundleError("Not an emo-bundle export");
  }
  if (bundle.version !== 1) {
    throw new BundleError(
      `emo-bundle version ${bundle.version} is newer than this binary reads (1)`,
    );
  }
  return bundle;
}

/** The DEK of each key version; for each, revisions are tried newest first
 * (a passphrase changed on another device leaves older revisions behind). */
async function unwrapAll(
  bundle: EmoBundleV1,
  secret: BundleSecret,
): Promise<Map<number, CryptoKey>> {
  const keys = new Map<number, CryptoKey>();
  const revs = [...bundle.keyrings].sort((a, b) => b.rev - a.rev);
  for (const keyring of revs) {
    if (keys.has(keyring.key_version)) continue;
    const item = { ...keyring, created_at: "" } as KeyringItem;
    try {
      const raw = "passphrase" in secret
        ? await unwrapDekWithPassphrase(
          item,
          bundle.account_id,
          secret.passphrase,
        )
        : await unwrapDekWithRecoveryKey(
          item,
          bundle.account_id,
          secret.recoveryKey,
        );
      try {
        keys.set(keyring.key_version, await importDek(raw));
      } finally {
        raw.fill(0);
      }
    } catch {
      // Not this revision: try the next one
    }
  }
  if (keys.size === 0) {
    throw new BundleError(
      "passphrase" in secret
        ? "Wrong passphrase"
        : "Wrong or malformed recovery key",
    );
  }
  return keys;
}

/**
 * The bundle's entries, sorted as the app's export does them
 * (reliability.md §1.2, data.md §8.1): valid ones; ones that decrypt but fail
 * validation apart (JSONL only, marked `_invalid`); the rest only counted —
 * undecryptable, or written by a newer app than this binary.
 */
export async function decryptBundle(
  bundle: EmoBundleV1,
  secret: BundleSecret,
): Promise<{
  entries: ExportedEntry[];
  invalid: Array<Record<string, unknown>>;
  newer: number;
  undecryptable: number;
}> {
  const keys = await unwrapAll(bundle, secret);
  const entries: ExportedEntry[] = [];
  const invalid: Array<Record<string, unknown>> = [];
  let newer = 0;
  let undecryptable = 0;
  for (const row of bundle.entries) {
    if (row.deleted || !row.nonce_b64 || !row.ct_b64) continue;
    const dek = keys.get(row.key_version);
    if (!dek) {
      undecryptable++;
      continue;
    }
    let value: unknown;
    try {
      value = await decryptEntry(
        dek,
        decodeBase64Url(row.nonce_b64),
        decodeBase64Url(row.ct_b64),
        bundle.account_id,
        row.id,
        row.key_version,
      );
    } catch {
      undecryptable++;
      continue;
    }
    const read = readEntry(value);
    if (read.kind === "ok") {
      entries.push({ ...read.entry, received_at: row.received_at });
    } else if (read.kind === "invalid") {
      invalid.push({
        ...(read.value as Record<string, unknown>),
        received_at: row.received_at,
        _invalid: true,
      });
    } else newer++;
  }
  entries.sort((a, b) => a.ts.localeCompare(b.ts));
  return { entries, invalid, newer, undecryptable };
}

export async function writeDecryptedBundle(
  file: string,
  outDir: string,
  secret: BundleSecret,
): Promise<{
  entries: number;
  invalid: number;
  newer: number;
  reminders: number;
  undecryptable: number;
}> {
  const bundle = parseBundle(await Deno.readTextFile(file));
  const { entries, invalid, newer, undecryptable } = await decryptBundle(
    bundle,
    secret,
  );
  await Deno.mkdir(outDir, { recursive: true });
  const write = (name: string, text: string) =>
    Deno.writeTextFile(path.join(outDir, name), text);
  await write("entries.jsonl", toJsonl([...entries, ...invalid]));
  await write("entries.csv", entriesToCsv(entries));
  await write("reminders.jsonl", toJsonl(bundle.reminders ?? []));
  await write("dictionaries.json", dictionariesJson());
  return {
    entries: entries.length,
    invalid: invalid.length,
    newer,
    reminders: bundle.reminders?.length ?? 0,
    undecryptable,
  };
}
