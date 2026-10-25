// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §2.2: `/`, `/settings` (with `#appearance`), `/now` and
 * `/history` are routes, and Back closes the form, Settings or History
 * instead of leaving the app; a check-in left by Back, or by a reload,
 * resumes on the same step.
 */
import { assertEquals } from "@std/assert";
import {
  launchBrowser,
  settingsTitle,
  signUp,
  startServer,
} from "./harness.ts";

Deno.test({
  name: "e2e - Back closes the check-in and Settings; deep links open them",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      // A phone: dots, no desktop tabs
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
      })).newPage();
      await signUp(page, server);
      const path = () => new URL(page.url()).pathname;
      // "Now", or "Continue" while a check-in is open (ui.md §3)
      const now = page.locator("button.now");

      // The form: Back returns Home, the draft keeps its step
      await now.click();
      await page.getByText("Step 1 of 9").waitFor();
      assertEquals(path(), "/now");
      await page.getByRole("button", { name: "whole body", exact: false })
        .first().click();
      await page.locator("button.next").click();
      await page.getByText("Step 2 of 9").waitFor();
      // The qualities summary is in view, not under the sticky footer (ui.md §6.5)
      assertEquals(
        await page.locator("p.summary").evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 2);
          return r.bottom <= innerHeight && !!hit && el.contains(hit);
        }),
        true,
      );
      await page.goBack();
      await now.waitFor();
      assertEquals(path(), "/");
      await now.click();
      await page.getByText("Step 2 of 9").waitFor();
      await page.goBack();
      await now.waitFor();

      // A reload in the middle: the form reopens on its step (ui.md §6.2, M70)
      await now.click();
      await page.getByText("Step 2 of 9").waitFor();
      await page.reload();
      await page.getByText("Step 2 of 9").waitFor();
      assertEquals(path(), "/now");
      await page.getByRole("button", { name: /^Close/ }).click();
      await now.waitFor();

      // Settings: Back returns Home
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await settingsTitle(page).waitFor();
      assertEquals(path(), "/settings");
      await page.goBack();
      await now.waitFor();
      assertEquals(path(), "/");

      // A deep link: Settings, scrolled to Appearance; Back still goes Home
      await page.goto(`${server.url}/settings#appearance`);
      await page.getByRole("radiogroup", { name: /theme/i }).waitFor();
      assertEquals(path(), "/settings");
      const top = await page.locator("#appearance").evaluate((el) =>
        el.getBoundingClientRect().top
      );
      assertEquals(top < 200, true, String(top));
      await page.goBack();
      await now.waitFor();
      assertEquals(path(), "/");

      // History (ui.md §15.3): its dot, a deep link, Back to Home
      await page.getByRole("button", { name: "History", exact: true }).click();
      const history = page.getByRole("heading", { level: 1, name: "History" });
      await history.waitFor();
      assertEquals(path(), "/history");
      await page.goBack();
      await now.waitFor();
      assertEquals(path(), "/");
      await page.goto(`${server.url}/history`);
      await history.waitFor();
      assertEquals(path(), "/history");
      await page.goBack();
      await now.waitFor();
      assertEquals(path(), "/");
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
