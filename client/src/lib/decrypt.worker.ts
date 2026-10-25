// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Decrypting many entries off the main thread (performance.md §3.1):
 * one message per batch of up to 200 rows. The DEK arrives as the page's
 * non-extractable `CryptoKey` (a structured clone stays non-extractable,
 * architecture.md §5.4) and is not kept between messages. Loaded when History
 * or an export first decrypts; terminated when History closes.
 */

import { type CipherRow, readStoredEntry } from "./entryRead.ts";

interface Request {
  id: number;
  dek: CryptoKey;
  accountId: string;
  rows: CipherRow[];
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = async (e) => {
  const { id, dek, accountId, rows } = e.data;
  const results = await Promise.all(
    rows.map((row) => readStoredEntry(dek, accountId, row)),
  );
  scope.postMessage({ id, results });
};
