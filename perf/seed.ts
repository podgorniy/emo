// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `make seed ENTRIES=N` — dev only: an account with N random ciphertext
 * entries (2 064 bytes each, like real ones) for perf runs. Nobody can sign
 * in to it or decrypt it. Refuses unless BASE_URL is localhost.
 * Specification: ops.md §1.
 */

import { getDb, runMigrations } from "../server/db/index.ts";
import { generateUuidV4, generateUuidV7 } from "../server/crypto.ts";

const base = Deno.env.get("BASE_URL") ?? "";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(base)) {
  console.error(`Refusing: BASE_URL is ${base || "unset"}, not localhost`);
  Deno.exit(1);
}
const n = Number(Deno.args[0] ?? 1000);
if (!Number.isInteger(n) || n < 1) {
  console.error("Usage: make seed ENTRIES=<count>");
  Deno.exit(1);
}

const db = getDb();
runMigrations(db);
const accountId = generateUuidV7();
const now = new Date().toISOString();
const random = (len: number) => crypto.getRandomValues(new Uint8Array(len));
db.exec("BEGIN IMMEDIATE");
db.prepare(`
  INSERT INTO accounts (id, email_enc, email_hmac, tz, locale, created_at)
  VALUES (?, ?, ?, 'Europe/Kyiv', 'en', ?)
`).run(accountId, random(48), random(32), now);
const insert = db.prepare(`
  INSERT INTO entries (id, account_id, seq, key_version, nonce, ciphertext, deleted, received_at)
  VALUES (?, ?, ?, 1, ?, ?, 0, ?)
`);
for (let i = 1; i <= n; i++) {
  insert.run(generateUuidV4(), accountId, i, random(12), random(2064), now);
}
db.exec("COMMIT");
console.log(`[emo] Seeded account ${accountId} with ${n} random entries`);
