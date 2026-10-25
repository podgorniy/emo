// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The raw Argon2id call behind `derivePassphraseKek`. By default it loads
 * `hash-wasm` on first use (a separate chunk in the browser build, so the app
 * shell never carries the WASM); the browser app replaces it with a Worker
 * (`client/src/lib/kdf.ts`). Specification: architecture.md §5.1,
 * performance.md §3.1.
 */

export interface Argon2Params {
  m: number;
  t: number;
  p: number;
}

export type Argon2Fn = (
  passphrase: string,
  salt: Uint8Array,
  params: Argon2Params,
) => Promise<Uint8Array>;

/** The same computation in this thread (Deno, tests, and the app's fallback). */
export const argon2InThisThread: Argon2Fn = async (
  passphrase,
  salt,
  params,
) => {
  const { argon2id } = await import("hash-wasm");
  return await argon2id({
    password: passphrase,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: "binary",
  });
};

let current: Argon2Fn = argon2InThisThread;

export function setArgon2(fn: Argon2Fn): void {
  current = fn;
}

export function argon2(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  return current(passphrase, salt, params);
}
