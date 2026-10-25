// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The account's address, normalised as the server does (trim → NFC → lower
 * case, api.md §2.1), in memory: from this tab's sign-in, or from
 * the encrypted prefs once the device is unlocked (`prefs.ts`, which also
 * stores it there, E2E-encrypted). Never in plaintext storage. Password
 * managers get it as the passphrase's username (ui.md §12 item
 * 3); where it is unknown — the unlock screen after a restart or a lock —
 * the field is left out.
 */
let email: string | null = null;

export function setSessionEmail(value: string | null): void {
  email = value === null ? null : value.trim().normalize("NFC").toLowerCase();
}

export function sessionEmail(): string | null {
  return email;
}
