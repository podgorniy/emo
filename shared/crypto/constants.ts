// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Cryptographic constants and protocol labels.
 * Specification: architecture.md §5, api.md.
 */

export const AAD_KEYRING_PREFIX = "emo-keyring/v1";
export const AAD_ENTRY_PREFIX = "emo-entry/v1";
export const AAD_PREFS_PREFIX = "emo-prefs/v1";
export const AAD_DRAFT_PREFIX = "emo-draft/v1";

export const HKDF_INFO_AUTH = "emo-auth/v1";
export const HKDF_INFO_RECOVERY = "emo-recovery/v1";
/** Checksum prefix: SHA-256(prefix || s)[0..4] (architecture.md §5.1) */
export const RECOVERY_CHECK_PREFIX = "emo-recovery-check/v1";

/** Plaintext padding multiple for entries and drafts */
export const PADDING_BLOCK_SIZE = 2048;

/** Default Argon2id parameters */
export const ARGON2_DEFAULT_PARAMS = {
  m: 65536, // 64 MiB in KiB
  t: 3,
  p: 1,
} as const;

export const ARGON2_FALLBACK_PARAMS = {
  m: 32768, // 32 MiB in KiB
  t: 3,
  p: 1,
} as const;
