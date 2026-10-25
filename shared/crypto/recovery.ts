// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Crockford Base32 Recovery Key implementation with 32-bit checksum.
 * Specification: architecture.md §5.1, §5.6.
 */

import { RECOVERY_CHECK_PREFIX } from "./constants.ts";

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 128-bit secret + 32-bit checksum = 160 bits = 32 base32 characters. */
export const RECOVERY_KEY_LENGTH = 32;

/**
 * Encodes a Uint8Array into Crockford Base32.
 */
export function encodeCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes a Crockford Base32 string into a Uint8Array.
 * Normalizes 'O'/'o' -> '0', 'I'/'i'/'L'/'l' -> '1', and strips '-' / spaces.
 */
export function decodeCrockford(input: string): Uint8Array {
  const normalized = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[Oo]/g, "0")
    .replace(/[IiLl]/g, "1");

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const index = CROCKFORD_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Crockford Base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Computes the 4-byte (32-bit) checksum of a 16-byte recovery secret:
 * `SHA-256("emo-recovery-check/v1" || s)[0..4]` (architecture.md §5.1).
 */
export async function computeRecoveryChecksum(
  secret: Uint8Array,
): Promise<Uint8Array> {
  const prefix = new TextEncoder().encode(RECOVERY_CHECK_PREFIX);
  const input = new Uint8Array(prefix.length + secret.length);
  input.set(prefix, 0);
  input.set(secret, prefix.length);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return new Uint8Array(digest, 0, 4).slice();
}

/**
 * Generates a fresh 128-bit recovery secret with 32-bit checksum,
 * formatted as 8 groups of 4 Crockford Base32 characters.
 */
export async function generateRecoveryKey(): Promise<{
  secret: Uint8Array;
  formatted: string;
}> {
  const secret = new Uint8Array(16);
  crypto.getRandomValues(secret);
  const checksum = await computeRecoveryChecksum(secret);

  const full = new Uint8Array(20);
  full.set(secret, 0);
  full.set(checksum, 16);

  const raw32 = encodeCrockford(full);
  const groups: string[] = [];
  for (let i = 0; i < 32; i += 4) {
    groups.push(raw32.slice(i, i + 4));
  }

  return {
    secret,
    formatted: groups.join("-"),
  };
}

/**
 * Validates and decodes a recovery key string.
 * Returns the 16-byte recovery secret.
 * Throws Error on invalid length, invalid character, or checksum mismatch.
 */
export async function parseAndValidateRecoveryKey(
  input: string,
): Promise<Uint8Array> {
  const compact = input.replace(/[\s-]/g, "");
  if (compact.length !== RECOVERY_KEY_LENGTH) {
    throw new Error(
      `Recovery key must be exactly ${RECOVERY_KEY_LENGTH} characters (got ${compact.length})`,
    );
  }
  const rawBytes = decodeCrockford(compact);

  const secret = rawBytes.slice(0, 16);
  const expectedChecksum = rawBytes.slice(16, 20);
  const actualChecksum = await computeRecoveryChecksum(secret);

  if (
    actualChecksum[0] !== expectedChecksum[0] ||
    actualChecksum[1] !== expectedChecksum[1] ||
    actualChecksum[2] !== expectedChecksum[2] ||
    actualChecksum[3] !== expectedChecksum[3]
  ) {
    throw new Error("Recovery key checksum mismatch");
  }

  return secret;
}

/**
 * Validates recovery key string, returning boolean result.
 */
export async function parseRecoveryKey(
  input: string,
): Promise<{ valid: boolean; secret?: Uint8Array; error?: string }> {
  try {
    const secret = await parseAndValidateRecoveryKey(input);
    return { valid: true, secret };
  } catch (err: unknown) {
    return { valid: false, error: (err as Error).message };
  }
}

/**
 * What the recovery-key field shows while typing (ui.md §12):
 * upper case, `O` → `0`, `I`/`L` → `1`, spaces and hyphens dropped, at most
 * 32 characters, grouped 4-4-4….
 */
export function formatRecoveryInput(raw: string): string {
  const compact = raw
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, RECOVERY_KEY_LENGTH);
  return compact.match(/.{1,4}/g)?.join("-") ?? "";
}
