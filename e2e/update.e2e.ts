// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The update card (ui.md §3, reliability.md §3) with the
 * waiting service worker mocked: the same place under the pane bar on every
 * pane and size, never in the check-in, never over the Undo toast; Later for
 * 24 h; "Update needed to sync" on a 426, without Later; Restart posts one
 * SKIP_WAITING and notices a restart that did not take; focus never moves
 * and the state is announced once; tokens, axe and 44 px in every theme;
 * reduced motion is instant; hidden while another tab has the form open.
 */
import { assert, assertEquals } from "@std/assert";
import type { BrowserContext, Page } from "playwright-core";
import {
  auditA11y,
  launchBrowser,
  NOW,
  openAppearance,
  signUp,
  startServer,
} from "./harness.ts";

/**
 * A registration whose new version waits, and a controller: what the page
 * sees when a deploy has been downloaded. Messages to it are recorded.
 */
async function mockWaitingWorker(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = globalThis as unknown as {
      __posted: unknown[];
      __announced: string[];
    };
    w.__posted = [];
    w.__announced = [];
    if (!("serviceWorker" in navigator)) return;
    const waiting = {
      scriptURL: `${location.origin}/sw.js?next`,
      state: "installed",
      postMessage: (m: unknown) => w.__posted.push(m),
      addEventListener() {},
    };
    const registration = {
      waiting,
      installing: null,
      active: {},
      update: () => Promise.resolve(),
      addEventListener() {},
    };
    Object.defineProperty(navigator.serviceWorker, "controller", {
      get: () => ({}),
      configurable: true,
    });
    navigator.serviceWorker.register = () =>
      Promise.resolve(registration as unknown as ServiceWorkerRegistration);
    // Every text the card's live region announces
    new MutationObserver(() => {
      const live = document.querySelector<HTMLElement>(
        ".update-live[aria-live]",
      );
      const text = live?.textContent?.trim();
      if (text && w.__announced.at(-1) !== text) w.__announced.push(text);
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

const card = (page: Page) => page.locator("section.card");

async function rectOf(page: Page) {
  return await page.evaluate(() => {
    const c = document.querySelector("section.card")!.getBoundingClientRect();
    const bar = document.querySelector(".panebar .row")!
      .getBoundingClientRect();
    return {
      top: c.top,
      left: c.left,
      right: c.right,
      bottom: c.bottom,
      bar: bar.bottom,
    };
  });
}

Deno.test({
  name: "e2e - update card: place, Later, needed, Restart, focus, themes, lock",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    try {
      const context = await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
      });
      await mockWaitingWorker(context);
      const page = await context.newPage();
      await signUp(page, server);
      await card(page).getByText("A new version of Emo is ready").waitFor();

      // 1. The same place on every pane, 8 px under the pane bar's row
      for (
        const size of [
          { width: 375, height: 667 },
          { width: 390, height: 844 },
          { width: 1280, height: 800 },
        ]
      ) {
        await page.setViewportSize(size);
        const rects = [];
        for (const path of ["/", "/history", "/settings"]) {
          await page.goto(server.url + path);
          await card(page).waitFor();
          rects.push(await rectOf(page));
        }
        for (const r of rects) {
          for (const k of ["top", "left", "right"] as const) {
            if (Math.abs(r[k] - rects[0][k]) > 1) {
              problems.push(`${size.width}: ${k} ${r[k]} vs ${rects[0][k]}`);
            }
          }
          if (Math.abs(r.top - (r.bar + 8)) > 1) {
            problems.push(`${size.width}: top ${r.top}, bar ${r.bar}`);
          }
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });

      // 5. Focus never moves; the state was announced once
      await page.goto(server.url);
      await card(page).waitFor();
      await page.waitForTimeout(300);
      assertEquals(
        await page.evaluate(() =>
          document.activeElement?.classList.contains("now")
        ),
        true,
        "focus stays on Now",
      );
      assertEquals(
        (await page.evaluate(() =>
          (globalThis as unknown as { __announced: string[] }).__announced
        )).length,
        1,
      );

      // 2. Never in the check-in or on Saved; never over the Undo toast
      await page.getByRole("button", { name: NOW, exact: true }).click();
      await page.getByText(/^Step 1 of/).waitFor();
      assertEquals(await card(page).count(), 0);
      await page.getByRole("button", { name: "Skip check-in" }).click();
      await page.getByRole("status", { name: /saved/i }).waitFor();
      assertEquals(await card(page).count(), 0);
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.locator(".toast-container").waitFor();
      await page.waitForTimeout(400);
      const toast = (await page.locator(".toast-container").boundingBox())!;
      const box = (await card(page).boundingBox())!;
      assert(
        toast.y >= box.y + box.height || toast.y + toast.height <= box.y,
        "card and toast intersect",
      );

      // 3. Later: gone, also after a reload; back after 24 h
      await card(page).getByRole("button", { name: "Later" }).click();
      await card(page).waitFor({ state: "detached" });
      await page.reload();
      await page.getByRole("button", { name: NOW, exact: true }).waitFor();
      await page.waitForTimeout(500);
      assertEquals(await card(page).count(), 0);
      await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("emo.updateLater")!);
        raw.at -= 24 * 60 * 60 * 1000 + 1000;
        localStorage.setItem("emo.updateLater", JSON.stringify(raw));
      });
      await page.reload();
      await card(page).getByText("A new version of Emo is ready").waitFor();

      // 4. Restart: disabled, "Restarting…", one SKIP_WAITING; the same
      // version still waiting after the fallback reload: "Couldn't restart"
      await card(page).getByRole("button", { name: "Restart now" }).click();
      await card(page).getByText("Restarting…").waitFor();
      assertEquals(
        await card(page).getByRole("button", { name: "Restarting…" })
          .isDisabled(),
        true,
      );
      await page.waitForTimeout(300);
      assertEquals(
        await page.evaluate(() =>
          (globalThis as unknown as { __posted: unknown[] }).__posted
        ),
        [{ type: "SKIP_WAITING" }],
      );
      await card(page).getByText("Couldn't restart. Try again.").waitFor({
        timeout: 15_000,
      });

      // 6. Every theme: axe and 44 px targets; reduced motion is instant
      await page.goto(`${server.url}/settings`);
      const themes = (await openAppearance(page)).getByRole("radio");
      for (let i = 0; i < await themes.count(); i++) {
        await openAppearance(page);
        await themes.nth(i).click();
        await page.goto(server.url);
        await card(page).waitFor();
        await page.waitForTimeout(400); // its 200 ms arrival
        // The card's own findings (#update-title, .update-*): Home's other
        // controls are audited by csp.e2e.ts
        for (const line of await auditA11y(page)) {
          if (/update-/.test(line)) problems.push(`theme ${i + 1}: ${line}`);
        }
        await page.goto(`${server.url}/settings`);
      }
      await openAppearance(page);
      await themes.first().click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(server.url);
      await card(page).waitFor();
      assertEquals(
        await card(page).evaluate((el) =>
          getComputedStyle(el).transitionDuration
        ),
        "0s",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });

      // 7. The form open in another tab hides "ready"…
      const tab = await context.newPage();
      await tab.goto(server.url);
      await tab.getByRole("button", { name: NOW, exact: true }).click();
      await tab.getByText(/^Step 1 of/).waitFor();
      await page.bringToFront();
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange"))
      );
      await card(page).waitFor({ state: "detached", timeout: 7000 });

      // …3, 7. while "Update needed to sync" (a 426) stays, without Later,
      // its button disabled until that check-in is closed
      await page.route("**/api/entries**", (route) =>
        route.fulfill({
          status: 426,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "upgrade_required",
              message: "upgrade",
              min_client: "9.0.0",
            },
          }),
        }));
      // A sync pass hears the 426 (no reload: it would reopen that draft)
      await page.getByRole("button", { name: /^Sync:/ }).click();
      await card(page).getByText("Update needed to sync").waitFor();
      assertEquals(
        await card(page).getByRole("button", { name: "Later" }).count(),
        0,
      );
      await card(page).getByText("Finish or close the open check-in first.")
        .waitFor({ timeout: 7000 });
      assertEquals(
        await card(page).getByRole("button", { name: "Restart and update" })
          .isDisabled(),
        true,
      );
      await tab.close();
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, []);
  },
});
