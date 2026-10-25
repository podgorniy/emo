// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Detects a changed `SERVER_SECRET` at boot. Every `email_hmac` depends on
 * it, so a new secret would silently break every sign-in. The first boot
 * stores `HMAC(SERVER_SECRET, "emo-secret-check")` in `meta`; later boots
 * refuse to start on a mismatch (`emo rotate-secret` is the way to change it).
 * Specification: reliability.md §1.5, architecture.md §6.1.
 */

import type { DatabaseSync } from "node:sqlite";
import { hmacSha256 } from "./crypto.ts";
import { decodeHex, encodeHex } from "../shared/crypto/encoding.ts";

export const SECRET_CHECK_KEY = "secret_check";
const SECRET_CHECK_MESSAGE = "emo-secret-check";

export async function secretCheckValue(
  serverSecretHex: string,
): Promise<string> {
  return encodeHex(
    await hmacSha256(decodeHex(serverSecretHex), SECRET_CHECK_MESSAGE),
  );
}

/** `stored` on first boot, `match`, or `mismatch` (refuse to start). */
export async function checkServerSecret(
  db: DatabaseSync,
  serverSecretHex: string,
): Promise<"stored" | "match" | "mismatch"> {
  const expected = await secretCheckValue(serverSecretHex);
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(
    SECRET_CHECK_KEY,
  ) as { value: string } | undefined;
  if (!row) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      SECRET_CHECK_KEY,
      expected,
    );
    return "stored";
  }
  return row.value === expected ? "match" : "mismatch";
}
