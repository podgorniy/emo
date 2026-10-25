// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * development.md §5.3: zero CSP violations (and no uncaught page errors), and
 * no axe-core or 44 px target finding (ui.md §10), on
 * every screen of the compiled app: sign-in, onboarding, Home, all ten
 * check-in steps, Saved, "after an event", Settings with every theme and
 * language and every sheet, lock, unlock and the recovery-key screen, and
 * History (ui.md §15.19): empty, a check-in in progress, the
 * list, an open record and the delete sheet, in every theme, and at 320 px in
 * Russian and Ukrainian without sideways scrolling.
 */
import { assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  auditA11y,
  launchBrowser,
  nextStep,
  NOW,
  openAppearance,
  PASSPHRASE,
  pressSlider,
  settingsTitle,
  signUp,
  startServer,
  watchCsp,
} from "./harness.ts";

Deno.test({
  name: "e2e - no CSP violation or accessibility finding on any screen",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    const a11y: string[] = [];
    const visited: string[] = [];
    let page: Page | undefined;
    try {
      const context = await browser.newContext({ locale: "en-GB" });
      page = await context.newPage();
      const p = page;
      const drain = await watchCsp(p);
      const screen = async (name: string) => {
        await p.waitForTimeout(150); // let transitions and effects run
        // The desktop pane bar is sticky: whatever scrolled under it is
        // covered on purpose, so the audit looks at the page from its top
        await p.evaluate(() => {
          if (document.querySelector("[role=dialog]")) return;
          document.body.scrollTo(0, 0);
          document.documentElement.scrollTo(0, 0);
        });
        visited.push(name);
        for (const line of await drain()) problems.push(`${name}: ${line}`);
        for (const line of await auditA11y(p)) a11y.push(`${name}: ${line}`);
      };
      const button = (name: string | RegExp) =>
        p.getByRole("button", { name, exact: typeof name === "string" });
      const closeSheet = async () => {
        await p.keyboard.press("Escape");
        await p.getByRole("dialog").waitFor({ state: "detached" });
      };

      await signUp(p, server, screen);
      await screen("home");
      const history = async () => {
        await button("History").first().click();
        await p.getByRole("heading", { level: 1 }).waitFor();
        await p.waitForTimeout(200);
      };
      await history();
      await p.getByText("No check-ins yet").waitFor();
      await screen("history: empty");
      await p.keyboard.press("Escape"); // desktop: no chevron, Esc goes Home
      await button(NOW).waitFor();

      // Every check-in step, answering only where Next needs it
      await button(NOW).click();
      for (let n = 1; n <= 9; n++) {
        await p.getByText(`Step ${n} of 9`).waitFor();
        await screen(`check-in step ${n}`);
        const next = p.locator("button.next");
        await pressSlider(p);
        for (let tries = 0; await next.isDisabled() && tries < 3; tries++) {
          await p.locator('main [aria-pressed="false"]').first().click();
        }
        await nextStep(p);
      }
      await p.getByRole("status", { name: /saved/i }).waitFor();
      await screen("saved");
      await button(NOW).waitFor({ timeout: 15_000 });

      await button("after an event").click();
      await p.getByText("Step 1 of 9").waitFor();
      await screen("check-in after an event");
      // Answered once, so Close keeps it: Home offers Continue / Skip it
      await p.locator('[data-null="whole_body"]').click();
      await p.getByRole("button", { name: /^Close/ }).click();
      await button("Continue").waitFor();
      await screen("home with a check-in open");

      // Settings: every theme, every language, every sheet
      await button("Settings").first().click();
      await settingsTitle(p).waitFor();
      await screen("settings");
      const themes = (await openAppearance(p)).getByRole("radio");
      await screen("settings: appearance open");
      for (let i = 0; i < await themes.count(); i++) {
        await themes.nth(i).click();
        await screen(`settings: theme ${i + 1}`);
      }
      await themes.first().click();
      const languages = p.locator("#language-header ~ [role=radiogroup]")
        .getByRole("radio");
      for (let i = await languages.count() - 1; i >= 0; i--) {
        await languages.nth(i).click();
        await screen(`settings: language ${i + 1}`);
      }
      for (
        const row of [
          "Export",
          "Change passphrase",
          "New recovery key",
          "Sign out on this device",
          "Delete account",
        ]
      ) {
        await p.getByRole("button", { name: new RegExp(`^${row}`) }).first()
          .click();
        await p.getByRole("dialog").waitFor();
        await screen(`settings: ${row}`);
        await closeSheet();
      }

      // Lock, the recovery-key screen, unlock
      await p.getByRole("button", { name: /^Lock on this device/ }).click();
      await button("Use recovery key").waitFor();
      await screen("unlock");
      await button("Use recovery key").click();
      await p.getByLabel(/recovery key/i).first().waitFor();
      await screen("recover with key");
      await button("Cancel").click();
      await p.locator('input[type="password"]').first().fill(PASSPHRASE);
      await p.keyboard.press("Enter");
      // Closed by the person, the draft does not reopen by itself (ui.md §6.2)
      await button("Continue").waitFor({ timeout: 30_000 });
      await screen("home after unlock");

      // History: the draft left open above gates it; then the list
      await history();
      await p.getByText("A check-in is in progress.").waitFor();
      await screen("history: check-in in progress");
      await button("Continue it").click();
      await p.getByText("Step 1 of 9").waitFor();
      await p.getByRole("button", { name: /^Skip/ }).first().click();
      await button(NOW).waitFor({ timeout: 15_000 });
      const openRecord = async () => {
        await history();
        const row = p.locator("main h3 button").first();
        await row.waitFor();
        await screen(`history${suffix}`);
        await row.click();
        await p.locator("main .record button").first().waitFor();
      };
      let suffix = "";
      await openRecord();
      await screen("history: an open record");
      await button("Delete this check-in").first().click();
      await p.getByRole("dialog").waitFor();
      await screen("history: delete sheet");
      await closeSheet();

      // Every theme
      for (let i = 0; i < 10; i++) {
        await button("Settings").first().click();
        await openAppearance(p);
        await themes.nth(i).click();
        suffix = `: theme ${i + 1}`;
        await openRecord();
        await screen(`history: an open record, theme ${i + 1}`);
      }
      await button("Settings").first().click();
      await openAppearance(p);
      await themes.first().click();

      // 320 px in Russian and Ukrainian: nothing scrolls sideways
      await p.setViewportSize({ width: 320, height: 700 });
      for (const language of ["Русский", "Українська"]) {
        await p.goto(`${server.url}/settings`);
        await p.getByRole("radio", { name: language }).click();
        await p.waitForTimeout(300);
        await p.goto(`${server.url}/history`);
        const row = p.locator("main h3 button").first();
        await row.click();
        await p.locator("main .record button").first().waitFor();
        await screen(`history: 320 px, ${language}`);
        const sideways = await p.evaluate(() =>
          [document.documentElement, document.body].some((el) =>
            el.scrollWidth > el.clientWidth
          )
        );
        if (sideways) problems.push(`history: 320 px, ${language}: sideways`);
      }
    } catch (err) {
      if (page) {
        await page.screenshot({ path: "e2e/report/csp-failure.png" })
          .catch(() => {});
      }
      throw new Error(
        `stopped after ${visited.at(-1) ?? "start"}: ${(err as Error).message}`,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, [], `screens checked: ${visited.join(", ")}`);
    assertEquals(a11y, [], "accessibility (ui.md §10)");
    console.log(`${visited.length} screens: no CSP, axe or 44 px finding`);
  },
});
