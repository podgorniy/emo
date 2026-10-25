// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Settings → About's links with the service worker in control: the built-in
 * privacy notice and the methodology open as themselves (not the app), in
 * the app's language and accessible; "Source code" downloads this build's
 * archive (AGPL §13, tools/pack_source.ts). The methodology also before any
 * account (the sign-in screen's "Methodology"), at `/methodology`, offline
 * too; on a phone its mark and languages rest at the bottom, under the thumb
 * (ui.md §4.5), and the mark goes to the app.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  auditA11y,
  launchBrowser,
  NOW,
  signUp,
  startServer,
  watchCsp,
} from "./harness.ts";

/** The methodology's bar on a phone: in the thumb band, languages last */
async function assertBarLow(doc: Page, size: string) {
  const m = await doc.evaluate(() => {
    const box = (s: string) =>
      document.querySelector(s)!.getBoundingClientRect();
    const bar = document.querySelector(".top")!;
    return {
      band: innerHeight * 2 / 3,
      edge: innerWidth - parseFloat(getComputedStyle(bar).paddingRight),
      nav: box(".lang"),
      brand: box(".brand"),
      bar: box(".top"),
    };
  });
  assert(m.nav.top >= m.band, `${size}: languages at ${m.nav.top}`);
  assert(m.brand.top >= m.band, `${size}: the mark at ${m.brand.top}`);
  assert(
    Math.abs(m.nav.right - m.edge) <= 1,
    `${size}: languages end at the edge`,
  );
  assert(m.bar.height < 80, `${size}: one row, ${m.bar.height} px`);
}

Deno.test({
  name:
    "e2e - About opens the privacy notice and the methodology, and downloads the source",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ locale: "en-GB" });
      const page = await context.newPage();

      // Before any account: "Methodology" on the sign-in screen
      await page.goto(server.url);
      const [first] = await Promise.all([
        context.waitForEvent("page"),
        page.getByRole("link", { name: "Methodology", exact: true }).click(),
      ]);
      await first.waitForLoadState();
      assertEquals(new URL(first.url()).pathname, "/methodology");
      assertEquals(new URL(first.url()).hash, "#en");
      await first.getByRole("heading", {
        name: "Why Emo asks what it asks",
        level: 1,
      }).waitFor();
      await first.close();

      await signUp(page, server);
      assert(
        await page.evaluate(() => !!navigator.serviceWorker.controller),
        "the service worker controls the app",
      );
      await page.getByRole("button", { name: "Settings", exact: true }).click();

      // The notice: a new tab, through the service worker, English shown
      const [notice] = await Promise.all([
        context.waitForEvent("page"),
        page.getByRole("link", { name: "Operator's privacy notice" }).click(),
      ]);
      await notice.waitForLoadState();
      assertEquals(new URL(notice.url()).pathname, "/privacy.html");
      assertEquals(new URL(notice.url()).hash, "#en");
      await notice.getByRole("heading", { name: "Privacy notice", level: 1 })
        .waitFor();
      assertEquals(await notice.locator("#ru").isVisible(), false);
      assertEquals(await notice.getByRole("button").count(), 0); // not the app
      assertEquals(await auditA11y(notice), []);
      await notice.close();

      // The methodology: a new tab, in the app's language, English only
      const [guide] = await Promise.all([
        context.waitForEvent("page"),
        page.getByRole("link", { name: "Read methodology guide" }).click(),
      ]);
      await guide.waitForLoadState();
      assertEquals(new URL(guide.url()).pathname, "/methodology");
      assertEquals(new URL(guide.url()).hash, "#en");
      await guide.getByRole("heading", {
        name: "Why Emo asks what it asks",
        level: 1,
      }).waitFor();
      assertEquals(await guide.locator("#ru").isVisible(), false);
      assertEquals(await guide.getByRole("button").count(), 0); // not the app
      await guide.close();

      // In a tab of its own: no CSP report; accessible light and dark, wide
      // and narrow; a contents row keeps its language; no address → English;
      // Russian fits 320 px; on a phone the bar is low, "Contents ↑" at the
      // right edge
      const doc = await context.newPage();
      const csp = await watchCsp(doc);
      await doc.goto(`${server.url}/methodology#en`);
      for (const colorScheme of ["light", "dark"] as const) {
        for (const width of [1280, 390]) {
          await doc.emulateMedia({ colorScheme });
          await doc.setViewportSize({ width, height: 900 });
          assertEquals(await auditA11y(doc), [], `${colorScheme}, ${width} px`);
        }
      }
      await doc.setViewportSize({ width: 1280, height: 900 });
      assert(
        (await doc.locator(".top").boundingBox())!.y < 100,
        "1280 px: the header stays at the top",
      );
      await doc.setViewportSize({ width: 390, height: 844 });
      await assertBarLow(doc, "390×844");
      await doc.getByRole("navigation", { name: "Contents" })
        .getByRole("link", { name: /Notes for analysis/ }).click();
      await doc.waitForURL(/#en-s5$/);
      assertEquals(await doc.locator("#en").isVisible(), true);
      assertEquals(await doc.locator("#uk").isVisible(), false);
      const back = await doc.locator("#en-s5 > .back").evaluate((el) => {
        const part = getComputedStyle(el.parentElement!);
        return el.getBoundingClientRect().right -
          (el.parentElement!.getBoundingClientRect().right -
            parseFloat(part.paddingRight) - parseFloat(part.borderRightWidth));
      });
      assert(Math.abs(back) <= 1, `"Contents ↑" ${back} px from the edge`);
      await doc.goto(`${server.url}/methodology`);
      assertEquals(await doc.locator("#en").isVisible(), true);
      assertEquals(await doc.locator("#ru").isVisible(), false);
      await doc.setViewportSize({ width: 320, height: 640 });
      await doc.goto(`${server.url}/methodology#ru`);
      assertEquals(await doc.locator("#ru").isVisible(), true);
      assertEquals(await doc.locator("#en").isVisible(), false);
      await assertBarLow(doc, "320×640");
      assertEquals(
        await doc.evaluate(() =>
          document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        ),
        true,
        "no sideways scroll at 320 px",
      );
      assertEquals(await csp(), []);

      // The mark goes to the app
      await doc.getByRole("link", { name: "Emo", exact: true }).click();
      await doc.waitForURL(`${server.url}/`);
      await doc.getByRole("button", { name: NOW }).waitFor();
      await doc.close();

      // Offline: the precached page, under its short address
      await context.setOffline(true);
      const offline = await context.newPage();
      await offline.goto(`${server.url}/methodology#uk`);
      await offline.getByRole("heading", {
        name: "Чому Emo питає саме це",
        level: 1,
      }).waitFor();
      await offline.close();
      await context.setOffline(false);

      // The source: this build's archive, as a download
      const href = await page.getByRole("link", { name: "View the source" })
        .getAttribute("href");
      assertEquals(href, `${server.url}/source.tar.gz`);
      const tab = await context.newPage();
      const [download] = await Promise.all([
        tab.waitForEvent("download"),
        tab.goto(href!).catch(() => {}), // a download ends the navigation
      ]);
      assertEquals(download.suggestedFilename(), "emo-0.1.0-source.tar.gz");
      const bytes = await Deno.readFile((await download.path())!);
      assertEquals([bytes[0], bytes[1]], [0x1f, 0x8b]); // gzip
      assert(bytes.length > 100_000, String(bytes.length));
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
