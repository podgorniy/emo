// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import {
  buildDraftAad,
  buildEntryAad,
  buildKeyringAad,
  buildPrefsAad,
} from "./aad.ts";

// AAD layouts are permanent once data exists (README.md §3,
// architecture.md §5.5): UTF-8 parts joined by 0x00, key_version in decimal.
const ACCOUNT = "0192f1c4-7b43-7000-8000-000000000001";
const ENTRY = "6f1c2a3e-9b4d-4e7f-8a21-5c3d9e0b1f47";
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

Deno.test("aad - exact byte layout of every AAD", () => {
  assertEquals(
    decode(buildEntryAad(ACCOUNT, ENTRY, 1)),
    `emo-entry/v1\0${ACCOUNT}\0${ENTRY}\x001`,
  );
  assertEquals(
    decode(buildKeyringAad(ACCOUNT, 12)),
    `emo-keyring/v1\0${ACCOUNT}\x0012`,
  );
  assertEquals(
    decode(buildPrefsAad(ACCOUNT, 1)),
    `emo-prefs/v1\0${ACCOUNT}\x001`,
  );
  assertEquals(decode(buildDraftAad(ACCOUNT)), `emo-draft/v1\0${ACCOUNT}`);
});
