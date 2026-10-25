// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §2.2–§3, §9: one pane switcher, drawn once by App,
 * that never moves between Home, History and Settings — on a desktop the
 * tabs flush right against the 680 px column at the top (sticky), on a phone
 * the dots in a fixed row at the bottom centre — in every language, while
 * scrolling, offline (24 px lower) and signed out.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { launchBrowser, NOW, signUp, startServer } from "./harness.ts";

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 375, height: 667 },
];
const PANES = ["/", "/history", "/settings"];

type Rect = { top: number; right: number; bottom: number; left: number };

/** The switcher on screen: the tabs on a desktop, the dots on a phone */
function switcher(page: Page): Promise<Rect> {
  return page.evaluate(() => {
    const desktop = innerWidth >= 900;
    const el = document.querySelector(desktop ? "nav.tabs" : "nav.dots")!;
    const r = el.getBoundingClientRect();
    return { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
  });
}

/** Opens a pane by its route and waits for its heading (Home: Now) */
async function open(page: Page, url: string, path: string) {
  await page.goto(url + path);
  await page.locator(
    path === "/"
      ? "button.now"
      : path === "/history"
      ? "#history-title"
      : "h1.settings-title",
  ).waitFor();
  await page.waitForTimeout(100);
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const same = (a: Rect, b: Rect) =>
  near(a.top, b.top) && near(a.right, b.right) && near(a.bottom, b.bottom) &&
  near(a.left, b.left);

Deno.test({
  name: "e2e - the pane switcher never moves between panes, sizes, languages",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    try {
      const context = await browser.newContext({
        locale: "en-GB",
        viewport: SIZES[0],
      });
      const page = await context.newPage();
      await signUp(page, server);

      for (const language of ["English", "Русский", "Українська"]) {
        await open(page, server.url, "/settings");
        await page.getByRole("radio", { name: language }).click();
        await page.waitForTimeout(300);
        for (const size of SIZES) {
          await page.setViewportSize(size);
          const at = `${language} ${size.width}×${size.height}`;
          const rects: Rect[] = [];
          for (const path of PANES) {
            await open(page, server.url, path);
            rects.push(await switcher(page));
          }
          for (let i = 1; i < rects.length; i++) {
            if (!same(rects[0], rects[i])) {
              problems.push(
                `${at}: ${PANES[i]} ${JSON.stringify(rects[i])} vs / ${
                  JSON.stringify(rects[0])
                }`,
              );
            }
          }
          const r = rects[0];
          if (size.width >= 900) {
            // Flush right against the 680 px column, 12 px from the top
            if (
              !near(r.right, (size.width + 680) / 2 - 16) || !near(r.top, 12)
            ) {
              problems.push(`${at}: tabs at ${JSON.stringify(r)}`);
            }
            // Sticky: the same after scrolling Settings by 1000 px
            await page.evaluate(() => {
              document.body.scrollTo(0, 1000);
              document.documentElement.scrollTo(0, 1000);
            });
            await page.waitForTimeout(100);
            const scrolled = await switcher(page);
            if (!same(scrolled, r)) {
              problems.push(`${at}: scrolled ${JSON.stringify(scrolled)}`);
            }
          } else {
            // A fixed row 18 px above the bottom, centred, under either
            // thumb (ui.md §2.2, owner decision 2026-10-12)
            if (
              !near(r.bottom, size.height - 18) ||
              !near(r.left + r.right, size.width)
            ) {
              problems.push(`${at}: dots at ${JSON.stringify(r)}`);
            }
          }
        }
      }

      // Offline: exactly 24 px lower on every pane (the band's room)
      await page.setViewportSize(SIZES[0]);
      await open(page, server.url, "/settings");
      await page.getByRole("radio", { name: "English" }).click();
      await page.waitForTimeout(300);
      await open(page, server.url, "/");
      const online = await switcher(page);
      await context.setOffline(true);
      await page.getByRole("status").filter({ hasText: "You're offline" })
        .waitFor({ state: "attached" });
      for (const tab of ["History", "Settings", "Check-in"]) {
        await page.locator("nav.tabs").getByRole("button", { name: tab })
          .click();
        await page.waitForTimeout(300);
        const r = await switcher(page);
        if (!near(r.top, online.top + 24) || !near(r.right, online.right)) {
          problems.push(`offline ${tab}: ${JSON.stringify(r)}`);
        }
      }
      await context.setOffline(false);
      await page.getByRole("status").filter({ hasText: "You're offline" })
        .waitFor({ state: "detached" });

      // Signed out: "Not synced" grows in the left cluster, the tabs stay put
      await context.clearCookies();
      await open(page, server.url, "/"); // the session check says 401
      await page.getByText("Not synced", { exact: true }).waitFor();
      const signedOut = await switcher(page);
      if (!same(signedOut, online)) {
        problems.push(`signed out: ${JSON.stringify(signedOut)}`);
      }
      assert(await page.getByRole("button", { name: NOW }).isVisible());
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, []);
  },
});
