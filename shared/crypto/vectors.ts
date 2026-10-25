// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * architecture.md §5.5, development.md §5.1: every version must open the stored vectors
 * (`shared/fixtures/crypto/v1.json`) and reproduce them byte for byte. No Deno
 * APIs here, so the same cases run in Deno (`vectors_test.ts`) and in Chromium
 * (`e2e/vectors.e2e.ts`). A failure means data written by an earlier version,
 * or by the other runtime, would no longer open: fix the code, never the
 * vectors.
 */
import { assertEquals } from "@std/assert";
import { buildKeyringAad } from "./aad.ts";
import {
  decryptDraft,
  decryptEntry,
  decryptPrefs,
  deriveAuthKey,
  derivePassphraseKek,
  deriveRecoveryKek,
  encryptDraft,
  encryptEntry,
  encryptPrefs,
  importDek,
  sha256,
  wrapDek,
} from "./e2e.ts";
import {
  decodeBase64Url,
  decodeHex,
  encodeBase64Url,
  encodeHex,
} from "./encoding.ts";
import {
  unwrapDekWithPassphrase,
  unwrapDekWithRecoveryKey,
} from "./keyring.ts";
import { parseAndValidateRecoveryKey } from "./recovery.ts";
import { canonicalizeJson } from "../entry.ts";
import type { KeyringItem } from "../protocol.ts";

export interface VectorCase {
  name: string;
  run: () => Promise<void>;
}

/** The checks over a parsed `v1.json`. */
// deno-lint-ignore no-explicit-any
export function vectorCases(V: any): VectorCase[] {
  const { inputs, expected } = V;
  const accountId: string = inputs.account_id;
  const dekRaw = decodeHex(inputs.dek_hex);
  const nonce = (name: string) => decodeBase64Url(inputs.nonces[name]);
  const b64 = encodeBase64Url;
  const keyring: KeyringItem = {
    key_version: 1,
    rev: 1,
    kdf: inputs.kdf,
    dek_wrapped_pass: expected.keyring.dek_wrapped_pass,
    dek_wrapped_recovery: expected.keyring.dek_wrapped_recovery,
    created_at: "",
  };

  return [{
    name: "auth_key and its hash",
    run: async () => {
      const authKey = await deriveAuthKey(dekRaw, accountId);
      assertEquals(b64(authKey), expected.auth_key_b64);
      assertEquals(encodeHex(await sha256(authKey)), expected.auth_hash_hex);
    },
  }, {
    name: "recovery key format and checksum",
    run: async () => {
      const secret = await parseAndValidateRecoveryKey(expected.recovery_key);
      assertEquals(encodeHex(secret), inputs.recovery_secret_hex);
    },
  }, {
    name: "keyring: the same wrap bytes, and both ways open it",
    run: async () => {
      const aad = buildKeyringAad(accountId, 1);
      const pass = await wrapDek(
        await derivePassphraseKek(
          inputs.passphrase,
          decodeBase64Url(inputs.kdf.salt_b64),
          {
            m: inputs.kdf.m_kib,
            t: inputs.kdf.t,
            p: inputs.kdf.p,
          },
        ),
        dekRaw,
        aad,
        nonce("keyring_pass"),
      );
      assertEquals(
        b64(pass.ciphertext),
        expected.keyring.dek_wrapped_pass.ct_b64,
      );
      const rec = await wrapDek(
        await deriveRecoveryKek(
          decodeHex(inputs.recovery_secret_hex),
          accountId,
        ),
        dekRaw,
        aad,
        nonce("keyring_recovery"),
      );
      assertEquals(
        b64(rec.ciphertext),
        expected.keyring.dek_wrapped_recovery.ct_b64,
      );

      assertEquals(
        encodeHex(
          await unwrapDekWithPassphrase(keyring, accountId, inputs.passphrase),
        ),
        inputs.dek_hex,
      );
      assertEquals(
        encodeHex(
          await unwrapDekWithRecoveryKey(
            keyring,
            accountId,
            expected.recovery_key,
          ),
        ),
        inputs.dek_hex,
      );
    },
  }, {
    name: "entry, prefs and draft: same bytes, same plaintext",
    run: async () => {
      const dek = await importDek(dekRaw);
      assertEquals(
        encodeHex(await sha256(canonicalizeJson(inputs.entry))),
        expected.entry_canonical_sha256_hex,
      );

      const entry = await encryptEntry(
        dek,
        inputs.entry,
        accountId,
        1,
        nonce("entry"),
      );
      assertEquals(b64(entry.ciphertext), expected.entry_ct_b64);
      assertEquals(entry.ciphertext.length, 2064); // padded to 2048 + tag
      assertEquals(
        await decryptEntry(
          dek,
          nonce("entry"),
          decodeBase64Url(expected.entry_ct_b64),
          accountId,
          inputs.entry.id,
          1,
        ),
        inputs.entry,
      );

      const prefs = await encryptPrefs(
        dek,
        inputs.prefs,
        accountId,
        1,
        nonce("prefs"),
      );
      assertEquals(b64(prefs.ciphertext), expected.prefs_ct_b64);
      assertEquals(
        await decryptPrefs(
          dek,
          nonce("prefs"),
          decodeBase64Url(expected.prefs_ct_b64),
          accountId,
          1,
        ),
        inputs.prefs,
      );

      const draft = await encryptDraft(
        dek,
        inputs.draft,
        accountId,
        nonce("draft"),
      );
      assertEquals(b64(draft.ciphertext), expected.draft_ct_b64);
      assertEquals(
        await decryptDraft(
          dek,
          nonce("draft"),
          decodeBase64Url(expected.draft_ct_b64),
          accountId,
        ),
        inputs.draft,
      );
    },
  }];
}
