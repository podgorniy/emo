// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Runs Argon2id in `kdf.worker.ts`; if the worker cannot run it, once more on
 * the main thread (logged as `kdf.fallback_main_thread`); if that fails too,
 * the browser cannot do it (`KdfUnsupported`, shown as
 * `auth.passphrase.kdfUnsupported`).
 * Specification: performance.md §3.1, reliability.md §1.2.
 */

import {
  type Argon2Fn,
  argon2InThisThread,
  setArgon2,
} from "../../../shared/crypto/argon2.ts";
import { recordDiag } from "./diag.ts";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (out: Uint8Array) => void; reject: (err: Error) => void }
>();

let idleTimer: ReturnType<typeof setTimeout> | null = null;
const WORKER_IDLE_TIMEOUT_MS = 10_000;

function scheduleIdleTermination() {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size === 0) {
      stopKdfWorker();
    }
  }, WORKER_IDLE_TIMEOUT_MS);
}

/** Terminates the Argon2id Web Worker and frees its WASM memory. */
export function stopKdfWorker(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (worker) {
    worker.terminate();
    worker = null;
    for (const job of pending.values()) {
      job.reject(new Error("KDF worker stopped"));
    }
    pending.clear();
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  worker = new Worker(new URL("./kdf.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent) => {
    const { id, ok, out, error } = e.data;
    const job = pending.get(id);
    pending.delete(id);
    if (ok) job?.resolve(new Uint8Array(out));
    else job?.reject(new Error(error ?? "Argon2 failed in the worker"));
    if (pending.size === 0) scheduleIdleTermination();
  };
  worker.onerror = (e) => {
    e.preventDefault();
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    for (const job of pending.values()) {
      job.reject(new Error("KDF worker failed"));
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

const inWorker: Argon2Fn = (passphrase, salt, params) =>
  new Promise((resolve, reject) => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, passphrase, salt, params });
  });

export class KdfUnsupported extends Error {
  override name = "KdfUnsupported";
}

/** Installed once at start; nothing loads until a passphrase is entered. */
export function installKdfWorker(): void {
  if (typeof Worker === "undefined") return;
  setArgon2(async (passphrase, salt, params) => {
    try {
      return await inWorker(passphrase, salt, params);
    } catch {
      void recordDiag("kdf.fallback_main_thread", "crypto");
      try {
        return await argon2InThisThread(passphrase, salt, params);
      } catch {
        throw new KdfUnsupported("This browser cannot run Argon2id");
      }
    }
  });
}
