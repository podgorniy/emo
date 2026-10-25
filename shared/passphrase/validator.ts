// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Passphrase validator and strength estimator.
 * Rules: English/ASCII characters only ([\x20-\x7E]), length >= 8.
 * Strength estimation is purely informational (0-4: weak, fair, good, strong).
 * Specification: architecture.md §4.1, ui.md §12.
 */

export interface PassphraseValidationResult {
  valid: boolean;
  lengthValid: boolean;
  asciiOnly: boolean;
  score: number; // 0..4
  strengthLabel: "weak" | "fair" | "good" | "strong";
  errors: string[];
}

const ASCII_PRINTABLE_REGEX = /^[\x20-\x7E]*$/;

/**
 * Validates a passphrase against Emo rules:
 * - English/ASCII only (space to tilde: 0x20 - 0x7E)
 * - Minimum 8 characters
 */
export function validatePassphrase(
  passphrase: string,
): PassphraseValidationResult {
  const lengthValid = passphrase.length >= 8;
  const asciiOnly = ASCII_PRINTABLE_REGEX.test(passphrase);
  const errors: string[] = [];

  if (!asciiOnly) {
    errors.push("auth.passphrase.error.asciiOnly");
  }
  if (!lengthValid) {
    errors.push("auth.passphrase.field");
  }

  const score = estimatePassphraseScore(passphrase);
  const strengthLabels: Array<"weak" | "fair" | "good" | "strong"> = [
    "weak",
    "weak",
    "fair",
    "good",
    "strong",
  ];

  return {
    valid: lengthValid && asciiOnly,
    lengthValid,
    asciiOnly,
    score,
    strengthLabel: strengthLabels[score],
    errors,
  };
}

/**
 * Lightweight, dependency-free entropy and variety estimator (0 to 4).
 * Informational only - does not block user submission.
 */
export function estimatePassphraseScore(passphrase: string): number {
  if (passphrase.length < 8) return 0;

  let poolSize = 0;
  if (/[a-z]/.test(passphrase)) poolSize += 26;
  if (/[A-Z]/.test(passphrase)) poolSize += 26;
  if (/[0-9]/.test(passphrase)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(passphrase)) poolSize += 33;

  if (poolSize === 0) return 0;

  // Approximate bits of entropy: length * log2(poolSize)
  const entropy = passphrase.length * Math.log2(poolSize);

  // Score mapping:
  // < 35 bits: 1 (weak)
  // 35 - 50 bits: 2 (fair)
  // 50 - 65 bits: 3 (good)
  // >= 65 bits: 4 (strong)
  if (entropy < 35) return 1;
  if (entropy < 50) return 2;
  if (entropy < 65) return 3;
  return 4;
}
