// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import {
  decryptEntry,
  deriveAuthKey,
  derivePassphraseKek,
  deriveRecoveryKek,
  encryptEntry,
  importDek,
  unwrapDek,
  wrapDek,
} from "./e2e.ts";
import { buildKeyringAad } from "./aad.ts";
import type { EntryV2 } from "../entry.ts";

Deno.test("crypto fixtures - deterministic vector verification", async () => {
  const accountId = "0192f1c4-7b43-7000-8000-000000000001";
  const passphrase = "correct-horse-battery-staple";

  // Fixed test bytes
  const salt = new Uint8Array([
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
  ]);
  const recoverySecret = new Uint8Array([
    16,
    15,
    14,
    13,
    12,
    11,
    10,
    9,
    8,
    7,
    6,
    5,
    4,
    3,
    2,
    1,
  ]);
  const dekRaw = new Uint8Array([
    0x2b,
    0x7e,
    0x15,
    0x16,
    0x28,
    0xae,
    0xd2,
    0xa6,
    0xab,
    0xf7,
    0x15,
    0x88,
    0x09,
    0xcf,
    0x4f,
    0x3c,
    0x2b,
    0x7e,
    0x15,
    0x16,
    0x28,
    0xae,
    0xd2,
    0xa6,
    0xab,
    0xf7,
    0x15,
    0x88,
    0x09,
    0xcf,
    0x4f,
    0x3c,
  ]);

  // Derive auth key
  const authKey = await deriveAuthKey(dekRaw, accountId);
  assertEquals(authKey.length, 32);

  // Derive KEKs
  const passKek = await derivePassphraseKek(passphrase, salt, {
    m: 1024,
    t: 1,
    p: 1,
  });
  const recoveryKek = await deriveRecoveryKek(recoverySecret, accountId);

  // Wrap DEK
  const keyringAad = buildKeyringAad(accountId, 1);
  const passWrapped = await wrapDek(passKek, dekRaw, keyringAad);
  const recoveryWrapped = await wrapDek(recoveryKek, dekRaw, keyringAad);

  // Unwrap DEK
  const unwrappedPass = await unwrapDek(
    passKek,
    passWrapped.nonce,
    passWrapped.ciphertext,
    keyringAad,
  );
  assertEquals(unwrappedPass, dekRaw);

  const unwrappedRecovery = await unwrapDek(
    recoveryKek,
    recoveryWrapped.nonce,
    recoveryWrapped.ciphertext,
    keyringAad,
  );
  assertEquals(unwrappedRecovery, dekRaw);

  // Entry encryption & decryption
  const dek = await importDek(dekRaw);
  const entry: EntryV2 = {
    schema_v: 2,
    id: "018f3a2b-1111-4000-8000-000000000001",
    ts: "2026-10-08T10:00:00.000Z",
    tz_offset_min: 180,
    trigger: "manual",
    reminder_id: null,
    latency_sec: 10,
    hidden_sec: 0,
    skipped: false,
    abandoned: false,
    untouched: null,
    ui: null,
    body: {
      locations: ["throat"],
      qualities: ["lump"],
      intensity: 5,
    },
    affect: {
      valence: -1,
      arousal: 6,
      word: "fear.anxiety",
      word_confidence: "guess",
    },
    urge: null,
    head_mode: null,
    context_tag: null,
    context_other: null,
    note: null,
  };

  const encryptedEntry = await encryptEntry(dek, entry, accountId, 1);
  const decryptedEntry = await decryptEntry(
    dek,
    encryptedEntry.nonce,
    encryptedEntry.ciphertext,
    accountId,
    entry.id,
    1,
  );
  assertEquals(decryptedEntry, entry);
});
