// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The measurement slider under a finger (ui.md §6.2, §14.4,
 * client/src/lib/press.ts), with touches sent the way a phone sends them
 * (CDP `Input.dispatchTouchEvent`, so the browser's own scroll and tap
 * handling runs): a scroll or a pull that starts on an untouched slider
 * leaves it untouched and Next waiting, wherever on the track it starts; a
 * still tap on the thumb answers the midpoint, a still tap elsewhere on the
 * track the value under the finger, and a slide along it what it slid to.
 * A mouse press where the thumb is (`pressSlider`) still answers the
 * midpoint.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  launchBrowser,
  nextStep,
  NOW,
  pressSlider,
  signUp,
  startServer,
} from "./harness.ts";

/** Half the thumb (32 px): its centre travels the range's width less 32 */
const THUMB_HALF = 16;

/**
 * One finger through `points` (viewport CSS px) and lifted, a move every
 * 16 ms; a single point is a still tap
 */
async function touch(page: Page, points: Array<[number, number]>) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const [[x0, y0], ...rest] = points;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: x0, y: y0 }],
    });
    for (const [x, y] of rest) {
      await page.waitForTimeout(16);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
  }
}

/** A straight drag of `steps` moves from (x, y) by (dx, dy) */
function drag(
  x: number,
  y: number,
  dx: number,
  dy: number,
  steps = 10,
): Array<[number, number]> {
  return Array.from(
    { length: steps + 1 },
    (_, i) => [x + (dx * i) / steps, y + (dy * i) / steps] as [number, number],
  );
}

/**
 * The step's range on screen: its box, its vertical centre, and x of the
 * thumb's centre at a share of the track (0 = min, 0.5 = the midpoint)
 */
async function track(page: Page) {
  const range = page.locator("main input[type=range]");
  await range.scrollIntoViewIfNeeded();
  const box = (await range.boundingBox())!;
  return {
    y: box.y + box.height / 2,
    at: (share: number) =>
      box.x + THUMB_HALF + share * (box.width - 2 * THUMB_HALF),
  };
}

/** The range's value, whether it is untouched, and whether Next waits */
async function state(page: Page) {
  // Past a fling and the browser's late tap events
  await page.waitForTimeout(400);
  return {
    value: await page.locator("main input[type=range]").inputValue(),
    untouched: await page.locator("main .slider.untouched").count() === 1,
    nextDisabled: await page.locator("button.next").isDisabled(),
  };
}

async function waitStep(page: Page, n: number) {
  await page.getByText(new RegExp(`^Step ${n} of \\d+$`)).waitFor();
}

Deno.test({
  name:
    "e2e - slider under a finger: a scroll or pull never answers; a still tap answers where it lands; a slide answers",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      })).newPage();
      await signUp(page, server);
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      await page.locator('[data-null="nothing"]').click();
      await nextStep(page);
      await waitStep(page, 3);
      await page.waitForTimeout(400);
      const untouched = { value: "5", untouched: true, nextDisabled: true };
      assertEquals(await state(page), untouched);
      // Vertical drags belong to the page; along the track, to the range
      assertEquals(
        await page.locator("main input[type=range]").evaluate((el) =>
          getComputedStyle(el).touchAction
        ),
        "pan-y pinch-zoom",
      );

      // Step 3: a scroll up that starts on the thumb, then a pull down that
      // starts far from it (where Chromium moves the thumb to the finger at
      // once): neither answers, the thumb stays at the midpoint
      let t = await track(page);
      await touch(page, drag(t.at(0.5), t.y, 0, -150));
      assertEquals(await state(page), untouched, "scroll from the thumb");
      t = await track(page);
      await touch(page, drag(t.at(0.85), t.y, 0, 120));
      assertEquals(await state(page), untouched, "pull from the track");
      // A slow scroll, slightly slanted
      t = await track(page);
      await touch(page, drag(t.at(0.2), t.y, 8, -60, 20));
      assertEquals(await state(page), untouched, "slanted scroll");

      // A still tap on the thumb answers the midpoint, as the hint asks
      t = await track(page);
      await touch(page, [[t.at(0.5), t.y]]);
      assertEquals(await state(page), {
        value: "5",
        untouched: false,
        nextDisabled: false,
      });

      // Step 4 (−3…3): a still tap at the right end answers its pole
      await nextStep(page);
      await waitStep(page, 4);
      await page.waitForTimeout(400);
      assertEquals(await state(page), {
        value: "0",
        untouched: true,
        nextDisabled: true,
      });
      t = await track(page);
      await touch(page, [[t.at(1), t.y]]);
      assertEquals(await state(page), {
        value: "3",
        untouched: false,
        nextDisabled: false,
      });

      // Step 5: a slide from the thumb, 100 px to the right, answers what it
      // slid to
      await nextStep(page);
      await waitStep(page, 5);
      await page.waitForTimeout(400);
      t = await track(page);
      await touch(page, drag(t.at(0.5), t.y, 100, 0));
      const slid = await state(page);
      assert(
        !slid.untouched && !slid.nextDisabled && Number(slid.value) > 5,
        JSON.stringify(slid),
      );

      // Step 8 by the mouse: a press where the thumb is answers the midpoint
      // (what the other e2e tests' nextStep does on every slider)
      for (let n = 6; n <= 8; n++) {
        await nextStep(page);
        await waitStep(page, n);
      }
      await page.waitForTimeout(400);
      await pressSlider(page);
      assertEquals(await state(page), {
        value: "5",
        untouched: false,
        nextDisabled: false,
      });
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
