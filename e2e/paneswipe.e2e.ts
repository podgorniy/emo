// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The pane swipe under a finger (ui.md §5.3, lib/swipe.ts
 * `paneSwipe`), with touches sent the way a phone sends them (CDP
 * `Input.dispatchTouchEvent`, so the browser's own scroll handling runs). A
 * 100 px swipe to the left on Home opens the next pane, as before. A 40 px
 * drag follows the finger at 0.6, springs back to rest and stays on Home. A
 * drag toward no pane (to the right on Home) follows at 0.2 at most and
 * changes nothing. An up-and-down drag on History scrolls it and moves
 * nothing sideways. A drag that starts in a field does nothing. A mouse never
 * swipes. Under reduced motion nothing follows the finger, and a swipe still
 * steps.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  launchBrowser,
  NOW,
  seedCheckIns,
  settingsTitle,
  signUp,
  startServer,
} from "./harness.ts";

const PHONE = { width: 390, height: 844 };

/**
 * Where the pane's content sits: its largest sideways offset (px), and
 * whether every part of it is at rest (no transform at all)
 */
type PaneAt = { x: number; rest: boolean };
const REST: PaneAt = { x: 0, rest: true };

function paneAt(page: Page): Promise<PaneAt> {
  return page.evaluate(async () => {
    // Touch moves are dispatched with the next frame: read after it
    await new Promise((r) => requestAnimationFrame(r));
    let x = 0;
    let rest = true;
    for (const el of document.querySelectorAll("[data-pane] > *")) {
      const transform = getComputedStyle(el).transform;
      if (transform === "none") continue;
      rest = false;
      const m41 = new DOMMatrix(transform).m41;
      if (Math.abs(m41) > Math.abs(x)) x = m41;
    }
    return { x, rest };
  });
}

/**
 * One finger from (x, y) by (dx, dy) in `steps` moves, a move every 16 ms,
 * then lifted; `during` runs after each move, the finger still down
 */
async function touchDrag(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  during?: () => Promise<void>,
  steps = 10,
) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(16);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }],
      });
      await during?.();
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
  }
}

/**
 * A y on the pane's own content between `min` and `max` (viewport px): not
 * the reach room above it (lib/reach.ts), which is no pane's, nor the dots
 */
function paneY(page: Page, min = 120, max = PHONE.height - 120) {
  return page.evaluate(([min, max]) => {
    const parts = document.querySelectorAll("[data-pane] :is(h1, h2, h3, p)");
    for (const el of parts) {
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      if (r.height > 0 && y >= min && y <= max) return y;
    }
    throw new Error(`no pane content between ${min} and ${max}`);
  }, [min, max]);
}

/** The page scrolled back to its top (the body is the scroller) */
async function toTop(page: Page) {
  await page.evaluate(() => {
    document.body.scrollTo(0, 0);
    document.documentElement.scrollTo(0, 0);
  });
  await page.waitForTimeout(100);
}

Deno.test({
  name:
    "e2e - phone: a pane follows a sideways finger and springs back; a swipe still steps; scrolls, fields and a mouse are left alone",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: PHONE,
        hasTouch: true,
        isMobile: true,
      })).newPage();
      await signUp(page, server);
      // Enough check-ins for History to scroll
      const specs = [];
      for (let d = 1; d <= 5; d++) {
        for (const at of ["20:00", "15:00", "11:00", "08:00"]) {
          specs.push({ daysAgo: d, at });
        }
      }
      await seedCheckIns(page, specs);
      // The drag feedback is motion: on from here (the harness's contexts
      // start reduced)
      await page.emulateMedia({ reducedMotion: "no-preference" });

      const now = page.getByRole("button", { name: NOW, exact: true });
      const historyTitle = page.locator("#history-title");
      const path = () => new URL(page.url()).pathname;
      const seen: PaneAt[] = [];
      const sample = async () => {
        seen.push(await paneAt(page));
      };
      const show = () => JSON.stringify(seen);

      await now.waitFor();
      await page.waitForTimeout(500);
      const box = (await now.boundingBox())!;
      // A row through Now's centre: right of the 208 px circle, or left of it
      const y = box.y + box.height / 2;

      // 40 px to the left, toward History: the pane follows at 0.6, then
      // springs back to rest, and Home stays
      await touchDrag(page, 330, y, -40, 0, sample);
      assert(Math.abs(seen.at(-1)!.x + 0.6 * 40) <= 1, `0.6: ${show()}`);
      await page.waitForTimeout(500);
      assertEquals(await paneAt(page), REST, "back to rest");
      assertEquals(path(), "/");
      assertEquals(await historyTitle.count(), 0);
      await now.waitFor();

      // 120 px to the right, toward no pane: the rubber band, at most 0.2
      // of the drag while it moves; then rest, and nothing changes
      seen.length = 0;
      await touchDrag(page, 60, y, 120, 0, sample);
      assert(
        seen.every((s) => s.x >= 0 && s.x <= 0.2 * 120 + 0.5),
        `0.2 at most: ${show()}`,
      );
      assert(seen.at(-1)!.x >= 0.2 * 120 - 1, `it follows: ${show()}`);
      await page.waitForTimeout(500);
      assertEquals(await paneAt(page), REST, "back to rest");
      assertEquals(path(), "/");
      await now.waitFor();

      // 100 px to the left: the next pane, as before
      await touchDrag(page, 330, y, -100, 0);
      await historyTitle.waitFor();
      assertEquals(path(), "/history");
      await page.locator("main h3").first().waitFor();
      await page.waitForTimeout(500);

      // Up on History: the list scrolls; nothing moves sideways. The hint
      // scrolls with it (the title stays, a sticky head)
      const hint = page.locator("[data-pane] .settings-hint");
      const before = (await hint.boundingBox())!.y;
      seen.length = 0;
      await touchDrag(page, 200, await paneY(page, 450), 0, -300, sample);
      await page.waitForTimeout(500);
      assert(seen.every((s) => s.rest), `no transform: ${show()}`);
      const after = (await hint.boundingBox())!.y;
      assert(after < before - 100, `scrolled: ${before} → ${after}`);
      assertEquals(await paneAt(page), REST);
      assertEquals(path(), "/history");

      // 100 px to the left on History: Settings
      await touchDrag(page, 330, await paneY(page), -100, 0);
      await settingsTitle(page).waitFor();
      assertEquals(path(), "/settings");
      await page.waitForTimeout(500);

      // A drag that starts in a field (Reminders' window) does nothing, not
      // even the way a swipe would step (to the right: History)
      await page.waitForFunction(() => {
        const el = document.querySelector<HTMLInputElement>(
          "#reminders input[type=time]",
        );
        return el !== null && !el.disabled;
      });
      const field = page.locator("#reminders input[type=time]").first();
      await field.scrollIntoViewIfNeeded();
      const f = (await field.boundingBox())!;
      const fx = f.x + f.width / 2;
      const reach = Math.min(100, PHONE.width - 10 - fx);
      assert(reach >= 70, `room to drag from the field at x ${fx}`);
      seen.length = 0;
      await touchDrag(page, fx, f.y + f.height / 2, reach, 0, sample);
      await page.waitForTimeout(500);
      assert(seen.every((s) => s.rest), `no transform: ${show()}`);
      assertEquals(path(), "/settings");
      assertEquals(await historyTitle.count(), 0);

      // The same drag from Settings' title does step, so the one above was
      // stopped by the field
      await toTop(page);
      const title = (await settingsTitle(page).boundingBox())!;
      await touchDrag(
        page,
        title.x + title.width / 2,
        title.y + title.height / 2,
        100,
        0,
      );
      await historyTitle.waitFor();
      assertEquals(path(), "/history");
      await page.waitForTimeout(500);

      // A mouse never swipes: nothing follows it, nothing steps
      await toTop(page);
      const h = (await historyTitle.boundingBox())!;
      await page.mouse.move(100, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(220, h.y + h.height / 2, { steps: 10 });
      const mid = await paneAt(page);
      await page.mouse.up();
      await page.waitForTimeout(500);
      assertEquals(mid, REST, "a mouse drag");
      assertEquals(path(), "/history");

      // Reduced motion: nothing follows the finger; a swipe still steps
      await page.emulateMedia({ reducedMotion: "reduce" });
      seen.length = 0;
      const ry = await paneY(page);
      await touchDrag(page, 330, ry, -40, 0, sample);
      await page.waitForTimeout(400);
      assert(seen.every((s) => s.rest), `reduced motion: ${show()}`);
      assertEquals(path(), "/history");
      await touchDrag(page, 330, ry, -100, 0);
      await settingsTitle(page).waitFor();
      assertEquals(path(), "/settings");
      assertEquals(await paneAt(page), REST);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - phone: a swipe that starts on Now opens History; a short or up-and-down drag on Now only moves the bead",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: PHONE,
        hasTouch: true,
        isMobile: true,
      })).newPage();
      await signUp(page, server);
      await page.emulateMedia({ reducedMotion: "no-preference" });

      const now = page.getByRole("button", { name: NOW, exact: true });
      const path = () => new URL(page.url()).pathname;
      const checkIn = page.getByText(/^Step \d+ of \d+$/);
      await now.waitFor();
      await page.waitForTimeout(500);
      const box = (await now.boundingBox())!;
      // Now sits low and centred, where a thumb swipes
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;

      // A short sideways drag on Now: the bead follows, the pane springs
      // back, and the drag opens no check-in
      await touchDrag(page, x, y, -40, 0);
      await page.waitForTimeout(500);
      assertEquals(await paneAt(page), REST, "back to rest");
      assertEquals(path(), "/");
      assertEquals(await checkIn.count(), 0, "a drag is not a tap");

      // Up and down on Now: the bead only
      await touchDrag(page, x, y, 0, -100);
      await page.waitForTimeout(500);
      assertEquals(await paneAt(page), REST, "nothing sideways");
      assertEquals(path(), "/");
      assertEquals(await checkIn.count(), 0, "a drag is not a tap");

      // 100 px to the left from Now's centre: History
      await touchDrag(page, x, y, -100, 0);
      await page.locator("#history-title").waitFor();
      assertEquals(path(), "/history");
      assertEquals(await checkIn.count(), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
