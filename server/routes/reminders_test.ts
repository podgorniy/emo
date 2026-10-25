// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The reminder journal pull (api.md §2.8): the cursor never splits a
 * timestamp, and a row that only becomes visible later is still pulled.
 */
import { assertEquals } from "@std/assert";
import { startTestServer, TEST_ORIGIN } from "../testing/harness.ts";
import type { RemindersPullRes } from "../../shared/protocol.ts";

const MIN = 60_000;
const KYIV = "Europe/Kyiv";

function setup() {
  const server = startTestServer();
  const restore = server.installFetch();
  const insert = server.db.prepare(`
    INSERT INTO reminders (id, account_id, local_date, tz, scheduled_for, sent_at, status, updated_at)
    VALUES (?, ?, '2026-10-08', ?, ?, NULL, ?, ?)
  `);
  const pull = async (since?: string) => {
    const res = await fetch(
      `${TEST_ORIGIN}/api/reminders${
        since ? `?since=${encodeURIComponent(since)}` : ""
      }`,
    );
    assertEquals(res.status, 200);
    return await res.json() as RemindersPullRes;
  };
  return { server, restore, insert, pull };
}

Deno.test("reminders - a page ends with every row of its last timestamp", async () => {
  const { server, restore, insert, pull } = setup();
  try {
    const { accountId } = await server.signUp("ties@example.org");
    const now = Date.now();
    const at = (minAgo: number) => new Date(now - minAgo * MIN).toISOString();
    // 499 rows at t1, three at t2 (rows 500–502: a bulk update), one at t3
    server.db.exec("BEGIN");
    for (let i = 0; i < 499; i++) {
      insert.run(
        crypto.randomUUID(),
        accountId,
        KYIV,
        at(600 + i),
        "cancelled",
        at(30),
      );
    }
    for (let i = 0; i < 3; i++) {
      insert.run(
        crypto.randomUUID(),
        accountId,
        KYIV,
        at(1200 + i),
        "cancelled",
        at(20),
      );
    }
    insert.run(crypto.randomUUID(), accountId, KYIV, at(15), "sent", at(10));
    server.db.exec("COMMIT");

    const first = await pull();
    assertEquals(first.items.length, 502);
    assertEquals(first.has_more, true);
    assertEquals(first.next_since, at(20));

    const second = await pull(first.next_since);
    assertEquals(second.items.map((i) => i.status), ["sent"]);
    assertEquals(second.has_more, false);
    assertEquals((await pull(second.next_since)).items, []);
  } finally {
    restore();
  }
});

Deno.test("reminders - a row cancelled ahead of time is pulled once it is due", async () => {
  const { server, restore, insert, pull } = setup();
  try {
    const { accountId } = await server.signUp("cancelled@example.org");
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    // Cancelled an hour ago, due in 300 ms; another row was sent since
    const cancelledId = crypto.randomUUID();
    insert.run(
      cancelledId,
      accountId,
      KYIV,
      iso(now + 300),
      "cancelled",
      iso(now - 60 * MIN),
    );
    insert.run(
      crypto.randomUUID(),
      accountId,
      KYIV,
      iso(now - 31 * MIN),
      "sent",
      iso(now - 30 * MIN),
    );

    const before = await pull();
    assertEquals(before.items.map((i) => i.status), ["sent"]);
    assertEquals(before.next_since, iso(now - 30 * MIN));

    await new Promise((r) => setTimeout(r, 400));
    const after = await pull(before.next_since);
    assertEquals(after.items.map((i) => i.id), [cancelledId]);
    assertEquals(after.next_since, iso(now + 300));
  } finally {
    restore();
  }
});

Deno.test("reminders - each row carries its time zone and why it was cancelled", async () => {
  const { server, restore, pull } = setup();
  try {
    const { accountId } = await server.signUp("reason@example.org");
    const at = new Date(Date.now() - 60 * MIN).toISOString();
    const later = new Date(Date.now() - 30 * MIN).toISOString();
    const insert = server.db.prepare(`
      INSERT INTO reminders (id, account_id, local_date, tz, scheduled_for, status, reason, updated_at)
      VALUES (?, ?, '2026-10-08', ?, ?, ?, ?, ?)
    `);
    insert.run(crypto.randomUUID(), accountId, KYIV, at, "sent", null, at);
    insert.run(
      crypto.randomUUID(),
      accountId,
      "America/New_York",
      later,
      "cancelled",
      "no_device",
      later,
    );

    const { items } = await pull();
    assertEquals(
      items.map((i) => [i.status, i.tz, i.reason]).sort(),
      [
        ["cancelled", "America/New_York", "no_device"],
        ["sent", KYIV, null],
      ],
    );
  } finally {
    restore();
  }
});
