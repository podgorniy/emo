// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./db/index.ts";
import { checkServerSecret } from "./secret_check.ts";

Deno.test("secret check - stored on first boot, then compared", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const secret = "a3f1".repeat(16);
  assertEquals(await checkServerSecret(db, secret), "stored");
  assertEquals(await checkServerSecret(db, secret), "match");
  assertEquals(await checkServerSecret(db, "b4e2".repeat(16)), "mismatch");
  // The stored value is an HMAC, not the secret
  const stored =
    (db.prepare("SELECT value FROM meta WHERE key = 'secret_check'").get() as {
      value: string;
    }).value;
  assertEquals(stored.length, 64);
  assertEquals(stored.includes("a3f1"), false);
  db.close();
});
