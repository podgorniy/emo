// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Client diagnostics without content (reliability.md §1.8): a ring buffer of
 * the last 100 `{ ts, code, where }` in `meta.diag`, lifetime counts per code
 * in `meta.diag_counts`, and the text "Copy diagnostics" puts on the
 * clipboard. A code is an error code, a DOMException name or a fixed event
 * name; anything else (text, ids, URLs) is refused, never stored.
 */

import { getMeta, getOutboxItems, setMeta } from "./db.ts";
import { deviceName } from "./devices.ts";
import { cachedInstance } from "./instance.ts";
import { CLIENT_VERSION } from "./version.ts";

export interface DiagRecord {
  ts: string;
  code: string;
  where: string;
}

const MAX_RECORDS = 100;
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,47}$/;

/** Records one event; silently drops anything that is not a plain name. */
export async function recordDiag(code: string, where: string): Promise<void> {
  if (!NAME.test(code) || !NAME.test(where)) return;
  try {
    const ring = (await getMeta<DiagRecord[]>("diag")) ?? [];
    ring.push({ ts: new Date().toISOString(), code, where });
    await setMeta("diag", ring.slice(-MAX_RECORDS));
    const counts = (await getMeta<Record<string, number>>("diag_counts")) ?? {};
    counts[code] = (counts[code] ?? 0) + 1;
    await setMeta("diag_counts", counts);
  } catch {
    // Diagnostics never break the app
  }
}

/** The name of an error, fit for `recordDiag`. */
export function errorCode(err: unknown): string {
  if (
    err && typeof err === "object" && "code" in err &&
    typeof err.code === "string"
  ) {
    return err.code;
  }
  if (err instanceof DOMException || err instanceof Error) return err.name;
  return "unknown";
}

/** What "Copy diagnostics" puts on the clipboard: versions, counts, codes. */
export async function diagnosticsText(): Promise<string> {
  const instance = await cachedInstance();
  const epoch = (await getMeta<string>("server_epoch")) ?? "";
  const counts = (await getMeta<Record<string, number>>("diag_counts")) ?? {};
  const ring = (await getMeta<DiagRecord[]>("diag")) ?? [];
  const report = {
    app: CLIENT_VERSION,
    server: instance?.version ?? null,
    epoch: epoch.slice(0, 8),
    platform: deviceName(navigator.userAgent),
    persisted: (await getMeta<boolean>("persisted")) ?? null,
    clock_skew_sec: (await getMeta<number>("clock_skew_sec")) ?? null,
    outbox: (await getOutboxItems()).length,
    undecryptable: (await getMeta<number>("undecryptable")) ?? 0,
    needs_newer_app: (await getMeta<number>("needs_newer_app")) ?? 0,
    renamed: (await getMeta<number>("renamed")) ?? 0,
    counts,
    recent: ring,
  };
  return JSON.stringify(report, null, 2);
}
