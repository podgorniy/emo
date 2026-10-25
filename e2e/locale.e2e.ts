// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Languages (architecture.md §11.3): English is in the app shell, Russian and
 * Ukrainian are lazy chunks (performance.md §1.1). A first visit
 * speaks the browser's language, a choice in Settings applies at once and
 * survives a reload, and no screen shows a raw message key.
 */
import { assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { launchBrowser, NOW, signUp, startServer } from "./harness.ts";

/** Visible text that looks like a message key (`home.now`, `auth.login.title`) */
const rawKeys = (page: Page) =>
  page.evaluate(() =>
    document.body.innerText.match(
      /\b[a-z][a-z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*){2,}\b/g,
    ) ?? []
  );

Deno.test({
  name: "e2e - languages load on demand and survive a reload",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      // A Ukrainian browser: the sign-in screen is Ukrainian from the start
      const uk = await (await browser.newContext({ locale: "uk-UA" }))
        .newPage();
      await uk.goto(server.url);
      await uk.locator("main input").first().waitFor();
      assertEquals(
        await uk.evaluate(() => document.documentElement.lang),
        "uk",
      );
      assertEquals(await rawKeys(uk), []);

      // English, then Russian from Settings: the chunk arrives on the switch
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      const fetched: string[] = [];
      page.on("request", (r) => fetched.push(new URL(r.url()).pathname));
      await signUp(page, server);
      const ruChunk = () =>
        fetched.some((p) => /^\/assets\/ui\.ru-[\w-]+\.js$/.test(p));
      assertEquals(ruChunk(), false);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("radio", { name: "Русский" }).click();
      await page.getByText("ЯЗЫК").waitFor();
      assertEquals(ruChunk(), true);

      await page.reload();
      await page.getByText("ЯЗЫК").waitFor();
      assertEquals(await rawKeys(page), []);
      await page.goBack();
      await page.getByRole("button", { name: "Сейчас" }).waitFor();
      assertEquals(
        await page.getByRole("button", { name: NOW, exact: true }).count(),
        0,
      );
      assertEquals(await rawKeys(page), []);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
