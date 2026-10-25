// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../db/index.ts";
import {
  activeLease,
  LEASE_TTL_MS,
  releaseLease,
  tryAcquireLease,
} from "./lease.ts";

Deno.test("lease - one holder at a time; renew, expire, release", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const t0 = Date.parse("2026-10-08T12:00:00Z");

  assertEquals(tryAcquireLease(db, "a", t0), true);
  assertEquals(tryAcquireLease(db, "b", t0 + 1000), false); // standby
  assertEquals(tryAcquireLease(db, "a", t0 + 60_000), true); // renew
  assertEquals(
    activeLease(db, t0 + 60_000)?.expires_at,
    new Date(t0 + 60_000 + LEASE_TTL_MS).toISOString(),
  );
  // After a crash the lease expires and another process takes over
  assertEquals(tryAcquireLease(db, "b", t0 + 60_000 + LEASE_TTL_MS + 1), true);
  releaseLease(db, "a"); // not the holder: no effect
  assertEquals(activeLease(db, t0 + 60_000 + LEASE_TTL_MS + 2)?.holder, "b");
  releaseLease(db, "b");
  assertEquals(activeLease(db, t0), null);
  db.close();
});
