// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * performance.md §1.2, §5: the client's hot paths under Deno
 * (informational; `make perf` prints them). Budgets: the note validator
 * ≤ 2 ms per keystroke, the whole save ≤ 50 ms (encryption is part of it),
 * the Argon2id unwrap ≤ 1.2–2.5 s on the reference phones.
 */
import { validateNote } from "./entry.ts";
import { encryptEntry, importDek } from "./crypto/e2e.ts";
import { decodeHex } from "./crypto/encoding.ts";
import { unwrapDekWithPassphrase } from "./crypto/keyring.ts";
import type { EntryV2 } from "./entry.ts";
import type { KeyringItem } from "./protocol.ts";

const entry: EntryV2 = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/entry.v2.json", import.meta.url)),
);
const V = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/crypto/v1.json", import.meta.url),
  ),
);
const accountId: string = V.inputs.account_id;
const dek = await importDek(decodeHex(V.inputs.dek_hex));
const keyring: KeyringItem = {
  key_version: 1,
  rev: 1,
  kdf: V.inputs.kdf,
  dek_wrapped_pass: V.expected.keyring.dek_wrapped_pass,
  dek_wrapped_recovery: V.expected.keyring.dek_wrapped_recovery,
  created_at: "",
};
// 160 characters of Cyrillic, the longest note
const note = "созвон с руководителем, потом долго не мог успокоиться ".repeat(3)
  .slice(0, 160);

Deno.bench("note validator, 160 Cyrillic characters (≤ 2 ms)", () => {
  validateNote(note);
});

Deno.bench(
  "entry: canonical JSON, pad, AES-GCM (part of save ≤ 50 ms)",
  async () => {
    await encryptEntry(dek, { ...entry, note }, accountId, 1);
  },
);

Deno.bench({
  name: "Argon2id unwrap, m = 64 MiB, t = 3 (phones: ≤ 1.2–2.5 s)",
  n: 5,
  warmup: 1,
  fn: async () => {
    await unwrapDekWithPassphrase(keyring, accountId, V.inputs.passphrase);
  },
});
