// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Light and motion never change the instrument (ui.md §5.1,
 * §1.4, §14.4): a null answer looks exactly like a regular one in
 * every state; every answer control wears the one shared class; an answer
 * tapped while a step is still arriving is taken; under reduced motion
 * nothing moves; and the ambient light is never behind a question.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  launchBrowser,
  nextStep,
  NOW,
  signUp,
  startServer,
} from "./harness.ts";

async function waitStep(page: Page, n: number) {
  await page.getByText(new RegExp(`^Step ${n} of \\d+$`)).waitFor();
}

/** What an answer looks like: everything but its shape and size */
const LOOK = [
  "background-color",
  "background-image",
  "border-top-color",
  "border-top-style",
  "border-top-width",
  "color",
  "font-weight",
  "box-shadow",
  "scale",
  "transform",
  "opacity",
  "outline-style",
  "outline-width",
  "outline-color",
  "outline-offset",
  "transition-property",
] as const;

/** Read two frames after the last change, once any transition has ended */
function look(page: Page, selector: string) {
  return page.evaluate(async ([selector, props]) => {
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    const el = document.querySelector(selector)!;
    const css = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, css.getPropertyValue(p)]));
  }, [selector, LOOK] as const);
}

/** Answer controls without the shared class (the figure's zones aside) */
function bare(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".flow [aria-pressed]")]
      .filter((el) =>
        !el.classList.contains("hit") && !el.classList.contains("answer")
      )
      .map((el) => el.outerHTML.slice(0, 100))
  );
}

Deno.test({
  name:
    "e2e - fx: a null answer looks like any other at rest, hovered, focused and selected; every answer is `.answer`",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
      })).newPage();
      await signUp(page, server);
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      assertEquals(await bare(page), [], "step 1");
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      assertEquals(await bare(page), [], "step 2");

      const regular = ".grid .answer";
      const nul = '[data-null="nothing"]';
      const away = () => page.mouse.move(1, 1);
      // At rest
      await away();
      assertEquals(await look(page, nul), await look(page, regular), "at rest");
      // Hovered (a fine pointer)
      await page.hover(regular);
      const hovered = await look(page, regular);
      await page.hover(nul);
      assertEquals(await look(page, nul), hovered, "hovered");
      await away();
      // Focused from the keyboard
      await page.keyboard.press("Shift");
      await page.locator(regular).first().focus();
      assert(
        await page.locator(regular).first().evaluate((el) =>
          el.matches(":focus-visible")
        ),
      );
      const focused = await look(page, regular);
      await page.locator(nul).focus();
      assertEquals(await look(page, nul), focused, "focused");
      await page.locator("h1").focus();
      // Selected ("nothing" is exclusive: one, then the other)
      await page.locator(regular).first().click();
      await away();
      await page.locator("h1").focus();
      const selected = await look(page, `${regular}.on`);
      await page.locator(nul).click();
      await away();
      await page.locator("h1").focus();
      assertEquals(await page.locator(`${regular}.on`).count(), 0);
      assertEquals(await look(page, `${nul}.on`), selected, "selected");

      // Every answer control of every step, the revealed ones included
      for (let n = 3; n <= 9; n++) {
        await nextStep(page);
        await waitStep(page, n);
        if (n === 6) {
          // A word: its certainty and finer words appear
          await page.locator(".grid .answer").first().click();
          await page.locator(".certainty .answer").first().waitFor();
          assertEquals(await bare(page), [], "step 6 revealed");
          await page.locator(".certainty .answer").first().click();
        }
        if (n === 9) {
          await page.getByRole("button", { name: "work", exact: true }).click();
        }
        assertEquals(await bare(page), [], `step ${n}`);
      }
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - fx: with motion on, a step arrives without blocking a tap; the light is never behind a question",
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
      // Calm has an ambient light: it comes on, on Home
      await page.locator(".aura").waitFor({
        state: "attached",
        timeout: 10_000,
      });

      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      // The form open: no light, nothing of it moving
      assertEquals(await page.locator(".aura").count(), 0);
      const auraAnimations = () =>
        page.evaluate(() =>
          document.getAnimations().filter((a) =>
            ((a.effect as KeyframeEffect | null)?.target as Element | null)
              ?.closest?.(".aura")
          ).length
        );
      assertEquals(await auraAnimations(), 0);

      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      // ~20 ms into step 2's arrival, its first option is taken by a tap
      await page.waitForTimeout(20);
      const arriving = await page.evaluate(() =>
        document.getAnimations()
          .filter((a) => a.id === "arrive" && a.playState === "running")
          .map((a) =>
            (a.effect as KeyframeEffect).getKeyframes().flatMap((k) =>
              Object.keys(k)
            )
          )
      );
      assert(arriving.length > 0, "the step is arriving");
      // Transform only: text in the check-in never fades
      for (const keys of arriving) {
        assertEquals(keys.includes("opacity"), false);
      }
      const box = (await page.locator(".grid .answer").first().boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assertEquals(
        await page.locator(".grid .answer").first().getAttribute(
          "aria-pressed",
        ),
        "true",
      );
      await waitStep(page, 2);
      assertEquals(await page.locator(".aura").count(), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name: "e2e - fx: under reduced motion nothing moves, a step change included",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      })).newPage();
      await signUp(page, server);
      // The ambient light is a still picture
      await page.locator(".aura").waitFor({
        state: "attached",
        timeout: 10_000,
      });
      await page.waitForTimeout(200);
      assertEquals(
        await page.evaluate(() =>
          document.getAnimations().map((a) => a.id || "css")
        ),
        [],
        "Home",
      );
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      await page.waitForTimeout(50);
      assertEquals(
        await page.evaluate(() =>
          document.getAnimations().map((a) => a.id || "css")
        ),
        [],
        "after a step change",
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
