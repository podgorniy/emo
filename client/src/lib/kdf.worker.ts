// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Argon2id off the main thread (performance.md §3.1): the 64 MiB
 * hash would otherwise freeze the screen for seconds on a slow phone. Loaded
 * only when a passphrase is entered.
 */

import {
  argon2InThisThread,
  type Argon2Params,
} from "../../../shared/crypto/argon2.ts";

interface Request {
  id: number;
  passphrase: string;
  salt: Uint8Array;
  params: Argon2Params;
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async (e) => {
  const { id, passphrase, salt, params } = e.data;
  try {
    const out = await argon2InThisThread(passphrase, salt, params);
    scope.postMessage({ id, ok: true, out }, [out.buffer]);
  } catch (err) {
    scope.postMessage({
      id,
      ok: false,
      error: (err as Error)?.name ?? "Error",
    });
  }
};
