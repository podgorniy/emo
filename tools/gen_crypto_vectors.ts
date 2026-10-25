// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Writes `shared/fixtures/crypto/v1.json`: fixed inputs and the bytes the
 * crypto of architecture.md §5 produces from them. Run once when the vectors are
 * created; afterwards the file is the reference that every later version must
 * reproduce byte for byte (`shared/crypto/vectors_test.ts`). Never regenerate
 * it to make a failing test pass: a difference means stored data would no
 * longer open.
 *
 *   deno run -A tools/gen_crypto_vectors.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildKeyringAad } from "../shared/crypto/aad.ts";
import { ARGON2_DEFAULT_PARAMS } from "../shared/crypto/constants.ts";
import {
  deriveAuthKey,
  derivePassphraseKek,
  deriveRecoveryKek,
  encryptDraft,
  encryptEntry,
  encryptPrefs,
  importDek,
  sha256,
  wrapDek,
} from "../shared/crypto/e2e.ts";
import { encodeBase64Url, encodeHex } from "../shared/crypto/encoding.ts";
import {
  computeRecoveryChecksum,
  encodeCrockford,
} from "../shared/crypto/recovery.ts";
import {
  canonicalizeJson,
  type DraftV2,
  type EntryV2,
} from "../shared/entry.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "shared/fixtures/crypto/v1.json");

const fill = (len: number, start: number) =>
  Uint8Array.from({ length: len }, (_, i) => (start + i) & 0xff);

const accountId = "0192f1c4-7b43-7000-8000-000000000001";
const passphrase = "correct horse battery staple";
const salt = fill(16, 0x01);
const dek = fill(32, 0xa0);
const recoverySecret = fill(16, 0x30);
const nonces = {
  keyring_pass: fill(12, 0x10),
  keyring_recovery: fill(12, 0x20),
  entry: fill(12, 0x40),
  prefs: fill(12, 0x50),
  draft: fill(12, 0x60),
};
const entry: EntryV2 = JSON.parse(
  await Deno.readTextFile(path.join(ROOT, "shared/fixtures/entry.v2.json")),
);
const prefs = {
  appearance: { themeId: "calm", seed: null, gradient: false, seed2: null },
};
const draft: DraftV2 = {
  schema_v: 2,
  step: 2,
  trigger: "manual",
  reminder_id: null,
  started_at: 1791367200000,
  last_interaction_at: 1791367230000,
  hidden_ms: 0,
  hidden_since: null,
  touched: [],
  answers: {
    locations: ["chest"],
    qualities: ["squeeze"],
    intensity: 5,
    valence: 0,
    arousal: 5,
    word: null,
    word_confidence: null,
    urge: null,
    head_mode: 5,
    context_tag: null,
    context_other: "",
    note: "",
  },
};

const b64 = encodeBase64Url;
const key = await importDek(dek);
const keyringAad = buildKeyringAad(accountId, 1);
const pass = await wrapDek(
  await derivePassphraseKek(passphrase, salt, ARGON2_DEFAULT_PARAMS),
  dek,
  keyringAad,
  nonces.keyring_pass,
);
const rec = await wrapDek(
  await deriveRecoveryKek(recoverySecret, accountId),
  dek,
  keyringAad,
  nonces.keyring_recovery,
);
const authKey = await deriveAuthKey(dek, accountId);
const checksum = await computeRecoveryChecksum(recoverySecret);
const recoveryKey = encodeCrockford(
  new Uint8Array([...recoverySecret, ...checksum]),
)
  .match(/.{4}/g)!.join("-");
const entryCt = await encryptEntry(key, entry, accountId, 1, nonces.entry);
const prefsCt = await encryptPrefs(key, prefs, accountId, 1, nonces.prefs);
const draftCt = await encryptDraft(key, draft, accountId, nonces.draft);

const vectors = {
  $comment:
    "architecture.md §5.5 test vectors. Generated once by tools/gen_crypto_vectors.ts; never regenerate.",
  inputs: {
    account_id: accountId,
    passphrase,
    kdf: {
      alg: "argon2id",
      m_kib: ARGON2_DEFAULT_PARAMS.m,
      t: ARGON2_DEFAULT_PARAMS.t,
      p: ARGON2_DEFAULT_PARAMS.p,
      salt_b64: b64(salt),
    },
    dek_hex: encodeHex(dek),
    recovery_secret_hex: encodeHex(recoverySecret),
    nonces: Object.fromEntries(
      Object.entries(nonces).map(([k, v]) => [k, b64(v)]),
    ),
    entry,
    prefs,
    draft,
  },
  expected: {
    auth_key_b64: b64(authKey),
    auth_hash_hex: encodeHex(await sha256(authKey)),
    recovery_key: recoveryKey,
    keyring: {
      key_version: 1,
      dek_wrapped_pass: {
        nonce_b64: b64(pass.nonce),
        ct_b64: b64(pass.ciphertext),
      },
      dek_wrapped_recovery: {
        nonce_b64: b64(rec.nonce),
        ct_b64: b64(rec.ciphertext),
      },
    },
    entry_canonical_sha256_hex: encodeHex(
      await sha256(canonicalizeJson(entry)),
    ),
    entry_ct_b64: b64(entryCt.ciphertext),
    prefs_ct_b64: b64(prefsCt.ciphertext),
    draft_ct_b64: b64(draftCt.ciphertext),
  },
};

try {
  await Deno.stat(OUT);
  console.error(
    `${OUT} exists; the vectors are permanent. Delete it only if you mean to.`,
  );
  Deno.exit(1);
} catch { /* the first run */ }
await Deno.mkdir(path.dirname(OUT), { recursive: true });
await Deno.writeTextFile(OUT, JSON.stringify(vectors, null, 2) + "\n");
console.log(`Wrote ${OUT}`);
