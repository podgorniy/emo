// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Assembling a keyring revision (architecture.md §5.1–§5.3): what it wraps opens
 * again, what it keeps is unchanged, and it never touches the caller's DEK.
 */
import { assertEquals, assertRejects } from "@std/assert";
import type { KeyringItem } from "../protocol.ts";
import { generateDek } from "./e2e.ts";
import { ARGON2_DEFAULT_PARAMS } from "./constants.ts";
import {
  assembleKeyring,
  keyringProblem,
  unwrapDekWithPassphrase,
  unwrapDekWithRecoveryKey,
} from "./keyring.ts";

const ACCOUNT = "01890a5d-ac96-7a4f-8f3a-000000000001";

const item = (put: Omit<KeyringItem, "rev" | "created_at">): KeyringItem => ({
  ...put,
  rev: 1,
  created_at: "2026-01-01T00:00:00.000Z",
});

Deno.test("keyring - a new revision opens with its passphrase and recovery key", async () => {
  const dek = generateDek();
  const before = dek.slice();
  const { put, newRecoveryKey } = await assembleKeyring(dek, ACCOUNT, 3, {
    newPassphrase: "a passphrase 1",
    newRecoveryKey: true,
  });
  // The caller wipes the DEK, not the assembler
  assertEquals(dek, before);
  assertEquals(put.key_version, 3);
  assertEquals(keyringProblem(put), null);
  assertEquals(put.kdf.m_kib, ARGON2_DEFAULT_PARAMS.m);
  const k = item(put);
  assertEquals(
    await unwrapDekWithPassphrase(k, ACCOUNT, "a passphrase 1"),
    dek,
  );
  assertEquals(
    await unwrapDekWithRecoveryKey(k, ACCOUNT, newRecoveryKey!),
    dek,
  );
  // Bound to the account and key version through the AAD
  await assertRejects(() =>
    unwrapDekWithPassphrase({ ...k, key_version: 1 }, ACCOUNT, "a passphrase 1")
  );
});

Deno.test("keyring - what is not changed is kept byte for byte", async () => {
  const dek = generateDek();
  const first = await assembleKeyring(dek, ACCOUNT, 1, {
    newPassphrase: "a passphrase 1",
    newRecoveryKey: true,
  });
  const recovery = await assembleKeyring(
    dek,
    ACCOUNT,
    1,
    { newRecoveryKey: true },
    first.put,
  );
  assertEquals(recovery.put.kdf, first.put.kdf);
  assertEquals(recovery.put.dek_wrapped_pass, first.put.dek_wrapped_pass);
  assertEquals(
    recovery.put.dek_wrapped_recovery === first.put.dek_wrapped_recovery,
    false,
  );

  const pass = await assembleKeyring(
    dek,
    ACCOUNT,
    1,
    { newPassphrase: "another one 2" },
    first.put,
  );
  assertEquals(pass.newRecoveryKey, null);
  assertEquals(pass.put.dek_wrapped_recovery, first.put.dek_wrapped_recovery);
  assertEquals(pass.put.kdf.salt_b64 === first.put.kdf.salt_b64, false);
  // Without a wrap of each kind there is no keyring
  await assertRejects(
    () => assembleKeyring(dek, ACCOUNT, 1, { newRecoveryKey: true }),
    Error,
    "passphrase wrap",
  );
});
