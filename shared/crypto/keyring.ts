// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Keyring revisions: assembling one for a DEK, and unwrapping the DEK from one
 * with the passphrase or the recovery key. Shared by the app and
 * `emo decrypt-bundle`, so both read the same bytes the same way.
 * Specification: architecture.md §5.1–§5.3.
 */

import type { KeyringItem, KeyringPutReq, Wrapped } from "../protocol.ts";
import { buildKeyringAad } from "./aad.ts";
import {
  derivePassphraseKek,
  deriveRecoveryKek,
  generateSalt,
  unwrapDek,
  wrapDek,
} from "./e2e.ts";
import { ARGON2_DEFAULT_PARAMS, ARGON2_FALLBACK_PARAMS } from "./constants.ts";
import { decodeBase64Url, encodeBase64Url } from "./encoding.ts";
import {
  generateRecoveryKey,
  parseAndValidateRecoveryKey,
} from "./recovery.ts";

/**
 * The fields of a keyring revision for `dek`: a passphrase wrap under a fresh
 * salt when `newPassphrase` is given, a wrap under a fresh recovery key when
 * `newRecoveryKey` is set, and `keep`'s fields byte for byte otherwise. Each
 * new wrap is opened again and compared with `dek` before anything is
 * returned, so a revision that would lock the person out is never uploaded
 * (api.md §2.3, architecture.md §4.1). `dek` is left as it was;
 * wiping it is the caller's.
 */
export async function assembleKeyring(
  dek: Uint8Array,
  accountId: string,
  keyVersion: number,
  change: { newPassphrase?: string; newRecoveryKey?: boolean },
  keep?: KeyringFields,
): Promise<{ put: KeyringPutReq; newRecoveryKey: string | null }> {
  const aad = buildKeyringAad(accountId, keyVersion);
  const made: Array<{ kek: CryptoKey; wrapped: Wrapped }> = [];
  const wrap = async (kek: CryptoKey): Promise<Wrapped> => {
    const { nonce, ciphertext } = await wrapDek(kek, dek, aad);
    const wrapped = {
      nonce_b64: encodeBase64Url(nonce),
      ct_b64: encodeBase64Url(ciphertext),
    };
    made.push({ kek, wrapped });
    return wrapped;
  };

  let kdf = keep?.kdf;
  let pass = keep?.dek_wrapped_pass;
  if (change.newPassphrase !== undefined) {
    const salt = generateSalt();
    pass = await wrap(await derivePassphraseKek(change.newPassphrase, salt));
    kdf = {
      alg: "argon2id",
      m_kib: ARGON2_DEFAULT_PARAMS.m,
      t: ARGON2_DEFAULT_PARAMS.t,
      p: ARGON2_DEFAULT_PARAMS.p,
      salt_b64: encodeBase64Url(salt),
    };
  }
  let recovery = keep?.dek_wrapped_recovery;
  let newRecoveryKey: string | null = null;
  if (change.newRecoveryKey) {
    const { secret, formatted } = await generateRecoveryKey();
    recovery = await wrap(await deriveRecoveryKek(secret, accountId));
    newRecoveryKey = formatted;
  }
  if (!kdf || !pass || !recovery) {
    throw new Error("A keyring needs a passphrase wrap and a recovery wrap");
  }

  for (const { kek, wrapped } of made) {
    const back = await unwrapDek(
      kek,
      decodeBase64Url(wrapped.nonce_b64),
      decodeBase64Url(wrapped.ct_b64),
      aad,
    );
    const same = back.length === dek.length &&
      back.every((b, i) => b === dek[i]);
    back.fill(0);
    if (!same) {
      throw new Error(
        "Keyring self-check failed: a wrapped key does not unwrap to the DEK",
      );
    }
  }
  return {
    put: {
      key_version: keyVersion,
      kdf,
      dek_wrapped_pass: pass,
      dek_wrapped_recovery: recovery,
    },
    newRecoveryKey,
  };
}

/** The raw 32-byte DEK; throws on a wrong passphrase or a damaged keyring. */
export async function unwrapDekWithPassphrase(
  keyring: KeyringItem,
  accountId: string,
  passphrase: string,
): Promise<Uint8Array> {
  const kek = await derivePassphraseKek(
    passphrase,
    decodeBase64Url(keyring.kdf.salt_b64),
    { m: keyring.kdf.m_kib, t: keyring.kdf.t, p: keyring.kdf.p },
  );
  return unwrapDek(
    kek,
    decodeBase64Url(keyring.dek_wrapped_pass.nonce_b64),
    decodeBase64Url(keyring.dek_wrapped_pass.ct_b64),
    buildKeyringAad(accountId, keyring.key_version),
  );
}

/** The raw 32-byte DEK; throws on a malformed or wrong recovery key. */
export async function unwrapDekWithRecoveryKey(
  keyring: KeyringItem,
  accountId: string,
  recoveryKey: string,
): Promise<Uint8Array> {
  const secret = await parseAndValidateRecoveryKey(recoveryKey);
  const kek = await deriveRecoveryKek(secret, accountId);
  return unwrapDek(
    kek,
    decodeBase64Url(keyring.dek_wrapped_recovery.nonce_b64),
    decodeBase64Url(keyring.dek_wrapped_recovery.ct_b64),
    buildKeyringAad(accountId, keyring.key_version),
  );
}

/** AES-GCM over the 32-byte DEK: a 12-byte nonce, 32 + 16 bytes out. */
export const WRAP_NONCE_BYTES = 12;
export const WRAPPED_DEK_BYTES = 48;
export const KDF_SALT_BYTES = 16;

type KeyringFields = Pick<
  KeyringItem,
  "kdf" | "dek_wrapped_pass" | "dek_wrapped_recovery"
>;

/**
 * Why a keyring revision cannot be used, or null (reliability.md §1.2,
 * api.md §2.3). The server refuses to store one that fails this; the
 * client checks before it spends seconds on the KDF.
 */
export function keyringProblem(k: KeyringFields): string | null {
  const kdf = k?.kdf;
  const int = (v: unknown, min: number, max: number) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  if (kdf?.alg !== "argon2id") return "kdf.alg must be argon2id";
  // 32 MiB is the floor for new keyrings (performance.md §3.1)
  if (!int(kdf.m_kib, ARGON2_FALLBACK_PARAMS.m, 1 << 20)) {
    return "kdf.m_kib out of range";
  }
  if (!int(kdf.t, 1, 16)) return "kdf.t out of range";
  if (!int(kdf.p, 1, 4)) return "kdf.p out of range";
  if (decodedLength(kdf.salt_b64) !== KDF_SALT_BYTES) {
    return `kdf.salt_b64 must be ${KDF_SALT_BYTES} bytes`;
  }
  for (const name of ["dek_wrapped_pass", "dek_wrapped_recovery"] as const) {
    const w = k[name];
    if (
      decodedLength(w?.nonce_b64) !== WRAP_NONCE_BYTES ||
      decodedLength(w?.ct_b64) !== WRAPPED_DEK_BYTES
    ) {
      return `${name}: nonce must be ${WRAP_NONCE_BYTES} bytes, ct ${WRAPPED_DEK_BYTES}`;
    }
  }
  return null;
}

function decodedLength(value: unknown): number {
  try {
    return typeof value === "string" ? decodeBase64Url(value).length : -1;
  } catch {
    return -1;
  }
}

/** Revisions with equal ids derive the same KEK from one passphrase. */
export function kdfId(keyring: Pick<KeyringItem, "kdf">): string {
  const { m_kib, t, p, salt_b64 } = keyring.kdf;
  return `${m_kib}/${t}/${p}/${salt_b64}`;
}

/**
 * The DEK from the first of `revisions` (newest first) that the passphrase
 * opens, deriving each KEK once: revisions with the same salt and parameters
 * share it, so trying the one before a damaged newest revision costs an AES
 * operation, not another KDF run. Revisions that fail `keyringProblem` are
 * skipped. Null when none opens (a wrong passphrase).
 */
export async function unwrapFirstWithPassphrase(
  revisions: KeyringItem[],
  accountId: string,
  passphrase: string,
  /** KEKs already derived for this passphrase, by `kdfId`; filled as it goes. */
  keks: Map<string, CryptoKey> = new Map(),
): Promise<{ dek: Uint8Array; keyring: KeyringItem } | null> {
  for (const keyring of revisions) {
    if (keyringProblem(keyring)) continue;
    const { m_kib, t, p, salt_b64 } = keyring.kdf;
    const id = kdfId(keyring);
    let kek = keks.get(id);
    if (!kek) {
      kek = await derivePassphraseKek(
        passphrase,
        decodeBase64Url(salt_b64),
        { m: m_kib, t, p },
      );
      keks.set(id, kek);
    }
    try {
      const dek = await unwrapDek(
        kek,
        decodeBase64Url(keyring.dek_wrapped_pass.nonce_b64),
        decodeBase64Url(keyring.dek_wrapped_pass.ct_b64),
        buildKeyringAad(accountId, keyring.key_version),
      );
      return { dek, keyring };
    } catch (err) {
      if ((err as Error)?.name !== "OperationError") throw err;
    }
  }
  return null;
}
