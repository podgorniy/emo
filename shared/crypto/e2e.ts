// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * End-to-end cryptographic operations:
 * - DEK generation
 * - KEK derivation (Argon2id and Recovery HKDF)
 * - auth_key derivation (HKDF)
 * - AES-256-GCM encrypt / decrypt / wrap / unwrap with AAD
 * Specification: architecture.md §5.
 */

import { argon2 } from "./argon2.ts";
import {
  ARGON2_DEFAULT_PARAMS,
  HKDF_INFO_AUTH,
  HKDF_INFO_RECOVERY,
} from "./constants.ts";
import { buildDraftAad, buildEntryAad, buildPrefsAad } from "./aad.ts";
import { canonicalizeJson, padEntryPlaintext } from "../entry.ts";
import type { DraftV2, EntryV2 } from "../entry.ts";

const textEncoder = new TextEncoder();

function toBufferSource(buf: Uint8Array): BufferSource {
  return buf as unknown as BufferSource;
}

/** Generates a new random 32-byte Data Encryption Key (DEK) */
export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Generates a random 16-byte recovery secret */
export function generateRecoverySecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** Generates a random 16-byte Argon2id salt */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** Generates a random 12-byte (96-bit) AES-GCM nonce */
export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12));
}

/** Computes SHA-256 of data */
export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? textEncoder.encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", toBufferSource(bytes));
  return new Uint8Array(hash);
}

/**
 * Derives the auth_key proof (32 bytes) from raw DEK:
 * HKDF-SHA256(ikm = DEK, salt = UTF-8(account_id), info = "emo-auth/v1", L = 32)
 */
export async function deriveAuthKey(
  dekRaw: Uint8Array,
  accountId: string,
): Promise<Uint8Array> {
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    toBufferSource(dekRaw),
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );

  const saltBytes = textEncoder.encode(accountId);
  const infoBytes = textEncoder.encode(HKDF_INFO_AUTH);

  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toBufferSource(saltBytes),
      info: toBufferSource(infoBytes),
    },
    hkdfKey,
    256, // 32 bytes * 8 bits
  );

  return new Uint8Array(derived);
}

/**
 * Derives KEK_recovery from 16-byte recovery secret:
 * HKDF-SHA256(ikm = s, salt = UTF-8(account_id), info = "emo-recovery/v1", L = 32) -> AES-256-GCM
 */
export async function deriveRecoveryKek(
  recoverySecret: Uint8Array,
  accountId: string,
): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    toBufferSource(recoverySecret),
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );

  const saltBytes = textEncoder.encode(accountId);
  const infoBytes = textEncoder.encode(HKDF_INFO_RECOVERY);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toBufferSource(saltBytes),
      info: toBufferSource(infoBytes),
    },
    hkdfKey,
    256,
  );

  return crypto.subtle.importKey(
    "raw",
    derivedBits,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Derives KEK_pass from passphrase using Argon2id
 */
export async function derivePassphraseKek(
  passphrase: string,
  salt: Uint8Array,
  params: { m: number; t: number; p: number } = ARGON2_DEFAULT_PARAMS,
): Promise<CryptoKey> {
  const hashBytes = await argon2(passphrase, salt, params);

  return crypto.subtle.importKey(
    "raw",
    toBufferSource(hashBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Imports raw DEK as an AES-256-GCM CryptoKey
 */
export async function importDek(
  dekRaw: Uint8Array,
  extractable = false,
): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    toBufferSource(dekRaw),
    { name: "AES-GCM" },
    extractable,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts plaintext with AES-256-GCM and optional AAD. The nonce is random;
 * passing one (here and in the wrappers below) is for the fixed test vectors
 * only (architecture.md §5.5) — never reuse a nonce with the same key.
 */
export async function encryptGcm(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad?: Uint8Array,
  nonce?: Uint8Array,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const iv = nonce ?? generateNonce();
  const algorithm: AesGcmParams = {
    name: "AES-GCM",
    iv: toBufferSource(iv),
  };
  if (aad) {
    algorithm.additionalData = toBufferSource(aad);
  }

  const encryptedBuffer = await crypto.subtle.encrypt(
    algorithm,
    key,
    toBufferSource(plaintext),
  );

  return {
    nonce: iv,
    ciphertext: new Uint8Array(encryptedBuffer),
  };
}

/**
 * Decrypts ciphertext with AES-256-GCM and optional AAD
 */
export async function decryptGcm(
  key: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const algorithm: AesGcmParams = {
    name: "AES-GCM",
    iv: toBufferSource(nonce),
  };
  if (aad) {
    algorithm.additionalData = toBufferSource(aad);
  }

  const decryptedBuffer = await crypto.subtle.decrypt(
    algorithm,
    key,
    toBufferSource(ciphertext),
  );

  return new Uint8Array(decryptedBuffer);
}

/**
 * Wraps raw DEK (32 bytes) with a KEK (AES-256-GCM) and AAD
 */
export async function wrapDek(
  kek: CryptoKey,
  dekRaw: Uint8Array,
  aad: Uint8Array,
  nonce?: Uint8Array,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  return await encryptGcm(kek, dekRaw, aad, nonce);
}

/**
 * Unwraps raw DEK (32 bytes) with a KEK (AES-256-GCM) and AAD
 */
export async function unwrapDek(
  kek: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  return await decryptGcm(kek, nonce, ciphertext, aad);
}

/**
 * Encrypts an EntryV2 object:
 * 1. Serializes to canonical JSON
 * 2. Pads with ASCII spaces to multiple of 2048 bytes
 * 3. Encrypts with AES-256-GCM using Entry AAD (bound to the entry's key_version)
 */
export async function encryptEntry(
  dek: CryptoKey,
  entry: EntryV2,
  accountId: string,
  keyVersion: number,
  nonce?: Uint8Array,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const jsonStr = canonicalizeJson(entry);
  const padded = padEntryPlaintext(jsonStr);
  const aad = buildEntryAad(accountId, entry.id, keyVersion);
  return await encryptGcm(dek, padded, aad, nonce);
}

/**
 * Decrypts an EntryV2 object:
 * 1. Decrypts with AES-256-GCM using Entry AAD
 * 2. Parses JSON (JSON.parse automatically ignores trailing ASCII whitespace padding)
 */
export async function decryptEntry(
  dek: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  accountId: string,
  entryId: string,
  keyVersion = 1,
): Promise<EntryV2> {
  const aad = buildEntryAad(accountId, entryId, keyVersion);
  const decryptedBytes = await decryptGcm(dek, nonce, ciphertext, aad);
  const text = new TextDecoder().decode(decryptedBytes);
  return JSON.parse(text) as EntryV2;
}

/**
 * Encrypts the check-in form draft: padded like an entry, AAD
 * `"emo-draft/v1" || account_id` (architecture.md §5.5, ui.md §6.2).
 */
export async function encryptDraft(
  dek: CryptoKey,
  draft: DraftV2,
  accountId: string,
  nonce?: Uint8Array,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const padded = padEntryPlaintext(canonicalizeJson(draft));
  return await encryptGcm(dek, padded, buildDraftAad(accountId), nonce);
}

/** Decrypts a draft produced by `encryptDraft`. */
export async function decryptDraft(
  dek: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  accountId: string,
): Promise<DraftV2> {
  const bytes = await decryptGcm(
    dek,
    nonce,
    ciphertext,
    buildDraftAad(accountId),
  );
  return JSON.parse(new TextDecoder().decode(bytes)) as DraftV2;
}

/**
 * Encrypts preferences object with Prefs AAD
 */
export async function encryptPrefs(
  dek: CryptoKey,
  prefsObj: unknown,
  accountId: string,
  keyVersion = 1,
  nonce?: Uint8Array,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const jsonStr = canonicalizeJson(prefsObj);
  const jsonBytes = textEncoder.encode(jsonStr);
  const aad = buildPrefsAad(accountId, keyVersion);
  return await encryptGcm(dek, jsonBytes, aad, nonce);
}

/**
 * Decrypts preferences object with Prefs AAD
 */
export async function decryptPrefs<T = unknown>(
  dek: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  accountId: string,
  keyVersion = 1,
): Promise<T> {
  const aad = buildPrefsAad(accountId, keyVersion);
  const decryptedBytes = await decryptGcm(dek, nonce, ciphertext, aad);
  const text = new TextDecoder().decode(decryptedBytes);
  return JSON.parse(text) as T;
}
