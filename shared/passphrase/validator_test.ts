// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { validatePassphrase } from "./validator.ts";

Deno.test("passphrase - valid ascii with length >= 8", () => {
  const res = validatePassphrase("correct horse");
  assertEquals(res.valid, true);
  assertEquals(res.asciiOnly, true);
  assertEquals(res.lengthValid, true);
  assertEquals(res.errors.length, 0);
});

Deno.test("passphrase - reject short < 8", () => {
  const res = validatePassphrase("abc12");
  assertEquals(res.valid, false);
  assertEquals(res.lengthValid, false);
});

Deno.test("passphrase - reject non-ascii (cyrillic, etc)", () => {
  const res = validatePassphrase("парольная фраза");
  assertEquals(res.valid, false);
  assertEquals(res.asciiOnly, false);
  assertEquals(res.errors.includes("auth.passphrase.error.asciiOnly"), true);
});

Deno.test("passphrase - informational score does not block", () => {
  // A simple password >= 8 characters is valid even with low score
  const res = validatePassphrase("12345678");
  assertEquals(res.valid, true);
  assertEquals(res.score <= 2, true);
});
