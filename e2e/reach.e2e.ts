// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §1.12, §4.5 (v1.9, owner decision 2026-10-10): on
 * a phone every action is under the thumb, near the bottom right corner, and
 * every control can be pulled into the bottom third of the screen. Each
 * scroller rests with its reach room out of view (the screen looks as it
 * did) and, pulled all the way down, shows its topmost control in the bottom
 * third; the main actions and the text actions end at the right edge.
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

const PHONES = [{ width: 390, height: 844 }, { width: 375, height: 667 }];

/**
 * The scroller `sel` pulled all the way down: where its topmost control's
 * top is then, as a share of the screen's height (and the resting place
 * restored). `control` picks the controls inside it.
 */
function pulled(page: Page, sel: string, control: string): Promise<number> {
  return page.evaluate(([sel, control]) => {
    const scroller = document.querySelector<HTMLElement>(sel)!;
    const rest = scroller.scrollTop;
    scroller.scrollTop = 0;
    const tops = [...scroller.querySelectorAll<HTMLElement>(control)]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.getBoundingClientRect().top);
    scroller.scrollTop = rest;
    return Math.min(...tops) / innerHeight;
  }, [sel, control]);
}

/** An element's box as shares of the screen: x of its right edge, y of its centre */
function place(page: Page, sel: string): Promise<{ right: number; y: number }> {
  return page.locator(sel).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      right: r.right / innerWidth,
      y: (r.top + r.height / 2) / innerHeight,
    };
  });
}

/** Its right edge, against the right edge of the content of the closest `box` */
function gapToRight(page: Page, sel: string, box: string): Promise<number> {
  return page.locator(sel).first().evaluate((el, box) => {
    const outer = el.parentElement!.closest(box)!;
    const edge = outer.getBoundingClientRect().right -
      parseFloat(getComputedStyle(outer).paddingRight);
    return Math.round(edge - el.getBoundingClientRect().right);
  }, box);
}

const CONTROLS = "button, a[href], input, textarea, [role=radio]";
/** "At the right edge": within the 4 px inset Settings gives its links */
const EDGE = 8;

for (const viewport of PHONES) {
  const size = `${viewport.width}×${viewport.height}`;
  Deno.test({
    name:
      `e2e - reach: every control can be pulled into the bottom third; actions at the bottom right (${size})`,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const server = await startServer();
      const browser = await launchBrowser();
      try {
        const page =
          await (await browser.newContext({ locale: "en-GB", viewport }))
            .newPage();
        await signUp(page, server, async (screen) => {
          // A sign-in card sits low; its links end at the right edge
          if (screen === "sign-in") {
            const card = await page.locator(".login-card").evaluate((el) =>
              el.getBoundingClientRect().bottom / innerHeight
            );
            assert(card > 0.85, `${size} sign-in card bottom at ${card}`);
            assertEquals(
              await gapToRight(page, ".about-link", ".login-card"),
              await gapToRight(page, "button[type=submit]", ".login-card"),
              `${size}: "About and privacy" ends where Send code does`,
            );
          }
        });

        // Home: Now low in the centre; the page rests with the room away and
        // pulls the wordmark into the bottom third
        const now = await place(page, "button.now");
        assert(
          Math.abs(now.right - (0.5 + 104 / viewport.width)) < 0.05 &&
            now.y > 0.5,
          `${size} Now at ${JSON.stringify(now)}`,
        );
        const wordmark = await page.locator(".panebar").evaluate((el) =>
          el.getBoundingClientRect().top
        );
        assert(
          wordmark >= 0 && wordmark < 30,
          `${size}: Home rests at its top (${wordmark})`,
        );
        const homeTop = await pulled(page, "body", CONTROLS);
        assert(
          homeTop >= 2 / 3,
          `${size}: Home pulled, top control at ${homeTop}`,
        );

        // The check-in: the ways out at the bottom right, the first answers
        // of step 2 pulled into the bottom third, the slider and urges low
        await page.getByRole("button", { name: NOW }).click();
        await page.getByText("Step 1 of 9").waitFor();
        const stop = await place(page, ".exits .link");
        const close = await place(page, ".exits .close");
        assert(
          stop.y > 0.8 && close.y > 0.8,
          `${size} exits at ${stop.y}, ${close.y}`,
        );
        assert(close.right > 0.9, `${size} × at the right (${close.right})`);
        for (
          const sel of ['[data-null="whole_body"]', '[data-null="nowhere"]']
        ) {
          const p = await place(page, sel);
          assert(p.y > 2 / 3, `${size} ${sel} in the bottom third (${p.y})`);
        }
        const tabs = await place(page, '[role="tablist"]');
        assert(
          Math.abs(tabs.right - (0.5 + 120 / viewport.width)) < 0.05,
          `${size}: Front/Back centered (${tabs.right})`,
        );
        await page.locator('[data-null="whole_body"]').click();
        await nextStep(page);
        await page.getByText("Step 2 of 9").waitFor();
        const title = await page.locator("main h1").evaluate((el) =>
          el.getBoundingClientRect().top -
          el.closest("main")!.getBoundingClientRect().top
        );
        assert(
          title >= 0 && title < 80,
          `${size}: step 2 rests at its title (${title})`,
        );
        const stepTop = await pulled(page, "main.body", CONTROLS);
        assert(
          stepTop >= 2 / 3,
          `${size}: step 2 pulled, first answer at ${stepTop}`,
        );
        await page.locator("main .grid button").first().click();
        for (let n = 3; n <= 7; n++) {
          await nextStep(page);
          await page.getByText(`Step ${n} of 9`).waitFor();
          if (n === 6) {
            await page.locator("main .grid button").last().click(); // don't know
          }
        }
        // The urges sit low with their question
        const urge = await page.locator("main .grid").evaluate((el) =>
          el.getBoundingClientRect().bottom / innerHeight
        );
        const footer = await page.locator("footer.foot").evaluate((el) =>
          el.getBoundingClientRect().top / innerHeight
        );
        assert(
          footer - urge < 0.08,
          `${size}: the urges end over the footer (${urge}, ${footer})`,
        );
        assert(
          (await gapToRight(page, ".help-link", ".page")) <= EDGE,
          `${size}: the help link ends at the right edge`,
        );
        await page.locator(".exits .link").click();
        await page.getByRole("button", { name: "Done" }).click();
        await page.getByRole("button", { name: NOW }).waitFor();

        // History: a record's Delete at the right edge; pulled, the first
        // row is in the bottom third
        await seedCheckIns(page, [{ daysAgo: 0, at: "09:10" }]);
        await page.getByRole("button", { name: "History", exact: true }).first()
          .click();
        await page.locator("#history-title").waitFor();
        assertEquals(
          await page.locator(".settings-back").count(),
          0,
          "no back chevron",
        );
        const historyTop = await pulled(page, "body", "main " + CONTROLS);
        assert(
          historyTop >= 2 / 3,
          `${size}: History pulled, first row at ${historyTop}`,
        );
        await page.locator("main h3").first().click();
        const del = page.getByRole("button", { name: "Delete this check-in" });
        await del.waitFor();
        assert(
          (await gapToRight(page, "button.delete", ".record")) <= EDGE,
          `${size}: Delete ends at the record's right edge`,
        );

        // Settings: its text actions end at the right; a sheet's first
        // field can be pulled into the bottom third, the sheet keeping its
        // height
        await page.getByRole("button", { name: "Settings", exact: true })
          .first().click();
        await page.locator(".settings-title").waitFor();
        for (const sel of [".sign-out", "button.delete"]) {
          assert(
            (await gapToRight(page, sel, ".settings-section")) <= EDGE,
            `${size}: ${sel} ends at the right edge`,
          );
        }
        await page.getByRole("button", { name: "Change passphrase" }).click();
        const sheet = page.getByRole("dialog");
        await sheet.waitFor();
        const tall = await sheet.evaluate((el) =>
          el.getBoundingClientRect().height
        );
        const field = await pulled(
          page,
          "[role=dialog] .body",
          "input:not([type=hidden])",
        );
        assert(
          field >= 2 / 3,
          `${size}: the sheet's first field pulled to ${field}`,
        );
        assertEquals(
          await sheet.evaluate((el) => el.getBoundingClientRect().height),
          tall,
          "the sheet keeps its height",
        );
      } finally {
        await browser.close();
        await server.stop();
      }
    },
  });
}

Deno.test({
  name: "e2e - reach: a desktop has no room and keeps its layout",
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
      assertEquals(
        await page.evaluate(() => [
          document.body.scrollTop,
          document.querySelector<HTMLElement>(".reach-room")!.offsetHeight,
        ]),
        [0, 0],
      );
      const now = await place(page, "button.now");
      assert(
        Math.abs(now.right - 0.58) < 0.05,
        `Now stays centred (${now.right})`,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
