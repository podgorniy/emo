// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Decrypting many stored entries (performance.md §3.1): in
 * `decrypt.worker.ts`, in batches of 200, so years of check-ins never freeze
 * the screen. Where the Worker cannot run or fails (logged as
 * `decrypt.fallback_main_thread`), the same batches run here, yielding to the
 * page between them. Plaintext only ever lives in memory.
 */

import { getCachedDek } from "./crypto.ts";
import {
  type CipherRow,
  type ReadResult,
  readStoredEntry,
} from "./entryRead.ts";
import { recordDiag } from "./diag.ts";

export type { CipherRow, ReadResult };

export const DECRYPT_BATCH = 200;

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (out: ReadResult[]) => void; reject: (err: Error) => void }
>();

function failPending(err: Error) {
  for (const job of pending.values()) job.reject(err);
  pending.clear();
}

/** The Worker, started on first use; null where pages cannot have one. */
function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined" || typeof document === "undefined") {
    return null;
  }
  try {
    worker = new Worker(new URL("./decrypt.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
  worker.onmessage = (e: MessageEvent) => {
    const { id, results } = e.data;
    const job = pending.get(id);
    pending.delete(id);
    job?.resolve(results);
  };
  worker.onerror = (e) => {
    e.preventDefault();
    stopDecryptWorker();
  };
  worker.onmessageerror = () => stopDecryptWorker();
  return worker;
}

function inWorker(
  w: Worker,
  dek: CryptoKey,
  accountId: string,
  rows: CipherRow[],
): Promise<ReadResult[]> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      w.postMessage({ id, dek, accountId, rows });
    } catch (err) {
      // A browser that cannot clone a CryptoKey into a Worker
      pending.delete(id);
      reject(err as Error);
    }
  });
}

async function inThisThread(
  dek: CryptoKey,
  accountId: string,
  rows: CipherRow[],
): Promise<ReadResult[]> {
  const out: ReadResult[] = [];
  for (const row of rows) out.push(await readStoredEntry(dek, accountId, row));
  await new Promise((r) => setTimeout(r, 0));
  return out;
}

/**
 * Every row decrypted and read, in the order given; `onBatch` sees each
 * batch as it is done. Throws only when the device is locked.
 */
export async function decryptRows(
  rows: CipherRow[],
  accountId: string,
  onBatch?: (results: ReadResult[]) => void,
): Promise<ReadResult[]> {
  const dek = getCachedDek();
  if (!dek) throw new Error("Device is locked");
  const out: ReadResult[] = [];
  let useWorker = true;
  for (let i = 0; i < rows.length; i += DECRYPT_BATCH) {
    const batch = rows.slice(i, i + DECRYPT_BATCH)
      .map(({ id, key_version, nonce_b64, ct_b64 }) => ({
        id,
        key_version,
        nonce_b64,
        ct_b64,
      }));
    let results: ReadResult[] | null = null;
    const w = useWorker ? getWorker() : null;
    if (w) {
      try {
        results = await inWorker(w, dek, accountId, batch);
      } catch {
        useWorker = false;
        stopDecryptWorker();
        void recordDiag("decrypt.fallback_main_thread", "crypto");
      }
    }
    results ??= await inThisThread(dek, accountId, batch);
    out.push(...results);
    onBatch?.(results);
  }
  return out;
}

/** History closed, or the device locked: the Worker and its jobs go. */
export function stopDecryptWorker(): void {
  worker?.terminate();
  worker = null;
  failPending(new Error("Decrypt worker stopped"));
}
