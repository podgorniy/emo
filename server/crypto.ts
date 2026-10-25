// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Server-side cryptography:
 * - HMAC-SHA256 for email hashing and server secret validation
 * - AES-256-GCM for server-side encryption of email and invite codes
 * - SHA-256 for token, code and auth_proof hashing
 * - UUID v4 and v7 generation
 * Specification: architecture.md §5, §6.1, api.md §1.
 */

import {
  decodeBase64Url,
  encodeHex,
  timingSafeEqual,
} from "../shared/crypto/encoding.ts";
import { CROCKFORD_ALPHABET } from "../shared/crypto/recovery.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBufferSource(buf: Uint8Array): BufferSource {
  return buf as unknown as BufferSource;
}

/** Generates a standard RFC 9562 UUID v7 */
export function generateUuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();

  // 48-bit timestamp (big-endian)
  bytes[0] = (now / 0x10000000000) & 0xff;
  bytes[1] = (now / 0x100000000) & 0xff;
  bytes[2] = (now / 0x1000000) & 0xff;
  bytes[3] = (now / 0x10000) & 0xff;
  bytes[4] = (now / 0x100) & 0xff;
  bytes[5] = now & 0xff;

  // Version 7 in top 4 bits of octet 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant RFC 4122 in top 2 bits of octet 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = encodeHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20, 32)}`;
}

/** Generates standard UUID v4 */
export function generateUuidV4(): string {
  return crypto.randomUUID();
}

/** Computes SHA-256 of data, returns raw Uint8Array */
export async function sha256Bytes(
  data: Uint8Array | string,
): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? textEncoder.encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", toBufferSource(bytes));
  return new Uint8Array(hash);
}

/** Computes SHA-256 of data, returns hex string */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const hash = await sha256Bytes(data);
  return encodeHex(hash);
}

/** HMAC-SHA256 with SERVER_SECRET */
export async function hmacSha256(
  secretBytes: Uint8Array,
  message: Uint8Array | string,
): Promise<Uint8Array> {
  const msgBytes = typeof message === "string"
    ? textEncoder.encode(message)
    : message;
  const key = await crypto.subtle.importKey(
    "raw",
    toBufferSource(secretBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toBufferSource(msgBytes),
  );
  return new Uint8Array(signature);
}

/** trim → NFC → lower-case (api.md §2.1); "" for anything but a
 * string. `email_hmac` is long-lived, so this order is permanent. */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string"
    ? value.trim().normalize("NFC").toLowerCase()
    : "";
}

/** Hashes email: HMAC-SHA256(SERVER_SECRET, normalizeEmail(email)) */
export async function hashEmail(
  secretBytes: Uint8Array,
  email: string,
): Promise<Uint8Array> {
  return await hmacSha256(secretBytes, normalizeEmail(email));
}

/** What a server blob holds: the AAD binds a ciphertext to its column (L2). */
export type BlobField = "email" | "invite-code";

/**
 * A key for one purpose, derived from SERVER_SECRET with HKDF-SHA-256, so
 * the raw secret is used for one thing only (`email_hmac`).
 */
async function serverSubkey(
  secretBytes: Uint8Array,
  purpose: "blob" | "login-code",
): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    toBufferSource(secretBytes),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: textEncoder.encode(`emo-server-${purpose}/v1`),
    },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

async function gcmKey(raw: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    toBufferSource(raw),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

const blobAad = (field: BlobField) => textEncoder.encode(`emo-${field}/v1`);

/**
 * AES-256-GCM under the blob subkey, bound to `field`
 * (returns nonce[12] + ciphertext + tag[16]).
 */
export async function encryptServerBlob(
  secretBytes: Uint8Array,
  data: Uint8Array | string,
  field: BlobField,
): Promise<Uint8Array> {
  const plainBytes = typeof data === "string" ? textEncoder.encode(data) : data;
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await gcmKey(await serverSubkey(secretBytes, "blob"));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(nonce),
      additionalData: toBufferSource(blobAad(field)),
    },
    key,
    toBufferSource(plainBytes),
  );
  const encBytes = new Uint8Array(encrypted);
  const result = new Uint8Array(nonce.length + encBytes.length);
  result.set(nonce, 0);
  result.set(encBytes, nonce.length);
  return result;
}

/**
 * Decrypts a blob of `field`. Rows written before the subkey (the raw secret,
 * no AAD) still open; they are rewritten under the subkey by
 * `emo rotate-secret`. A blob of another field never opens.
 */
export async function decryptServerBlob(
  secretBytes: Uint8Array,
  encryptedWithNonce: Uint8Array,
  field: BlobField,
): Promise<Uint8Array> {
  if (encryptedWithNonce.length < 28) {
    throw new Error("Ciphertext too short");
  }
  const iv = toBufferSource(encryptedWithNonce.subarray(0, 12));
  const ciphertext = toBufferSource(encryptedWithNonce.subarray(12));
  try {
    const key = await gcmKey(await serverSubkey(secretBytes, "blob"));
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: toBufferSource(blobAad(field)) },
        key,
        ciphertext,
      ),
    );
  } catch (err) {
    if ((err as Error)?.name !== "OperationError") throw err;
    const legacy = await gcmKey(secretBytes);
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, legacy, ciphertext),
    );
  }
}

/** Decrypts a UTF-8 string encrypted by `encryptServerBlob` */
export async function decryptServerString(
  secretBytes: Uint8Array,
  encryptedWithNonce: Uint8Array,
  field: BlobField,
): Promise<string> {
  const decrypted = await decryptServerBlob(
    secretBytes,
    encryptedWithNonce,
    field,
  );
  return textDecoder.decode(decrypted);
}

/** Generates random 256-bit session token and its SHA-256 hash */
export async function generateSessionToken(): Promise<{
  token: string;
  tokenHash: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const token = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
  const tokenHash = await sha256Hex(token);
  return { token, tokenHash };
}

/** Generates a 6-digit login code ("000000" to "999999"), uniformly:
 * values in the incomplete last block of 10⁶ are drawn again. */
export function generateLoginCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return (buf[0] % 1_000_000).toString().padStart(6, "0");
}

/** Generates a 12-character Crockford base32 invite code: 12 × 5 = 60
 * random bits (each byte's low 5 bits; 256 is a multiple of 32). */
export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => CROCKFORD_ALPHABET[b & 31]).join("");
}

/** Normalizes and hashes an invite code for storage / lookup */
export async function hashInviteCode(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, "");
  return await sha256Hex(normalized);
}

/** Hashes a login code for storage */
/**
 * A login code as stored (L26): HMAC-SHA-256 under the login-code subkey,
 * hex. A plain hash of a 6-digit code falls to 10⁶ guesses with read access
 * to the database; this needs SERVER_SECRET too.
 */
export async function hashLoginCode(
  secretBytes: Uint8Array,
  code: string,
): Promise<string> {
  return encodeHex(
    await hmacSha256(
      await serverSubkey(secretBytes, "login-code"),
      code.trim(),
    ),
  );
}

/**
 * Verifies X-Emo-Auth proof:
 * The client sends base64url(auth_key).
 * The server computes SHA-256(auth_key) and compares with stored auth_hash in constant time.
 */
export async function verifyAuthProof(
  storedAuthHash: Uint8Array,
  proofB64: string,
): Promise<boolean> {
  try {
    const authKeyBytes = decodeBase64Url(proofB64);
    if (authKeyBytes.byteLength !== 32) {
      return false;
    }
    const computedHash = await sha256Bytes(authKeyBytes);
    return timingSafeEqual(storedAuthHash, computedHash);
  } catch {
    return false;
  }
}
