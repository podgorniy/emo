// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Keyring revisions that need the server: recovery with the recovery key.
 * Specification: architecture.md §5.3, api.md §2.3.
 */

import type { KeyringItem } from "../../../shared/protocol.ts";
import { ApiErrorResponse, apiGetKeyring, apiPutKeyring } from "./api.ts";
import { recoverAccount, rewrapKeyring } from "./crypto.ts";
import { cachedKeyring, rememberUploadedKeyring } from "./session.ts";
import { removeMeta } from "./db.ts";

/**
 * Recovers with the recovery key and writes the new keyring revision
 * (`If-Match` + `X-Emo-Auth`). Resolves with the **new** recovery key only
 * after the server stored it; until then nothing changes on this device.
 * A `409 keyring_conflict` (another device wrote a revision meanwhile) is
 * retried once against the fresh revision.
 */
export async function recoverAndUpload(
  accountId: string,
  recoveryKey: string,
  newPassphrase: string,
  keyring: KeyringItem,
): Promise<{ newRecoveryKeyFormatted: string }> {
  let current = keyring;
  for (let attempt = 0;; attempt++) {
    const r = await recoverAccount(
      accountId,
      recoveryKey,
      newPassphrase,
      current,
    );
    let uploaded;
    try {
      uploaded = await apiPutKeyring(
        current.key_version,
        r.newKeyringPut,
        r.authProofB64,
        current.rev,
      );
    } catch (err) {
      if (
        attempt === 0 && err instanceof ApiErrorResponse &&
        err.code === "keyring_conflict"
      ) {
        const fresh = (await apiGetKeyring()).items.find((k) =>
          k.key_version === current.key_version
        );
        if (!fresh) throw err;
        current = fresh;
        continue;
      }
      throw err;
    }
    await rememberUploadedKeyring(r.newKeyringPut, uploaded.rev);
    await r.activate();
    return { newRecoveryKeyFormatted: r.newRecoveryKeyFormatted };
  }
}

/**
 * Writes a passphrase change or a new recovery key as the next keyring
 * revision (`If-Match` + `X-Emo-Auth`), retrying once against a fresh
 * revision after `409 keyring_conflict`. Needs the network: the server holds
 * the revision order. Returns the new recovery key when one was made.
 */
export async function changeKeyring(
  accountId: string,
  passphrase: string,
  change: { newPassphrase?: string; newRecoveryKey?: boolean },
): Promise<{ newRecoveryKeyFormatted: string | null }> {
  let current = await freshKeyring();
  for (let attempt = 0;; attempt++) {
    const r = await rewrapKeyring(accountId, current, passphrase, change);
    try {
      const uploaded = await apiPutKeyring(
        current.key_version,
        r.put,
        r.authProofB64,
        current.rev,
      );
      await rememberUploadedKeyring(r.put, uploaded.rev);
      return { newRecoveryKeyFormatted: r.newRecoveryKeyFormatted };
    } catch (err) {
      if (
        attempt === 0 && err instanceof ApiErrorResponse &&
        err.code === "keyring_conflict"
      ) {
        current = await freshKeyring();
        continue;
      }
      throw err;
    }
  }
}

/**
 * "Re-save keys" (reliability.md §1.2): after unlock fell back to an older
 * revision, a fresh revision written from the one that opened here: a new
 * passphrase wrap, the recovery wrap carried over (same DEK), on top of the
 * server's newest revision. A 409 is retried once against the fresh one.
 */
export async function resaveKeyring(
  accountId: string,
  passphrase: string,
): Promise<void> {
  const source = await cachedKeyring();
  if (!source) throw new Error("No keyring on this device");
  for (let attempt = 0;; attempt++) {
    const newest = await freshKeyring();
    const r = await rewrapKeyring(accountId, source, passphrase, {
      newPassphrase: passphrase,
    });
    try {
      const uploaded = await apiPutKeyring(
        newest.key_version,
        r.put,
        r.authProofB64,
        newest.rev,
      );
      await rememberUploadedKeyring(r.put, uploaded.rev);
      await removeMeta(FALLBACK_KEY);
      return;
    } catch (err) {
      if (
        attempt === 0 && err instanceof ApiErrorResponse &&
        err.code === "keyring_conflict"
      ) continue;
      throw err;
    }
  }
}

/** Set by unlock when it had to use an older revision; Settings offers re-saving */
export const FALLBACK_KEY = "keyring_fallback";

async function freshKeyring(): Promise<KeyringItem> {
  const res = await apiGetKeyring();
  const latest =
    res.items.find((k) => k.key_version === res.current_key_version) ??
      res.items[0];
  if (!latest) throw new Error("No keyring on the server");
  return latest;
}
