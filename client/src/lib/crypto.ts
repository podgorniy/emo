// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Client-side cryptographic state and key management.
 * Specification: architecture.md §5, api.md §2.3.
 */

import {
  decryptEntry,
  decryptPrefs,
  deriveAuthKey,
  encryptEntry,
  encryptPrefs,
  generateDek,
  importDek,
} from "../../../shared/crypto/e2e.ts";
import {
  assembleKeyring,
  unwrapDekWithPassphrase,
  unwrapDekWithRecoveryKey,
  unwrapFirstWithPassphrase,
} from "../../../shared/crypto/keyring.ts";
import {
  decodeBase64Url,
  encodeBase64Url,
} from "../../../shared/crypto/encoding.ts";
import type { EntryV2 } from "../../../shared/entry.ts";
import type { KeyringItem, KeyringPutReq } from "../../../shared/protocol.ts";
import { clearKeys, getStoredKey, setStoredKey } from "./db.ts";

let cachedDek: CryptoKey | null = null;
let cachedAuthKeyB64: string | null = null;

export function getCachedDek(): CryptoKey | null {
  return cachedDek;
}

export function getCachedAuthKey(): string | null {
  return cachedAuthKeyB64;
}

export function isLocked(): boolean {
  return cachedDek === null;
}

/**
 * The DEK as a non-extractable key plus `auth_key`, after which the raw bytes
 * are wiped (architecture.md §5.4): they exist only between unwrap and import.
 */
async function importAndWipe(
  dekRaw: Uint8Array,
  accountId: string,
): Promise<{ dek: CryptoKey; authKeyRaw: Uint8Array }> {
  try {
    return {
      dek: await importDek(dekRaw, false),
      authKeyRaw: await deriveAuthKey(dekRaw, accountId),
    };
  } finally {
    dekRaw.fill(0);
  }
}

import { stopKdfWorker } from "./kdf.ts";

/** Keeps the unlocked DEK in memory and encrypted on this device. */
async function activateDek(
  dek: CryptoKey,
  authKeyRaw: Uint8Array,
): Promise<void> {
  cachedDek = dek;
  cachedAuthKeyB64 = encodeBase64Url(authKeyRaw);
  await setStoredKey("dek", dek);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode("emo-auth-store/v1");
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce as BufferSource,
      additionalData: aad as BufferSource,
    },
    dek,
    authKeyRaw as BufferSource,
  );
  await setStoredKey("auth", {
    nonce_b64: encodeBase64Url(nonce),
    ct_b64: encodeBase64Url(new Uint8Array(encrypted)),
  });
}

/**
 * Initializes crypto from IDB storage on startup.
 */
export async function initCryptoFromStorage(): Promise<boolean> {
  try {
    const dek = await getStoredKey<CryptoKey>("dek");
    const storedAuth = await getStoredKey<
      Uint8Array | { nonce_b64: string; ct_b64: string }
    >("auth");

    if (dek && storedAuth) {
      cachedDek = dek;
      let authKeyRaw: Uint8Array;
      if (storedAuth instanceof Uint8Array) {
        authKeyRaw = storedAuth;
        await activateDek(dek, authKeyRaw);
      } else {
        const nonce = decodeBase64Url(storedAuth.nonce_b64);
        const ct = decodeBase64Url(storedAuth.ct_b64);
        const aad = new TextEncoder().encode("emo-auth-store/v1");
        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: nonce as BufferSource,
            additionalData: aad as BufferSource,
          },
          dek,
          ct as BufferSource,
        );
        authKeyRaw = new Uint8Array(decrypted);
      }
      cachedAuthKeyB64 = encodeBase64Url(authKeyRaw);
      return true;
    }
  } catch (err) {
    console.error("Failed to restore keys from IndexedDB:", err);
  }

  cachedDek = null;
  cachedAuthKeyB64 = null;
  return false;
}

/**
 * Locks the device (removes DEK from memory and IndexedDB, terminates KDF worker).
 */
export async function lockDevice(): Promise<void> {
  cachedDek = null;
  cachedAuthKeyB64 = null;
  stopKdfWorker();
  await clearKeys();
}

/**
 * The first keyring at sign-up (architecture.md §5.1): a fresh DEK wrapped under
 * the passphrase and a new recovery key, then kept on this device.
 */
export async function setupKeyring(
  accountId: string,
  passphrase: string,
): Promise<{
  keyringPut: KeyringPutReq;
  recoveryKeyFormatted: string;
  authProofB64: string;
}> {
  const dekRaw = generateDek();
  let assembled;
  try {
    assembled = await assembleKeyring(dekRaw, accountId, 1, {
      newPassphrase: passphrase,
      newRecoveryKey: true,
    });
  } catch (err) {
    dekRaw.fill(0);
    throw err;
  }
  const { dek, authKeyRaw } = await importAndWipe(dekRaw, accountId);
  await activateDek(dek, authKeyRaw);
  return {
    keyringPut: assembled.put,
    recoveryKeyFormatted: assembled.newRecoveryKey!,
    authProofB64: encodeBase64Url(authKeyRaw),
  };
}

/**
 * Unlocks with the first of `revisions` (newest first) that the passphrase
 * opens, deriving each KEK once (`unwrapFirstWithPassphrase`). Resolves with
 * the revision used, or null when none opens; rethrows `KdfUnsupported`.
 */
export async function unlockWithRevisions(
  accountId: string,
  passphrase: string,
  revisions: KeyringItem[],
  keks?: Map<string, CryptoKey>,
): Promise<KeyringItem | null> {
  const res = await unwrapFirstWithPassphrase(
    revisions,
    accountId,
    passphrase,
    keks,
  );
  if (!res) return null;
  const { dek, authKeyRaw } = await importAndWipe(res.dek, accountId);
  await activateDek(dek, authKeyRaw);
  return res.keyring;
}

/**
 * Recovery with the recovery key (architecture.md §5.3): the checksum is checked
 * before any unwrap, then the DEK is wrapped under the new passphrase and a
 * **new** recovery key. Nothing is stored yet: call `activate()` only after
 * the server accepted the new keyring revision, so a failed upload leaves the
 * device as it was.
 */
export async function recoverAccount(
  accountId: string,
  recoveryKeyInput: string,
  newPassphrase: string,
  currentKeyring: KeyringItem,
): Promise<{
  newKeyringPut: KeyringPutReq;
  newRecoveryKeyFormatted: string;
  authProofB64: string;
  activate: () => Promise<void>;
}> {
  const dekRaw = await unwrapDekWithRecoveryKey(
    currentKeyring,
    accountId,
    recoveryKeyInput,
  );
  let assembled;
  try {
    assembled = await assembleKeyring(
      dekRaw,
      accountId,
      currentKeyring.key_version,
      { newPassphrase, newRecoveryKey: true },
    );
  } catch (err) {
    dekRaw.fill(0);
    throw err;
  }
  const { dek, authKeyRaw } = await importAndWipe(dekRaw, accountId);
  return {
    newKeyringPut: assembled.put,
    newRecoveryKeyFormatted: assembled.newRecoveryKey!,
    authProofB64: encodeBase64Url(authKeyRaw),
    activate: () => activateDek(dek, authKeyRaw),
  };
}

/**
 * A new keyring revision opened with the current passphrase (architecture.md
 * §5.3): a new passphrase wrap (change passphrase), a new recovery wrap (new
 * recovery key), or both; what is not changed is kept byte for byte. The DEK
 * itself never changes, so nothing on this device needs re-encrypting.
 * Throws when the passphrase does not open the keyring.
 */
export async function rewrapKeyring(
  accountId: string,
  current: KeyringItem,
  passphrase: string,
  change: { newPassphrase?: string; newRecoveryKey?: boolean },
): Promise<{
  put: KeyringPutReq;
  authProofB64: string;
  newRecoveryKeyFormatted: string | null;
}> {
  const dekRaw = await unwrapDekWithPassphrase(current, accountId, passphrase);
  try {
    const { put, newRecoveryKey } = await assembleKeyring(
      dekRaw,
      accountId,
      current.key_version,
      change,
      current,
    );
    return {
      put,
      authProofB64: encodeBase64Url(await deriveAuthKey(dekRaw, accountId)),
      newRecoveryKeyFormatted: newRecoveryKey,
    };
  } finally {
    dekRaw.fill(0);
  }
}

/** Encrypts the prefs object (`{ appearance }`) with the cached DEK. */
export async function encryptPrefsLocally(
  prefs: unknown,
  accountId: string,
  keyVersion: number,
): Promise<{ nonce_b64: string; ct_b64: string }> {
  if (!cachedDek) throw new Error("Device is locked");
  const enc = await encryptPrefs(cachedDek, prefs, accountId, keyVersion);
  return {
    nonce_b64: encodeBase64Url(enc.nonce),
    ct_b64: encodeBase64Url(enc.ciphertext),
  };
}

export async function decryptPrefsLocally<T>(
  nonceB64: string,
  ctB64: string,
  accountId: string,
  keyVersion: number,
): Promise<T> {
  if (!cachedDek) throw new Error("Device is locked");
  return await decryptPrefs<T>(
    cachedDek,
    decodeBase64Url(nonceB64),
    decodeBase64Url(ctB64),
    accountId,
    keyVersion,
  );
}

/** Encrypts entry using cached DEK */
export async function encryptEntryLocally(
  entry: EntryV2,
  accountId: string,
  keyVersion: number,
): Promise<{ nonce_b64: string; ct_b64: string }> {
  if (!cachedDek) {
    throw new Error("Device is locked");
  }
  const enc = await encryptEntry(cachedDek, entry, accountId, keyVersion);
  return {
    nonce_b64: encodeBase64Url(enc.nonce),
    ct_b64: encodeBase64Url(enc.ciphertext),
  };
}

/** Decrypts entry using cached DEK */
export async function decryptEntryLocally(
  nonceB64: string,
  ctB64: string,
  accountId: string,
  entryId: string,
  keyVersion = 1,
): Promise<EntryV2> {
  if (!cachedDek) {
    throw new Error("Device is locked");
  }
  const nonce = decodeBase64Url(nonceB64);
  const ciphertext = decodeBase64Url(ctB64);
  return await decryptEntry(
    cachedDek,
    nonce,
    ciphertext,
    accountId,
    entryId,
    keyVersion,
  );
}
