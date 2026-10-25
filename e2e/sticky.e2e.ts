// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sticky heads (ui.md §11 v1.12, ui.md §15.4,
 * lib/sticky.ts): a pane's title holds at the top, a section's or day's
 * header under it, an open record's row under that; clear at rest, held
 * (`data-stuck`) only once content scrolls under them. Closing a record from
 * its held row leaves the row where it is. Settings' title row carries
 * "Methodology". On a phone and on a desktop, under the pane bar there.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { launchBrowser, seedCheckIns, signUp, startServer } from "./harness.ts";

const SIZES = [
  { width: 390, height: 844, top: 0 },
  { width: 1280, height: 800, top: 62 },
];

/** The held heads, top to bottom: class and top edge (px, rounded) */
function held(page: Page): Promise<Array<[string, number]>> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-pane] [data-stuck]")]
      .map((el) =>
        [
          el.classList[0],
          Math.round(el.getBoundingClientRect().top),
        ] as [string, number]
      )
  );
}

/** The bottom of the title row */
function titleBottom(page: Page): Promise<number> {
  return page.locator(".settings-header").evaluate((el) =>
    Math.round(el.getBoundingClientRect().bottom)
  );
}

Deno.test({
  name:
    "e2e - sticky heads: title, section and open row hold while the pane scrolls; Methodology on Settings' title row",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: SIZES[0],
      })).newPage();
      await signUp(page, server);
      const specs = [];
      for (let d = 0; d < 3; d++) {
        for (const at of ["09:10", "12:30", "15:45", "19:05", "22:40"]) {
          specs.push({ daysAgo: d, at });
        }
      }
      await seedCheckIns(page, specs);

      for (const size of SIZES) {
        const at = `${size.width}×${size.height}`;
        await page.setViewportSize(size);

        // Settings: the methodology on the title row, in a new tab
        await page.goto(`${server.url}/settings`);
        await page.locator("h1.settings-title").waitFor();
        await page.waitForTimeout(300);
        const link = page.locator(".settings-header a");
        assertEquals(await link.innerText(), "Methodology");
        assertEquals(await link.getAttribute("href"), "/methodology#en");
        assertEquals(await link.getAttribute("target"), "_blank");
        assertEquals(await held(page), [], `${at}: nothing held at rest`);

        // Scrolled: the title at the top, a section's header right under it
        await page.evaluate(() => document.body.scrollBy(0, 900));
        await page.waitForTimeout(200);
        const settings = await held(page);
        assertEquals(settings[0], ["settings-header", size.top], `${at}`);
        assertEquals(
          settings[1],
          ["section-header", await titleBottom(page)],
          `${at}: ${JSON.stringify(settings)}`,
        );

        // History: an open record's row holds under the day's header
        await page.goto(`${server.url}/history`);
        await page.locator("main h3").first().waitFor();
        await page.waitForTimeout(300);
        await page.locator(".entry .toggle").nth(1).click();
        await page.locator(".record").waitFor();
        await page.waitForTimeout(400);
        await page.evaluate(() => {
          const entry = document.querySelectorAll(".entry")[1];
          document.body.scrollBy(0, entry.getBoundingClientRect().top + 150);
        });
        await page.waitForTimeout(200);
        const history = await held(page);
        assertEquals(
          history.map(([name]) => name),
          ["settings-header", "section-header", "head"],
          `${at}: ${JSON.stringify(history)}`,
        );
        const day = await page.locator("[data-stuck].day-header").evaluate(
          (el) => Math.round(el.getBoundingClientRect().bottom),
        );
        assertEquals(history[2][1], day, `${at}: the row under the day`);

        // Closed from there: the row stays where it is on the screen
        await page.locator(".entry .toggle").nth(1).click();
        await page.waitForTimeout(500);
        const row = await page.locator(".entry > .head").nth(1).evaluate(
          (el) => Math.round(el.getBoundingClientRect().top),
        );
        assert(Math.abs(row - history[2][1]) <= 1, `${at}: row at ${row}`);
        assertEquals(
          await page.locator(".entry .toggle").nth(1).getAttribute(
            "aria-expanded",
          ),
          "false",
        );
      }
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
