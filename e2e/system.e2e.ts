// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * System screens and guards: storage that will not open offers "Try again"
 * (a reload) first and resets this device only after a destructive confirm
 * (reliability.md §1.1); History's "Skip it" saves once however fast it is
 * tapped, and opens one record at a time (ui.md §15.9, §15.14); on a
 * small phone a sign-up card taller than the screen rests at its end, so its
 * primary is never cut off by the fold (ui.md §12).
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  launchBrowser,
  nextStep,
  NOW,
  seedCheckIns,
  signUp,
  startServer,
} from "./harness.ts";

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

/** While this flag is set, every `indexedDB.open` fails as a damaged store would */
const BROKEN = "e2e.idbBroken";

Deno.test({
  name:
    "e2e - storage damaged: Try again reloads; Reset this device asks first, Cancel keeps everything, the confirm resets",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
      })).newPage();
      await signUp(page, server);

      await page.addInitScript((flag) => {
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (
          this: IDBFactory,
          name: string,
          version?: number,
        ) {
          if (localStorage.getItem(flag) !== "1") {
            return open.call(this, name, version);
          }
          const req = {
            error: new DOMException("e2e: damaged", "UnknownError"),
            onerror: null as ((e: Event) => void) | null,
          };
          setTimeout(() => req.onerror?.(new Event("error")), 0);
          return req as unknown as IDBOpenDBRequest;
        };
      }, BROKEN);
      await page.evaluate((flag) => localStorage.setItem(flag, "1"), BROKEN);
      await page.reload();
      const damaged = page.getByText(
        /^Local storage on this device is damaged/,
      );
      await damaged.waitFor();
      const retry = page.getByRole("button", { name: "Try again" });
      const reset = page.getByRole("button", { name: "Reset this device" });
      await retry.waitFor();
      await reset.waitFor();

      // Try again: a reload (still damaged here)
      await page.evaluate(() => {
        (globalThis as unknown as { __before: boolean }).__before = true;
      });
      await retry.click();
      await page.waitForFunction(() => !("__before" in globalThis));
      await damaged.waitFor();

      // Reset asks first; Cancel leaves the screen and the data as they were
      await page.evaluate(() => {
        (globalThis as unknown as { __before: boolean }).__before = true;
      });
      await reset.click();
      const sheet = page.getByRole("dialog");
      await sheet.getByText("Reset this device?").waitFor();
      await sheet.getByText(/haven't reached the server yet will be lost/)
        .waitFor();
      await sheet.getByRole("button", { name: "Cancel" }).click();
      await sheet.waitFor({ state: "detached" });
      await damaged.waitFor();
      assert(
        await page.evaluate(() => "__before" in globalThis),
        "Cancel reloaded or reset",
      );

      // Confirmed: the local database goes, the session stays, so the
      // reloaded app asks for the passphrase (the keys were local)
      await reset.click();
      await sheet.getByText("Reset this device?").waitFor();
      await page.evaluate((flag) => localStorage.removeItem(flag), BROKEN);
      await sheet.getByRole("button", { name: "Reset this device" }).click();
      await page.getByRole("button", { name: "Use recovery key" }).waitFor();
      await page.locator("#unlock-passphrase").waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - History: a double tap on Skip it saves one skipped check-in; one record open at a time (desktop)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 1280, height: 800 },
      })).newPage();
      await signUp(page, server);

      // A check-in left open, then History: its gate
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      await page.getByRole("button", { name: "Close — you can continue later" })
        .click();
      await page.getByRole("button", { name: "Continue" }).waitFor();
      // Close's own Back (from /now to /) lands first: a load started while
      // that traversal is still on its way is taken back with it
      await page.waitForURL((url) => url.pathname === "/");
      await page.goto(`${server.url}/history`);
      await page.getByText("A check-in is in progress.").waitFor();

      // Two taps as one: a single skipped check-in, then the list
      await page.getByRole("button", { name: "Skip it" }).dblclick();
      const rows = page.locator("main h3 button");
      await rows.first().waitFor();
      await page.waitForTimeout(500);
      assertEquals(await rows.count(), 1);
      assertEquals(await count(page, "entries"), 1);
      assertEquals(await count(page, "draft"), 0);

      // One record at a time: opening one closes the other
      await seedCheckIns(page, [
        { daysAgo: 1, at: "09:10" },
        { daysAgo: 1, at: "18:40" },
      ]);
      await page.goto(`${server.url}/history`);
      await rows.nth(2).waitFor();
      const first = rows.nth(1);
      const second = rows.nth(2);
      await first.click();
      assertEquals(await first.getAttribute("aria-expanded"), "true");
      await second.click();
      assertEquals(await second.getAttribute("aria-expanded"), "true");
      assertEquals(await first.getAttribute("aria-expanded"), "false");
      const open = page.locator("main h3 button[aria-expanded=true]");
      assertEquals(await open.count(), 1);
      // A tap on the open one closes it: none open
      await second.click();
      assertEquals(await open.count(), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

/**
 * The button is whole inside the viewport and a tap at its centre reaches
 * it, once the screen has come to rest.
 */
async function fullyVisible(page: Page, name: string, screen: string) {
  await page.waitForTimeout(400);
  const button = page.getByRole("button", { name, exact: true });
  const at = await button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: innerHeight,
      reached: hit !== null && (hit === el || el.contains(hit)),
    };
  });
  assert(
    at.top >= 0 && at.bottom <= at.height,
    `${screen}: ${name} at ${at.top}–${at.bottom} of ${at.height}`,
  );
  assert(at.reached, `${screen}: ${name} is covered`);
}

Deno.test({
  name:
    "e2e - sign-up at 375×667: the passphrase, recovery-key and last steps rest at their end, the primary whole on screen",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        isMobile: true,
      })).newPage();
      await signUp(page, server, async (screen) => {
        if (screen === "passphrase") {
          await fullyVisible(page, "Next", screen);
          // Typed: the meter and the match line grow the card; Next stays
          await page.getByLabel(/^Passphrase/).fill(
            "correct horse battery staple",
          );
          await page.getByLabel("Repeat").fill("correct horse battery staple");
          await fullyVisible(page, "Next", `${screen}, typed`);
        } else if (screen === "recovery key") {
          await fullyVisible(page, "Next", screen);
        } else if (screen === "install and reminders") {
          await fullyVisible(page, "Done", screen);
        }
      });
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
