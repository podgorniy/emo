// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals, assertRejects } from "@std/assert";
import {
  decryptDraft,
  decryptEntry,
  decryptPrefs,
  deriveAuthKey,
  derivePassphraseKek,
  deriveRecoveryKek,
  encryptDraft,
  encryptEntry,
  encryptPrefs,
  generateDek,
  generateRecoverySecret,
  generateSalt,
  importDek,
  unwrapDek,
  wrapDek,
} from "./e2e.ts";
import { buildKeyringAad } from "./aad.ts";
import { timingSafeEqual } from "./encoding.ts";
import type { DraftV2, EntryV2 } from "../entry.ts";

Deno.test("e2e - DEK generation and auth_key derivation", async () => {
  const dekRaw = generateDek();
  assertEquals(dekRaw.byteLength, 32);

  const accountId = "0192f1c4-7b43-7000-8000-000000000001";
  const authKey = await deriveAuthKey(dekRaw, accountId);
  assertEquals(authKey.byteLength, 32);

  // Deterministic for same DEK and accountId
  const authKey2 = await deriveAuthKey(dekRaw, accountId);
  assertEquals(authKey, authKey2);

  // Different for different accountId
  const authKey3 = await deriveAuthKey(
    dekRaw,
    "0192f1c4-7b43-7000-8000-000000000002",
  );
  assertEquals(timingSafeEqual(authKey, authKey3), false);
});

Deno.test("e2e - Passphrase KEK wrap and unwrap DEK", async () => {
  const dekRaw = generateDek();
  const accountId = "0192f1c4-7b43-7000-8000-000000000001";
  const salt = generateSalt();
  const passphrase = "correct-horse-battery-staple";

  // Light params for quick test execution
  const kek = await derivePassphraseKek(passphrase, salt, {
    m: 1024,
    t: 1,
    p: 1,
  });
  const aad = buildKeyringAad(accountId, 1);

  const wrapped = await wrapDek(kek, dekRaw, aad);
  const unwrapped = await unwrapDek(
    kek,
    wrapped.nonce,
    wrapped.ciphertext,
    aad,
  );

  assertEquals(unwrapped, dekRaw);

  // Wrong passphrase fails to unwrap
  const wrongKek = await derivePassphraseKek("wrong-passphrase", salt, {
    m: 1024,
    t: 1,
    p: 1,
  });
  await assertRejects(async () => {
    await unwrapDek(wrongKek, wrapped.nonce, wrapped.ciphertext, aad);
  });
});

Deno.test("e2e - Recovery KEK wrap and unwrap DEK", async () => {
  const dekRaw = generateDek();
  const accountId = "0192f1c4-7b43-7000-8000-000000000001";
  const recoverySecret = generateRecoverySecret();

  const kek = await deriveRecoveryKek(recoverySecret, accountId);
  const aad = buildKeyringAad(accountId, 1);

  const wrapped = await wrapDek(kek, dekRaw, aad);
  const unwrapped = await unwrapDek(
    kek,
    wrapped.nonce,
    wrapped.ciphertext,
    aad,
  );

  assertEquals(unwrapped, dekRaw);
});

Deno.test("e2e - Entry encrypt and decrypt with padding and AAD", async () => {
  const dekRaw = generateDek();
  const dek = await importDek(dekRaw);
  const accountId = "0192f1c4-7b43-7000-8000-000000000001";

  const entry: EntryV2 = {
    schema_v: 2,
    id: "018f3a2b-1111-4000-8000-000000000001",
    ts: "2026-10-08T10:00:00.000Z",
    tz_offset_min: 180,
    trigger: "manual",
    reminder_id: null,
    latency_sec: 15,
    hidden_sec: 0,
    skipped: false,
    abandoned: false,
    untouched: null,
    ui: null,
    body: {
      locations: ["chest"],
      qualities: ["warmth"],
      intensity: 4,
    },
    affect: {
      valence: 2,
      arousal: 3,
      word: "joy.peace",
      word_confidence: "sure",
    },
    urge: "rest",
    head_mode: null,
    context_tag: "home",
    context_other: null,
    note: "Quiet morning with tea",
  };

  const encrypted = await encryptEntry(dek, entry, accountId, 1);

  // Padded plaintext is at least 2048 bytes + 16 bytes GCM tag = 2064 bytes
  assertEquals(encrypted.ciphertext.byteLength >= 2064, true);

  const decrypted = await decryptEntry(
    dek,
    encrypted.nonce,
    encrypted.ciphertext,
    accountId,
    entry.id,
    1,
  );

  assertEquals(decrypted, entry);

  // Swapped account ID in AAD fails decryption
  await assertRejects(async () => {
    await decryptEntry(
      dek,
      encrypted.nonce,
      encrypted.ciphertext,
      "wrong-account-id",
      entry.id,
      1,
    );
  });

  // Swapped entry ID in AAD fails decryption
  await assertRejects(async () => {
    await decryptEntry(
      dek,
      encrypted.nonce,
      encrypted.ciphertext,
      accountId,
      "018f3a2b-2222-4000-8000-000000000002",
      1,
    );
  });

  // Wrong key_version in AAD fails decryption
  await assertRejects(async () => {
    await decryptEntry(
      dek,
      encrypted.nonce,
      encrypted.ciphertext,
      accountId,
      entry.id,
      2,
    );
  });
});

Deno.test("e2e - Draft encrypt and decrypt with padding and AAD", async () => {
  const dek = await importDek(generateDek());
  const accountId = "0192f1c4-7b43-7000-8000-000000000001";
  const draft: DraftV2 = {
    schema_v: 2,
    step: 9,
    trigger: "manual",
    reminder_id: null,
    started_at: 1791460800000,
    last_interaction_at: 1791460860000,
    hidden_ms: 0,
    hidden_since: null,
    touched: ["intensity"],
    answers: {
      locations: ["chest"],
      qualities: ["squeeze"],
      intensity: 6,
      valence: 0,
      arousal: 5,
      word: null,
      word_confidence: null,
      urge: null,
      head_mode: 5,
      context_tag: "home",
      context_other: "",
      note: "кухня, вечер",
    },
  };

  const enc = await encryptDraft(dek, draft, accountId);
  // Padded like an entry: 2048 bytes of plaintext + 16-byte GCM tag
  assertEquals(enc.ciphertext.byteLength, 2064);
  assertEquals(
    await decryptDraft(dek, enc.nonce, enc.ciphertext, accountId),
    draft,
  );
  // Bound to the account
  await assertRejects(() =>
    decryptDraft(dek, enc.nonce, enc.ciphertext, "another-account")
  );
});

Deno.test("e2e - Prefs encrypt and decrypt", async () => {
  const dekRaw = generateDek();
  const dek = await importDek(dekRaw);
  const accountId = "0192f1c4-7b43-7000-8000-000000000001";
  const prefs = {
    appearance: {
      preset: "paper",
      mode: "system",
      contrast: "normal",
    },
  };

  const encrypted = await encryptPrefs(dek, prefs, accountId, 1);
  const decrypted = await decryptPrefs(
    dek,
    encrypted.nonce,
    encrypted.ciphertext,
    accountId,
    1,
  );

  assertEquals(decrypted, prefs);
});
