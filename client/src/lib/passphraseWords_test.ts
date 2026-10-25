// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals } from "@std/assert";
import { validatePassphrase } from "../../../shared/passphrase/validator.ts";
import {
  SUGGESTED_WORDS,
  suggestPassphrase,
  WORDS,
} from "./passphraseWords.ts";

Deno.test("passphrase words - five words, valid, strong, ASCII", () => {
  assertEquals(new Set(WORDS).size, WORDS.length);
  assert(WORDS.every((w) => /^[a-z]+$/.test(w)));
  // Five words keep about 64 bits (ui.md §12.5)
  assert(SUGGESTED_WORDS * Math.log2(WORDS.length) > 63);
  for (let i = 0; i < 50; i++) {
    const p = suggestPassphrase();
    assertEquals(p.split(" ").length, SUGGESTED_WORDS);
    const v = validatePassphrase(p);
    assertEquals(v.valid, true, p);
    assertEquals(v.strengthLabel, "strong", p);
  }
});

Deno.test("passphrase words - none about pain, death or distress", () => {
  for (
    const w of [
      "agony",
      "grief",
      "despair",
      "suffocate",
      "handgun",
      "hate",
      "nervous",
      "helpless",
      "skinny",
    ]
  ) {
    assertEquals(WORDS.includes(w), false, w);
  }
});
