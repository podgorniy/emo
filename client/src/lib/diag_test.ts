// SPDX-License-Identifier: AGPL-3.0-or-later
import "fake-indexeddb/auto";
import { assertEquals } from "@std/assert";
import { getMeta, wipeLocalDatabase } from "./db.ts";
import { diagnosticsText, type DiagRecord, recordDiag } from "./diag.ts";

Deno.test({
  name: "diag - names only; 100 records; lifetime counts",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await wipeLocalDatabase();
    // Content of any kind is refused
    await recordDiag("because I was late", "checkin");
    await recordDiag("note.rejected", "https://x/?id=1");
    await recordDiag("a@b.cd", "sync");
    assertEquals(await getMeta("diag"), null);

    for (let i = 0; i < 105; i++) await recordDiag("note.rejected", "checkin");
    await recordDiag("unauthenticated", "sync");
    const ring = (await getMeta<DiagRecord[]>("diag"))!;
    assertEquals(ring.length, 100);
    assertEquals(ring.at(-1)!.code, "unauthenticated");
    assertEquals(await getMeta("diag_counts"), {
      "note.rejected": 105,
      unauthenticated: 1,
    });

    const text = await diagnosticsText();
    const report = JSON.parse(text);
    // reliability.md §1.8: versions, counts and codes; nothing else
    assertEquals(Object.keys(report).sort(), [
      "app",
      "clock_skew_sec",
      "counts",
      "epoch",
      "needs_newer_app",
      "outbox",
      "persisted",
      "platform",
      "recent",
      "renamed",
      "server",
      "undecryptable",
    ]);
    assertEquals(Object.keys(report.recent[0]).sort(), ["code", "ts", "where"]);
  },
});
