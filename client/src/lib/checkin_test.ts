// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The check-in flow end to end: client code against the real server
 * (ui.md §6.2, architecture.md §7.1; ui.md §6).
 */
import "fake-indexeddb/auto";
import { assert, assertEquals } from "@std/assert";
import { startTestServer } from "../../../server/testing/harness.ts";
import type { EntryV2 } from "../../../shared/entry.ts";
import { apiPullEntries, apiPutKeyring } from "./api.ts";
import { decryptEntryLocally, setupKeyring } from "./crypto.ts";
import { forgetDraftInMemory, loadDraft, saveDraft } from "./draft.ts";
import * as m from "./machine.ts";
import {
  finalizeIfAbandoned,
  openCheckIn,
  saveCheckIn,
  stopCheckIn,
  undoCheckIn,
} from "./checkin.ts";
import { runSync } from "./sync.ts";
import { wipeLocalDatabase } from "./db.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const T0 = Date.parse("2026-10-08T10:00:00Z");
const UI = {
  theme: "3f9a1c0be27d4a65",
  intensity: "slider",
  options: "grid",
  figure: "solid",
} as const;

async function ready(email: string) {
  // One device, one account: sign-out wipes local data in the app too
  await wipeLocalDatabase();
  const server = startTestServer();
  const restoreFetch = server.installFetch();
  const { accountId } = await server.signUp(email);
  const setup = await setupKeyring(accountId, "a passphrase 1");
  await apiPutKeyring(1, setup.keyringPut, setup.authProofB64);
  return { restoreFetch, accountId };
}

/** What the server holds for this account, decrypted. */
async function serverEntries(accountId: string): Promise<EntryV2[]> {
  await runSync(accountId);
  const res = await apiPullEntries(0, 500);
  const out: EntryV2[] = [];
  for (const item of res.items) {
    if (item.deleted || !item.nonce_b64 || !item.ct_b64) continue;
    out.push(
      await decryptEntryLocally(
        item.nonce_b64,
        item.ct_b64,
        accountId,
        item.id,
        item.key_version,
      ),
    );
  }
  return out;
}

Deno.test({
  name:
    "checkin - resumes after a restart; abandons after 10 min, keeping the steps before",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await ready("abandon@example.org");
    try {
      let d = await openCheckIn(accountId, 1, "manual", null, T0);
      d = m.next(m.toggleLocation(d, "throat", T0 + 5_000), T0 + 6_000);
      await (await import("./draft.ts")).saveDraft(accountId, d);

      // Restart within 10 minutes: the same draft, same screen
      forgetDraftInMemory();
      const resumed = await openCheckIn(
        accountId,
        1,
        "manual",
        null,
        T0 + 120_000,
      );
      assertEquals([resumed.step, resumed.answers.locations], [1, ["throat"]]);

      // App start ≥ 10 min after the last interaction: finalized as abandoned
      forgetDraftInMemory();
      assertEquals(
        await finalizeIfAbandoned(
          accountId,
          1,
          T0 + 6_000 + m.ABANDON_AFTER_MS,
        ),
        true,
      );
      assertEquals(await loadDraft(accountId), null);
      const [e] = await serverEntries(accountId);
      assertEquals([e.skipped, e.abandoned, e.stopped_at, e.ts], [
        true,
        true,
        "qualities",
        new Date(T0 + 6_000).toISOString(),
      ]);
      // Left on step 2: the zones are kept, nothing after them
      assertEquals(e.body, {
        locations: ["throat"],
        qualities: null,
        intensity: null,
      });
      assertEquals(e.latency_sec, 6);

      // Opened by mistake, never touched: no record at all
      forgetDraftInMemory();
      await openCheckIn(accountId, 1, "manual", null, T0 + 700_000);
      forgetDraftInMemory();
      assertEquals(
        await finalizeIfAbandoned(
          accountId,
          1,
          T0 + 700_000 + m.ABANDON_AFTER_MS,
        ),
        true,
      );
      assertEquals(await loadDraft(accountId), null);
      assertEquals((await serverEntries(accountId)).length, 1);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name: "checkin - skip from a screen; save; Undo refills the form",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await ready("save@example.org");
    try {
      // Stop here on step 2: the zones are kept
      let d = await openCheckIn(accountId, 1, "manual", null, T0, UI);
      d = m.next(m.toggleLocation(d, "chest", T0), T0);
      const skipped = await stopCheckIn(accountId, 1, d, T0 + 20_000);
      assertEquals([skipped.skipped, skipped.abandoned, skipped.stopped_at], [
        true,
        false,
        "qualities",
      ]);
      assertEquals(skipped.body?.locations, ["chest"]);
      assertEquals(skipped.ui, UI);
      assertEquals(await loadDraft(accountId), null);

      // A full check-in with one slider moved
      d = await openCheckIn(
        accountId,
        1,
        "random",
        "0192f1c4-7b43-7000-8000-0000000000aa",
        T0 + 60_000,
      );
      d = m.next(m.toggleLocation(d, "chest", T0 + 60_000), T0 + 60_000);
      d = m.toggleQuality(d, "squeeze", T0 + 61_000);
      d = m.setSlider(d, "arousal", 8, T0 + 62_000);
      d = m.toggleContext(d, "work", T0 + 63_000);
      d = m.setNote(d, "созвон", T0 + 64_000);
      const saved = await saveCheckIn(accountId, 1, d, UI, T0 + 90_000);
      assertEquals(saved.untouched, ["intensity", "valence", "head_mode"]);
      assertEquals([saved.trigger, saved.reminder_id], [
        "random",
        "0192f1c4-7b43-7000-8000-0000000000aa",
      ]);
      assertEquals(saved.latency_sec, 30);
      // Entry ids are random UUID v4 (data.md §2): nothing to order by
      const V4 =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      assert(
        V4.test(saved.id) && V4.test(skipped.id),
        `${saved.id} ${skipped.id}`,
      );

      const onServer = await serverEntries(accountId);
      assertEquals(onServer.length, 2);
      assert(onServer.some((e) => e.id === saved.id && e.note === "созвон"));

      // Undo: gone from the server, back in the form on the last screen
      await undoCheckIn(accountId, saved.id, T0 + 95_000);
      assertEquals((await serverEntries(accountId)).map((e) => e.id), [
        skipped.id,
      ]);
      const refill = await openCheckIn(
        accountId,
        1,
        "manual",
        null,
        T0 + 96_000,
      );
      assertEquals(refill.step, m.LAST_STEP);
      assertEquals(refill.answers.note, "созвон");
      assertEquals(refill.answers.arousal, 8);
      assertEquals(refill.touched, ["arousal"]);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "checkin - a self-started check-in answers a reminder still showing; Undo keeps it",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await ready("link@example.org");
    const REMINDER = "0192f1c4-7b43-7000-8000-0000000000bb";
    const asked: number[] = [];
    const link = (reminderId: string | null) => (now: number) => {
      asked.push(now);
      return Promise.resolve(reminderId);
    };
    try {
      // Home "Now" with the reminder's notification on screen: random
      const d = await openCheckIn(
        accountId,
        1,
        "manual",
        null,
        T0,
        UI,
        link(REMINDER),
      );
      assertEquals([d.trigger, d.reminder_id], ["random", REMINDER]);

      // Skipped on step 1, undone from the Home toast (which says "manual"):
      // the draft keeps the reminder, and nothing is asked again
      const skipped = await stopCheckIn(accountId, 1, d, T0 + 5_000);
      assertEquals([skipped.trigger, skipped.reminder_id, skipped.stopped_at], [
        "random",
        REMINDER,
        "locations",
      ]);
      await undoCheckIn(accountId, skipped.id, T0 + 8_000);
      const back = await openCheckIn(
        accountId,
        1,
        "manual",
        null,
        T0 + 9_000,
        UI,
        link(null),
      );
      assertEquals([back.trigger, back.reminder_id], ["random", REMINDER]);
      assertEquals(asked, [T0]);

      // An event the person marks is never tied to a reminder
      await stopCheckIn(accountId, 1, back, T0 + 10_000);
      const event = await openCheckIn(
        accountId,
        1,
        "after_event",
        null,
        T0 + 20_000,
        UI,
        link(REMINDER),
      );
      assertEquals([event.trigger, event.reminder_id], ["after_event", null]);
      assertEquals(asked, [T0]);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test({
  name:
    "checkin - ui on every entry: the draft's copy kept, layouts merged (stop, save, abandon)",
  ...opts,
  fn: async () => {
    const { restoreFetch, accountId } = await ready("layout@example.org");
    const PHONE = { ...UI, copy: 6, layout: "phone" } as const;
    try {
      // Skip check-in on step 1: no answer, but the copy and layout it was
      // shown in (ui.md §6.2)
      let d = await openCheckIn(accountId, 1, "manual", null, T0, PHONE);
      assertEquals(d.ui, PHONE);
      const skipped = await stopCheckIn(accountId, 1, d, T0 + 5_000);
      assertEquals([skipped.stopped_at, skipped.body, skipped.ui], [
        "locations",
        null,
        PHONE,
      ]);

      // Started in copy 5 on a phone; after a restart (and an update) it
      // goes on held sideways, and is saved upright: the copy it started
      // with, and mixed
      d = await openCheckIn(accountId, 1, "manual", null, T0 + 60_000, {
        ...PHONE,
        copy: 5,
      });
      d = m.next(m.toggleLocation(d, "chest", T0 + 61_000), T0 + 61_000);
      await saveDraft(accountId, d);
      forgetDraftInMemory();
      d = await openCheckIn(accountId, 1, "manual", null, T0 + 120_000, {
        ...PHONE,
        layout: "short",
      });
      const mixed = { ...PHONE, copy: 5, layout: "mixed" } as const;
      assertEquals(d.ui, mixed);
      d = m.toggleQuality(d, "squeeze", T0 + 121_000);
      d = m.toggleContext(d, "work", T0 + 122_000);
      const saved = await saveCheckIn(accountId, 1, d, PHONE, T0 + 130_000);
      assertEquals(saved.ui, mixed);

      // A reminder's form left on step 1: abandoned, with its ui
      const SHORT = { ...PHONE, layout: "short" } as const;
      await openCheckIn(
        accountId,
        1,
        "random",
        "0192f1c4-7b43-7000-8000-0000000000cc",
        T0 + 200_000,
        SHORT,
      );
      forgetDraftInMemory();
      assertEquals(
        await finalizeIfAbandoned(
          accountId,
          1,
          T0 + 200_000 + m.ABANDON_AFTER_MS,
        ),
        true,
      );

      // All three went through the server and back as they were written
      const onServer = await serverEntries(accountId);
      const byId = new Map(onServer.map((e) => [e.id, e]));
      assertEquals(byId.get(skipped.id)?.ui, PHONE);
      assertEquals(byId.get(saved.id)?.ui, mixed);
      const left = onServer.find((e) => e.abandoned);
      assertEquals([left?.stopped_at, left?.ui], ["locations", SHORT]);
      assertEquals(onServer.length, 3);
    } finally {
      restoreFetch();
    }
  },
});
