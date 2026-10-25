// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Home's "Saved · Undo" (ui.md §6.5, lib/lastSaved.ts): it lasts
 * 10 s from the save by the clock and is Home's alone, so another pane, the
 * page going hidden or simply time never bring back a stale Undo with a
 * fresh 10 s; and it takes no tap until it has risen in, so a second tap
 * meant for "Skip it" never undoes the skip.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  launchBrowser,
  nextStep,
  NOW,
  signUp,
  startServer,
} from "./harness.ts";

const PHONE = { width: 390, height: 844 };

/** The rows of a store of this browser's database */
function count(page: Page, store: string): Promise<number> {
  return page.evaluate((store) =>
    new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const c = db.transaction(store).objectStore(store).count();
        c.onsuccess = () => {
          db.close();
          resolve(c.result);
        };
      };
    }), store);
}

async function waitStep(page: Page, n: number) {
  await page.getByText(new RegExp(`^Step ${n} of \\d+$`)).waitFor();
}

/** A check-in skipped on step 1 and Done on Saved: Home with its Undo */
async function saveOne(page: Page) {
  await page.getByRole("button", { name: NOW }).click();
  await waitStep(page, 1);
  await page.getByRole("button", { name: "Skip check-in" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: NOW }).waitFor();
  await page.getByRole("button", { name: "Undo" }).waitFor();
}

/** The pane dots: History, or Home ("Check-in") */
async function openPane(page: Page, name: "History" | "Check-in") {
  await page.getByRole("button", { name, exact: true }).first().click();
  if (name === "History") {
    await page.getByRole("heading", { level: 1, name: "History" }).waitFor();
  } else {
    await page.getByRole("button", { name: NOW }).waitFor();
  }
}

/** A check-in answered once and closed: Home and History offer "Skip it" */
async function leaveOneOpen(page: Page) {
  await page.getByRole("button", { name: NOW }).click();
  await waitStep(page, 1);
  await page.locator('[data-null="whole_body"]').click();
  await nextStep(page);
  await waitStep(page, 2);
  await page.getByRole("button", { name: "Close — you can continue later" })
    .click();
  await page.getByRole("button", { name: "Skip it" }).waitFor();
}

/** History's gate: "Skip it", then the list without the gate */
async function skipInHistory(page: Page) {
  await openPane(page, "History");
  await page.getByText("A check-in is in progress.").waitFor();
  await page.getByRole("button", { name: "Skip it" }).click();
  await page.getByText("A check-in is in progress.").waitFor({
    state: "detached",
  });
}

/** The page hidden (another app, the lock screen), then shown again */
async function hideAndShow(page: Page, between?: () => Promise<void>) {
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await between?.();
  await page.evaluate(() => {
    delete (document as { hidden?: boolean }).hidden;
    delete (document as { visibilityState?: string }).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** No toast now, nor after the time a rise-in would take */
async function noUndo(page: Page, why: string) {
  await page.waitForTimeout(600);
  assertEquals(await page.locator(".toast-container").count(), 0, why);
}

Deno.test({
  name:
    "e2e - undo: Home's Undo is gone after another pane, after its 10 s and once the page is hidden (on Saved too); never a fresh 10 s",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: PHONE,
      })).newPage();
      await signUp(page, server);

      // Leaving Home ends it: straight back, no Undo
      await saveOne(page);
      await openPane(page, "History");
      await openPane(page, "Check-in");
      await noUndo(page, "back from History at once");

      // The page hidden (another app, the lock screen): it ends there
      await saveOne(page);
      await hideAndShow(
        page,
        () => page.locator(".toast-container").waitFor({ state: "detached" }),
      );
      await noUndo(page, "visible again");

      // Hidden while Saved shows: Home offers no Undo once Saved hands over
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await page.getByRole("button", { name: "Skip check-in" }).click();
      const done = page.getByRole("button", { name: "Done", exact: true });
      await done.waitFor();
      await hideAndShow(page);
      await done.click();
      await page.getByRole("button", { name: NOW }).waitFor();
      await noUndo(page, "hidden on Saved");

      // "Skip it" in History: the deadline itself decides. Home 11 s later:
      // nothing
      await leaveOneOpen(page);
      await skipInHistory(page);
      const late = Date.now();
      await page.waitForTimeout(Math.max(0, late + 11_000 - Date.now()));
      await openPane(page, "Check-in");
      await noUndo(page, "Home 11 s after History's Skip it");

      // Home 6 s later: only what is left of the 10 s, never a fresh 10 s
      await leaveOneOpen(page);
      await skipInHistory(page);
      const skipped = Date.now();
      await page.waitForTimeout(Math.max(0, skipped + 6_000 - Date.now()));
      await openPane(page, "Check-in");
      const toast = page.locator(".toast-container");
      await toast.waitFor();
      await toast.waitFor({
        state: "detached",
        timeout: Math.max(1, skipped + 11_500 - Date.now()),
      });
      // Every save stands: five entries, none undone
      assertEquals(await count(page, "entries"), 5);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - undo: a tap in the toast's first 300 ms is not an Undo, and lands on nothing under it; Undo works once armed",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: PHONE,
      })).newPage();
      await signUp(page, server);

      // A check-in left open: Home offers Continue · Skip it
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      await page.getByRole("button", { name: "Close — you can continue later" })
        .click();
      const skip = page.getByRole("button", { name: "Skip it" });
      await skip.waitFor();

      // When the toast arrives, and the first press after it
      await page.evaluate(() => {
        const w = globalThis as unknown as {
          __toastAt?: number;
          __tapAt?: number;
        };
        new MutationObserver(() => {
          if (!w.__toastAt && document.querySelector(".toast-container")) {
            w.__toastAt = performance.now();
          }
        }).observe(document.body, { childList: true, subtree: true });
        addEventListener("pointerdown", () => {
          if (w.__toastAt && !w.__tapAt) w.__tapAt = performance.now();
        }, true);
      });

      // Skip it, then a second tap right where Undo has just appeared
      await skip.click();
      const undo = page.locator(".toast-container .undo-btn");
      await undo.waitFor();
      const box = (await undo.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const { toastAt, tapAt } = await page.evaluate(() => {
        const w = globalThis as unknown as {
          __toastAt: number;
          __tapAt: number;
        };
        return { toastAt: w.__toastAt, tapAt: w.__tapAt };
      });
      assert(tapAt - toastAt < 300, `the tap came ${tapAt - toastAt} ms in`);

      // Nothing happened: Home, the skip stands, nothing under the toast took it
      await page.waitForTimeout(150);
      assertEquals(await page.getByText(/^Step \d+ of \d+$/).count(), 0);
      await page.getByRole("button", { name: NOW }).waitFor();
      assert(await undo.isVisible(), "the toast is still there");
      assertEquals(await count(page, "draft"), 0);
      assertEquals(await count(page, "entries"), 1);

      // Armed (350 ms in): Undo brings the answers back as the form
      await page.waitForTimeout(400);
      await undo.click();
      await page.getByText(/^Step \d+ of \d+$/).waitFor();
      assertEquals(await count(page, "draft"), 1);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
