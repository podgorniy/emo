// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stored vectors in Deno (architecture.md §5.5, development.md §5.1); `make e2e` runs the
 * same cases in Chromium. Fix the code, never the vectors.
 */
import { vectorCases } from "./vectors.ts";

const V = JSON.parse(
  await Deno.readTextFile(
    new URL("../fixtures/crypto/v1.json", import.meta.url),
  ),
);

for (const c of vectorCases(V)) Deno.test(`vectors - ${c.name}`, c.run);
