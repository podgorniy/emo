// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { RateLimiter } from "./rate_limit.ts";
import { runMigrations } from "../db/index.ts";

Deno.test("rate_limit - in-memory consume, check, and reset", () => {
  const rl = new RateLimiter(false);
  try {
    const key = "test:short";
    assertEquals(rl.consume(key, 3, 60), { allowed: true, remaining: 2 });
    assertEquals(rl.check(key, 3, 60), { allowed: true, remaining: 2 });
    assertEquals(rl.consume(key, 3, 60), { allowed: true, remaining: 1 });
    assertEquals(rl.consume(key, 3, 60), { allowed: true, remaining: 0 });

    const blocked = rl.consume(key, 3, 60);
    assertEquals(blocked.allowed, false);
    assertEquals(blocked.remaining, 0);
    assertEquals(typeof blocked.retryAfterSec, "number");

    // check also shows blocked
    const checkBlocked = rl.check(key, 3, 60);
    assertEquals(checkBlocked.allowed, false);
    assertEquals(checkBlocked.remaining, 0);

    // reset clears limit
    rl.reset(key);
    assertEquals(rl.check(key, 3, 60), { allowed: true, remaining: 3 });
  } finally {
    rl.destroy();
  }
});

Deno.test("rate_limit - persistent sqlite backing survives instance restart for long windows", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);

  const rl1 = new RateLimiter(false);
  rl1.initDb(db);
  const key = "verify_fail_email:user1";

  // Consume 3 out of 5 allowed attempts in a 24h window
  assertEquals(rl1.consume(key, 5, 86400), { allowed: true, remaining: 4 });
  assertEquals(rl1.consume(key, 5, 86400), { allowed: true, remaining: 3 });
  assertEquals(rl1.consume(key, 5, 86400), { allowed: true, remaining: 2 });
  rl1.destroy();

  // Simulate process restart: brand new RateLimiter instance initialized with the same database
  const rl2 = new RateLimiter(false);
  rl2.initDb(db);
  try {
    // Check sees persistent state from rl1
    assertEquals(rl2.check(key, 5, 86400), { allowed: true, remaining: 2 });

    // Consume remaining 2 attempts
    assertEquals(rl2.consume(key, 5, 86400), { allowed: true, remaining: 1 });
    assertEquals(rl2.consume(key, 5, 86400), { allowed: true, remaining: 0 });

    // 6th attempt is blocked
    const blocked = rl2.consume(key, 5, 86400);
    assertEquals(blocked.allowed, false);
    assertEquals(blocked.remaining, 0);
    assertEquals(typeof blocked.retryAfterSec, "number");

    // Reset clears persistent table
    rl2.reset(key);
    assertEquals(rl2.check(key, 5, 86400), { allowed: true, remaining: 5 });
  } finally {
    rl2.destroy();
  }
});
