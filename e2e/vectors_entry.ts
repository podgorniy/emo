// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Browser entry for `vectors.e2e.ts`: bundled with `deno bundle`, it exposes
 * `runVectors()`, which runs the same cases as `shared/crypto/vectors_test.ts`
 * with the browser's WebCrypto and hash-wasm.
 */
import V from "../shared/fixtures/crypto/v1.json" with { type: "json" };
import { vectorCases } from "../shared/crypto/vectors.ts";

export interface VectorResult {
  name: string;
  error: string | null;
}

(globalThis as { runVectors?: () => Promise<VectorResult[]> }).runVectors =
  async () => {
    const results: VectorResult[] = [];
    for (const c of vectorCases(V)) {
      try {
        await c.run();
        results.push({ name: c.name, error: null });
      } catch (err) {
        results.push({ name: c.name, error: String(err) });
      }
    }
    return results;
  };
