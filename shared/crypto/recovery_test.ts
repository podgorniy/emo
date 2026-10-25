// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals, assertRejects } from "@std/assert";
import {
  computeRecoveryChecksum,
  CROCKFORD_ALPHABET,
  decodeCrockford,
  encodeCrockford,
  formatRecoveryInput,
  generateRecoveryKey,
  parseAndValidateRecoveryKey,
} from "./recovery.ts";

// Independent vector: s = 0x00..0x0f; c computed with
// `printf 'emo-recovery-check/v1' + s | shasum -a 256` (architecture.md §5.1).
const VECTOR_SECRET = Uint8Array.from({ length: 16 }, (_, i) => i);
const VECTOR_CHECKSUM = "f2de4219";
const VECTOR_KEY = "000G-40R4-0M30-E209-185G-R38E-1ZSD-WGGS";

Deno.test("recovery key - checksum matches SHA-256(prefix || s) vector", async () => {
  const c = await computeRecoveryChecksum(VECTOR_SECRET);
  assertEquals(
    Array.from(c, (b) => b.toString(16).padStart(2, "0")).join(""),
    VECTOR_CHECKSUM,
  );
  assertEquals(await parseAndValidateRecoveryKey(VECTOR_KEY), VECTOR_SECRET);
});

Deno.test("recovery key - generate and validate roundtrip", async () => {
  const { secret, formatted } = await generateRecoveryKey();
  assertEquals(formatted.length, 39); // 32 chars + 7 hyphens = 39

  const parsed = await parseAndValidateRecoveryKey(formatted);
  assertEquals(parsed, secret);
});

Deno.test("recovery key - normalization (case, O/0, I/L/1, dashes, spaces)", async () => {
  const { secret, formatted } = await generateRecoveryKey();

  // Test lowercase and with extra spaces
  const lower = formatted.toLowerCase().replace(/-/g, " ");
  const parsedLower = await parseAndValidateRecoveryKey(lower);
  assertEquals(parsedLower, secret);

  // O -> 0 and I/L -> 1 (the vector contains several zeros and ones)
  const lookalikes = VECTOR_KEY.replace(/0/g, "O").replace(
    /1/g,
    (_, i) => i % 2 ? "I" : "l",
  );
  assertEquals(await parseAndValidateRecoveryKey(lookalikes), VECTOR_SECRET);
});

Deno.test("recovery key - a typo in any character is caught", async () => {
  const compact = VECTOR_KEY.replace(/-/g, "");
  for (let i = 0; i < compact.length; i++) {
    const original = compact[i];
    const replacement = CROCKFORD_ALPHABET[
      (CROCKFORD_ALPHABET.indexOf(original) + 1) % CROCKFORD_ALPHABET.length
    ];
    const typo = compact.slice(0, i) + replacement + compact.slice(i + 1);
    await assertRejects(() => parseAndValidateRecoveryKey(typo), Error);
  }
});

Deno.test("recovery key - wrong length and U are rejected", async () => {
  const compact = VECTOR_KEY.replace(/-/g, "");
  await assertRejects(
    () => parseAndValidateRecoveryKey(compact + "0"),
    Error,
    "exactly 32",
  );
  await assertRejects(
    () => parseAndValidateRecoveryKey(compact.slice(0, 31)),
    Error,
    "exactly 32",
  );
  await assertRejects(
    () => parseAndValidateRecoveryKey("U" + compact.slice(1)),
    Error,
    "Invalid Crockford",
  );
});

Deno.test("recovery key - invalid checksum rejected", async () => {
  const { formatted } = await generateRecoveryKey();

  // Flip the last character
  const chars = formatted.split("");
  const lastIdx = chars.length - 1;
  chars[lastIdx] = chars[lastIdx] === "A" ? "B" : "A";
  const corrupted = chars.join("");

  await assertRejects(
    async () => {
      await parseAndValidateRecoveryKey(corrupted);
    },
    Error,
    "checksum mismatch",
  );
});

Deno.test("crockford - basic encode / decode", () => {
  const data = new Uint8Array([0, 1, 2, 255]);
  const encoded = encodeCrockford(data);
  const decoded = decodeCrockford(encoded);
  assertEquals(decoded, data);
});

Deno.test("recovery - the field groups and normalises while typing", () => {
  assertEquals(formatRecoveryInput("abcd efgh"), "ABCD-EFGH");
  assertEquals(formatRecoveryInput("o1il-"), "0111");
  assertEquals(
    formatRecoveryInput("x".repeat(40)).replaceAll("-", "").length,
    32,
  );
  assertEquals(
    formatRecoveryInput("60rk4csm6mv3ee1s78xkrf9y7wv33927"),
    "60RK-4CSM-6MV3-EE1S-78XK-RF9Y-7WV3-3927",
  );
});
