// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Now's bead (ui.md §3, client/src/lib/bead.ts): the core
 * follows a cursor anywhere on the page, centred when it is over Now; a drag
 * carries the core and never opens the check-in, and it follows the cursor
 * again on release; a tap still opens it; a tilt rolls the core toward the
 * low side and a held tilt settles back. Motion on: under reduced motion the
 * bead is still and a press is a press (the other suites).
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { launchBrowser, NOW, signUp, startServer } from "./harness.ts";

/** The core's centre, two frames after now */
function core(page: Page) {
  return page.evaluate(async () => {
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    const r = document.querySelector("button.now .core")!
      .getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

/** A sensor stream: `deviceorientation` at 30 Hz for `ms` */
function tilt(page: Page, beta: number, gamma: number, ms: number) {
  return page.evaluate(async ([beta, gamma, ms]) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      dispatchEvent(
        new DeviceOrientationEvent("deviceorientation", {
          alpha: 0,
          beta,
          gamma,
        }),
      );
      await new Promise((r) => setTimeout(r, 33));
    }
  }, [beta, gamma, ms] as const);
}

Deno.test({
  name:
    "e2e - Now: the bead follows the cursor; a drag carries it and opens nothing; a tap opens the check-in; a tilt rolls it and settles",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
        reducedMotion: "no-preference",
      })).newPage();
      await signUp(page, server);
      const now = page.getByRole("button", { name: NOW, exact: true });
      const b = (await now.boundingBox())!;
      const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
      const at = async (x: number, y: number) => {
        await page.mouse.move(x, y, { steps: 4 });
        await page.waitForTimeout(1000);
        return await core(page);
      };

      // The cursor: left, right and above Now take the core that way; over
      // Now's centre the core is centred
      const show = (c: { x: number; y: number }) => JSON.stringify(c);
      const left = await at(5, cy);
      assert(left.x < cx - 15 && Math.abs(left.y - cy) < 4, show(left));
      const right = await at(385, cy);
      assert(right.x > cx + 15 && Math.abs(right.y - cy) < 4, show(right));
      const above = await at(cx, 60);
      assert(above.y < cy - 15 && Math.abs(above.x - cx) < 4, show(above));
      const over = await at(cx, cy);
      assert(Math.hypot(over.x - cx, over.y - cy) < 1.5, show(over));

      const rest = await at(5, 300);

      // Carried up and to the right from the centre, then let go: still
      // Home, following the cursor again
      await page.mouse.move(cx, cy);
      await page.waitForTimeout(700);
      await page.mouse.down();
      await page.mouse.move(cx + 20, cy - 40, { steps: 6 });
      await page.waitForTimeout(500);
      const held = await core(page);
      assert(
        cy - held.y > 25 && held.x - cx > 10,
        `carried from the centre to ${show(held)}`,
      );
      await page.mouse.up();
      await page.mouse.move(5, 300);
      await page.waitForTimeout(1500);
      assertEquals(new URL(page.url()).pathname, "/");
      const back = await core(page);
      assert(
        Math.hypot(back.x - rest.x, back.y - rest.y) < 1,
        `settled at ${JSON.stringify(back)}, rest ${JSON.stringify(rest)}`,
      );

      // A tilt to the right rolls the core right; held, it settles back
      await tilt(page, 40, 0, 300);
      await tilt(page, 40, 16, 600);
      const rolled = await core(page);
      assert(rolled.x - rest.x > 8, `rolled to ${JSON.stringify(rolled)}`);
      await tilt(page, 40, 16, 7000);
      const level = await core(page);
      assert(
        Math.hypot(level.x - rest.x, level.y - rest.y) < 1.5,
        `levelled at ${JSON.stringify(level)}, rest ${JSON.stringify(rest)}`,
      );

      // A tap is a tap
      await now.click();
      await page.getByText(/^Step 1 of/).waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
