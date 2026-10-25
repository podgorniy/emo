// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * performance.md §4.1: `tx` takes a synchronous callback only. The
 * `@ts-expect-error` lines are the test: if an async callback ever compiles,
 * the directive is unused and type checking fails.
 */
import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { tx } from "./index.ts";

Deno.test("db - tx returns the callback's value and refuses async callbacks", () => {
  const db = new DatabaseSync(":memory:");
  const n: number = tx(db, () => 42);
  assertEquals(n, 42);
  if (Math.random() > 2) {
    // @ts-expect-error an async callback must not compile
    // deno-lint-ignore require-await
    tx(db, async () => 1);
    // @ts-expect-error nor one that returns a promise
    tx(db, () => Promise.resolve(1));
  }
});
