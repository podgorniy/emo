// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Saving, Saved and its Undo when something goes wrong, in the compiled app
 * (ui.md §6.2–§6.5, reliability.md §1.3, §1.8): the bottom inset
 * is counted once under Next and Done; Undo never waits on the network; an
 * Undo or a save that storage refuses says so in one line, keeps what was
 * there and works on the next try; `/now` in a second tab offers "Go to it",
 * which asks the tab with the form to come forward. A keyboard the note had
 * up (e2e/keyboard.ts), even with the page zoomed in, is gone once Save
 * removes the note: Home shows the pane dots and the Undo toast again,
 * though the viewport still reports it (iOS may not give it back).
 */
import { assert, assertEquals } from "@std/assert";
import type { Page, Route } from "playwright-core";
import {
  launchBrowser,
  nextStep,
  NOW,
  signUp,
  startServer,
} from "./harness.ts";
import { installKeyboardStub, setViewport, showKeyboard } from "./keyboard.ts";
import type { MessageKey } from "../shared/i18n/keys.ts";
import { t as translate } from "../shared/i18n/format.ts";

const PHONE = { locale: "en-GB", viewport: { width: 390, height: 844 } };
const en = (key: MessageKey) => translate("en", key);

async function waitStep(page: Page, n: number, timeout?: number) {
  await page.getByText(new RegExp(`^Step ${n} of \\d+$`)).waitFor({ timeout });
}

function saved(page: Page) {
  return page.getByRole("status", { name: en("checkin.saved.aria") });
}

function button(page: Page, key: MessageKey) {
  return page.getByRole("button", { name: en(key), exact: true });
}

async function until(fn: () => Promise<boolean>, what: string) {
  const end = Date.now() + 15_000;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function near(actual: number, expected: number, what: string) {
  assert(
    Math.abs(actual - expected) <= 1,
    `${what}: ${actual} px, expected ${expected}`,
  );
}

/** Every row of a store of this browser's database (plain rows only) */
function rows<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate((store) =>
    new Promise<unknown[]>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction(store).objectStore(store).getAll();
        all.onerror = () => reject(all.error);
        all.onsuccess = () => {
          db.close();
          resolve(all.result);
        };
      };
    }), store) as Promise<T[]>;
}

/** Saved check-ins on this device: rows that are not tombstones */
async function liveEntries(page: Page): Promise<number> {
  return (await rows<{ deleted: boolean }>(page, "entries"))
    .filter((e) => !e.deleted).length;
}

/** The lifetime count of a diagnostics event (`meta.diag_counts`) */
function diagCount(page: Page, code: string): Promise<number> {
  return page.evaluate((code) =>
    new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction("meta").objectStore("meta").get(
          "diag_counts",
        );
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          db.close();
          const counts = (get.result?.value ?? {}) as Record<string, number>;
          resolve(counts[code] ?? 0);
        };
      };
    }), code);
}

/**
 * Every write of a check-in row fails, as on a damaged store; `false` puts
 * the browser's own `put` back. Other stores (the draft, diagnostics) work.
 */
function breakEntryWrites(page: Page, broken: boolean): Promise<void> {
  return page.evaluate((broken) => {
    const g = globalThis as { emoPut?: IDBObjectStore["put"] };
    g.emoPut ??= IDBObjectStore.prototype.put;
    const put = g.emoPut;
    IDBObjectStore.prototype.put = broken
      ? function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
        if (this.name === "entries") {
          throw new DOMException("stubbed", "UnknownError");
        }
        return put.apply(this, args);
      }
      : put;
  }, broken);
}

/** How far above the viewport's bottom edge the element ends, in px */
function lift(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) =>
    innerHeight - el.getBoundingClientRect().bottom
  );
}

/**
 * The bottom safe-area inset, as an iPhone with a home indicator has it;
 * resolves once the padding has followed (reduced motion still runs a
 * 0.01 ms transition of it)
 */
function inset(page: Page, px: number): Promise<void> {
  return page.evaluate(async (px) => {
    document.documentElement.style.setProperty("--safe-bottom", `${px}px`);
    // getAnimations() brings the style up to date, transitions included
    await Promise.all(
      document.getAnimations().filter((a) => a instanceof CSSTransition)
        .map((a) => a.finished.catch(() => {})),
    );
  }, px);
}

/** Its arrival is over, so its box is where it rests */
function settled(page: Page, selector: string): Promise<unknown> {
  return page.locator(selector).evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})))
  );
}

Deno.test({
  name:
    "e2e - check-in: the bottom inset is counted once, under Next and under Done",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext(PHONE)).newPage();
      await signUp(page, server);
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);

      // A 34 px home indicator lifts the footer by 34 px, not 68
      const bare = await lift(page, "button.next");
      await inset(page, 34);
      const next = await lift(page, "button.next");
      near(next - bare, 34, "Next over the inset");

      // Saved: Done where Save was, over the same inset
      await button(page, "common.skipCheckin").click();
      await saved(page).waitFor();
      await settled(page, ".saved .actions");
      const done = await lift(page, "button.done");
      near(done, next, "Done where Next was");
      await inset(page, 0);
      near(done - await lift(page, "button.done"), 34, "Done over the inset");
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - Saved: Undo never waits on the network; a failed Undo says so, keeps the check-in and counts down again",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const held: Route[] = [];
    try {
      const page = await (await browser.newContext(PHONE)).newPage();
      await signUp(page, server);
      const undo = button(page, "checkin.saved.undo");
      const done = button(page, "common.done");
      const failed = page.getByRole("alert").filter({
        hasText: en("checkin.saved.undoFailed"),
      });
      const undone = page.getByText(en("checkin.saved.undone"));

      // 1. The connection stalls, from the save's own upload on (its pass
      //    holds the sync lock): the form is back at once, and the upload
      //    and then the DELETE go out once the connection answers
      let stalled = true;
      await page.route("**/api/entries/**", (route: Route) => {
        const method = route.request().method();
        const hold = stalled && (method === "PUT" || method === "DELETE");
        if (!hold) return route.continue();
        held.push(route);
      });
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await button(page, "common.skipCheckin").click();
      await saved(page).waitFor();
      await until(
        () => Promise.resolve(held.length > 0),
        "the save's upload was sent",
      );
      await undo.click();
      await waitStep(page, 1, 5000);
      await undone.waitFor();
      assertEquals(await liveEntries(page), 0);
      stalled = false;
      for (const route of held.splice(0)) await route.continue();
      await until(
        async () => (await rows(page, "outbox")).length === 0,
        "the DELETE reached the server",
      );
      assertEquals(await liveEntries(page), 0);

      // 2. Storage refuses the deletion: Saved stays, says so, the buttons
      //    come back and the check-in is still saved; a second try works
      await button(page, "common.skipCheckin").click();
      await saved(page).waitFor();
      await breakEntryWrites(page, true);
      await undo.click();
      await failed.waitFor();
      assert(await undo.isEnabled(), "Undo stayed disabled");
      assert(await done.isEnabled(), "Done stayed disabled");
      assertEquals(await liveEntries(page), 1);
      await until(
        async () => (await diagCount(page, "checkin.undo_failed")) === 1,
        "the failure was counted",
      );
      await breakEntryWrites(page, false);
      await undo.click();
      await waitStep(page, 1);
      await undone.waitFor();
      assertEquals(await liveEntries(page), 0);

      // 3. Refused again and left alone: Saved counts its 5 s down afresh
      //    and returns home, the check-in kept
      await button(page, "common.skipCheckin").click();
      await saved(page).waitFor();
      await breakEntryWrites(page, true);
      await undo.click();
      await failed.waitFor();
      const since = Date.now();
      await breakEntryWrites(page, false);
      await page.getByRole("button", { name: NOW }).waitFor({ timeout: 9000 });
      assert(Date.now() - since >= 4000, "Saved left before its 5 s");
      assertEquals(await liveEntries(page), 1);
    } finally {
      for (const route of held) await route.continue().catch(() => {});
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - check-in: a save storage refuses says so above the nav, is counted, and works on the next try",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext(PHONE)).newPage();
      await signUp(page, server);
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      const skip = button(page, "common.skipCheckin");
      const next = page.locator("button.next");
      const skipAt = (await skip.boundingBox())!.y;
      const nextAt = (await next.boundingBox())!.y;

      await breakEntryWrites(page, true);
      await skip.click();
      const failed = page.getByRole("alert").filter({
        hasText: en("checkin.save.failed"),
      });
      await failed.waitFor();
      await page.waitForTimeout(300); // its 6 px rise

      // Still the form on its step; the ways on stay under the finger, the
      // line above them
      await waitStep(page, 1);
      near((await skip.boundingBox())!.y, skipAt, "Skip check-in moved");
      near((await next.boundingBox())!.y, nextAt, "Next moved");
      const line = (await failed.boundingBox())!;
      const exits = (await page.locator(".foot .exits").boundingBox())!;
      assert(line.y + line.height <= exits.y + 1, "the line is not above");
      assert(await skip.isEnabled(), "Skip check-in stayed disabled");
      assertEquals(await liveEntries(page), 0);
      await until(
        async () => (await diagCount(page, "checkin.save_failed")) === 1,
        "the failure was counted",
      );

      // The next try works: Saved
      await breakEntryWrites(page, false);
      await skip.click();
      await saved(page).waitFor();
      assertEquals(await liveEntries(page), 1);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - /now in a second tab: Go to it pings the tab with the form; Close goes home",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext(PHONE);
      const page = await context.newPage();
      await signUp(page, server);
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      // The tab with the form counts the times it is asked to come forward
      await page.evaluate(() => {
        const g = globalThis as { emoFocused?: number };
        g.emoFocused = 0;
        (globalThis as { focus: () => void }).focus = () => {
          g.emoFocused = (g.emoFocused ?? 0) + 1;
        };
      });
      const pinged = () =>
        page.evaluate(() =>
          (globalThis as { emoFocused?: number }).emoFocused ?? 0
        );

      const tab = await context.newPage();
      await tab.goto(`${server.url}/now`);
      await tab.getByText(en("checkin.otherWindow")).waitFor();
      const go = button(tab, "checkin.otherWindow.focus");
      const close = button(tab, "common.close");

      // The pair under the thumb: Go to it at the right, Close at its left
      const g = (await go.boundingBox())!;
      const c = (await close.boundingBox())!;
      assert(c.x + c.width <= g.x, "Close is not at the left of Go to it");
      near(c.y, g.y, "one row");
      assert(g.y >= PHONE.viewport.height * 2 / 3, "above the bottom third");

      await go.click();
      await until(async () => (await pinged()) === 1, "the form's tab pinged");

      // Close: this tab goes home; the form stays open in the other one
      await close.click();
      await tab.locator("button.now").waitFor();
      await waitStep(page, 1);
      assertEquals(await pinged(), 1);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

/** From Home to the note with the fewest answers (ui.md §6.2) */
async function toNote(page: Page) {
  await page.getByRole("button", { name: NOW }).click();
  await waitStep(page, 1);
  await page.locator('[data-null="whole_body"]').click();
  await nextStep(page);
  await waitStep(page, 2);
  await page.locator('[data-null="nothing"]').click();
  for (let n = 3; n <= 9; n++) {
    await nextStep(page);
    await waitStep(page, n);
  }
  await page.getByRole("button", { name: "work", exact: true }).click();
}

/** What says a keyboard is up, and whether the dots and the toast show */
function chrome(page: Page) {
  return page.evaluate(() => {
    const display = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : "absent";
    };
    return {
      kb: document.documentElement.hasAttribute("data-kb"),
      dots: display("nav.dots"),
      toast: display(".toast-container"),
    };
  });
}

for (const zoomed of [false, true]) {
  Deno.test({
    name: `e2e - Saved: a keyboard the note had up${
      zoomed ? ", zoomed in," : ""
    } never hides the dots or the toast once the note is gone`,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const server = await startServer();
      const browser = await launchBrowser();
      try {
        const context = await browser.newContext({
          ...PHONE,
          hasTouch: true,
          isMobile: true,
        });
        await installKeyboardStub(context);
        const page = await context.newPage();
        await signUp(page, server);
        await toNote(page);

        // The keyboard comes up for the note (and, on iOS, the page may be
        // left a little zoomed in)
        const note = page.locator("textarea");
        await note.fill("kitchen, 15 minutes");
        await note.focus();
        await showKeyboard(page, 336);
        if (zoomed) await setViewport(page, { scale: 1.2 });
        assertEquals((await chrome(page)).kb, true, "the keyboard is up");

        // Saved from the note, so focus stays in it until it is removed; the
        // viewport still reports the keyboard (iOS may not give it back).
        // Forward actions wait 350 ms after a step change (ui.md §5.1)
        await page.waitForTimeout(400);
        await page.keyboard.press("Control+Enter");
        await saved(page).waitFor();
        // Read again on the next frame
        await page.waitForFunction(
          () => !document.documentElement.hasAttribute("data-kb"),
          undefined,
          { timeout: 1000 },
        );

        // Done: Home with the dots and the Undo toast
        await button(page, "common.done").click();
        await page.getByRole("button", { name: NOW, exact: true }).waitFor();
        await page.locator(".toast-container").waitFor();
        const home = await chrome(page);
        assertEquals(home.kb, false, "Home: no keyboard");
        assertEquals(home.dots, "flex", "Home: the dots show");
        assert(home.toast !== "none", `Home: the toast shows (${home.toast})`);
      } finally {
        await browser.close();
        await server.stop();
      }
    },
  });
}
