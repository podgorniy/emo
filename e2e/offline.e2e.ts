// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §3.6: offline, a band at the top of every screen says
 * so without covering anything; back online, it goes away.
 */
import { assertEquals } from "@std/assert";
import type { Locator, Page } from "playwright-core";
import {
  launchBrowser,
  NOW,
  settingsTitle,
  signUp,
  startServer,
} from "./harness.ts";

/** The element's top edge is at or below the band's bottom edge. */
async function clearOfBand(page: Page, el: Locator): Promise<boolean> {
  const band = await page.locator(".offline-band").boundingBox();
  const box = await el.boundingBox();
  return !!band && !!box && box.y >= band.y + band.height;
}

Deno.test({
  name: "e2e - the offline band shows on every screen and covers nothing",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await signUp(page, server);
      const band = page.locator(".offline-band").getByText("Offline", {
        exact: true,
      });
      const now = page.getByRole("button", { name: NOW });
      assertEquals(await band.count(), 0);

      // Home: the band, and the wordmark below it
      await context.setOffline(true);
      await band.waitFor();
      await page.getByRole("status").filter({ hasText: "You're offline" })
        .waitFor({ state: "attached" });
      const wordmark = page.locator("button.wordmark");
      assertEquals(await clearOfBand(page, wordmark), true);

      // The form: still there, above the progress and the header's links
      await now.click();
      await page.getByText("Step 1 of 9").waitFor();
      await band.waitFor();
      const progress = page.locator("header.head > :first-child");
      const close = page.getByRole("button", { name: /^Close/ });
      assertEquals(await clearOfBand(page, progress), true);
      assertEquals(await clearOfBand(page, close), true);
      await close.click();
      await now.waitFor();

      // Settings
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await settingsTitle(page).waitFor();
      await band.waitFor();

      // Back online: the probe hears the server, the band goes
      await context.setOffline(false);
      await band.waitFor({ state: "detached" });
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
