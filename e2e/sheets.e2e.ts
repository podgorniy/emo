// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sheets on a phone (390×844): the system Back closes the open sheet and
 * stays on its pane (ui.md §2.2, lib/sheets.ts); a sideways drag
 * on a sheet never changes pane (ui.md §5.3); Delete account waits for the
 * passphrase; Return moves from field to field and confirms, but only takes
 * focus to a destructive confirm (ui.md §11).
 */
import { assert, assertEquals } from "@std/assert";
import type { Browser, Page } from "playwright-core";
import {
  type E2eServer,
  launchBrowser,
  nextStep,
  NOW,
  PASSPHRASE,
  settingsTitle,
  signUp,
  startServer,
} from "./harness.ts";

const PHONE = { width: 390, height: 844 };
const NEW_PASSPHRASE = "quiet amber lantern drifts north";

/** A signed-up phone on Settings */
async function phoneOnSettings(browser: Browser, server: E2eServer) {
  const page = await (await browser.newContext({
    locale: "en-GB",
    viewport: PHONE,
    hasTouch: true,
    isMobile: true,
  })).newPage();
  await signUp(page, server);
  await openSettings(page);
  return page;
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first()
    .click();
  await settingsTitle(page).waitFor();
}

const path = (page: Page) => new URL(page.url()).pathname;
const activeId = (page: Page) =>
  page.evaluate(() => document.activeElement?.id ?? "");

/**
 * A finger dragging 80 px to the right over `target`, mid-screen (well away
 * from the 24 px edges): the pointer events a touch makes when nothing takes
 * the gesture for a scroll, so it ends in a pointerup, not a pointercancel.
 * Dispatched on the element: what is under it decides, not the browser's
 * touch-action heuristics.
 */
async function dragRight(page: Page, target: string) {
  await page.locator(target).first().evaluate((el) => {
    const y = el.getBoundingClientRect().top + 10;
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientY: y,
    };
    el.dispatchEvent(
      new PointerEvent("pointerdown", { ...init, clientX: 120 }),
    );
    el.dispatchEvent(
      new PointerEvent("pointermove", { ...init, clientX: 160 }),
    );
    el.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: 200 }));
  });
}

Deno.test({
  name:
    "e2e - phone: Back closes a Settings sheet and stays; a drag on the sheet never changes pane",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await phoneOnSettings(browser, server);
      const dialog = page.getByRole("dialog");
      const current = dialog.getByLabel("Current passphrase", { exact: true });

      // An 80 px drag on the sheet's title: the sheet and the typing stay
      await page.getByRole("button", { name: "Change passphrase" }).click();
      await current.fill("half typed");
      await dragRight(page, "[role=dialog] h2");
      await page.waitForTimeout(400);
      assertEquals(path(page), "/settings");
      assertEquals(await page.locator("#history-title").count(), 0);
      assertEquals(await current.inputValue(), "half typed");

      // Back closes the sheet, nothing else: Settings stays, at its URL,
      // and the sheet does not come back
      await page.goBack();
      await dialog.waitFor({ state: "detached" });
      await page.waitForTimeout(500);
      assertEquals(await dialog.count(), 0, "the sheet came back");
      await settingsTitle(page).waitFor();
      assertEquals(path(page), "/settings");

      // Cancel takes the sheet's entry with it: the next Back goes Home
      await page.getByRole("button", { name: "Change passphrase" }).click();
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.waitForTimeout(300); // its own pop lands first
      await page.goBack();
      await page.getByRole("button", { name: NOW, exact: true }).waitFor();
      assertEquals(path(page), "/");

      // The same drag on Settings itself does step to History, so the one
      // above was stopped by the sheet, not lost on the way
      await openSettings(page);
      await dragRight(page, "h1.settings-title");
      await page.locator("#history-title").waitFor();
      assertEquals(path(page), "/history");
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - phone: Delete account waits for the passphrase; Return moves between fields, confirms, and only focuses a destructive confirm",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await phoneOnSettings(browser, server);
      const dialog = page.getByRole("dialog");

      // Delete account: greyed while the field is empty
      await page.getByRole("button", { name: "Delete account", exact: true })
        .click();
      const confirm = dialog.getByRole("button", { name: "Delete everything" });
      await confirm.waitFor();
      assert(await confirm.isDisabled(), "enabled with an empty field");
      await page.waitForTimeout(500); // past the 350 ms settle
      assert(await confirm.isDisabled(), "enabled with an empty field");
      const field = dialog.locator('input[type="password"]');
      await field.fill("not the passphrase");
      await dialog.locator("button.danger:enabled").waitFor();
      await field.fill("");
      await dialog.locator("button.danger:disabled").waitFor();

      // Return in its one field only takes focus to the confirm
      await field.fill("not the passphrase");
      await field.press("Enter");
      await page.waitForTimeout(150);
      assertEquals(
        await page.evaluate(() => document.activeElement?.textContent?.trim()),
        "Delete everything",
      );
      assertEquals(await dialog.locator("[aria-busy=true]").count(), 0);
      assertEquals(await dialog.count(), 1);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });

      // Change passphrase: Return goes Current → New → Repeat → Save
      await page.getByRole("button", { name: "Change passphrase" }).click();
      await dialog.waitFor();
      assertEquals(await activeId(page), "data-pass");
      await page.keyboard.type(PASSPHRASE);
      await page.keyboard.press("Enter");
      assertEquals(await activeId(page), "data-new-passphrase");
      await page.keyboard.type(NEW_PASSPHRASE);
      await page.keyboard.press("Enter");
      assertEquals(await activeId(page), "data-new-repeat");
      await page.keyboard.type(NEW_PASSPHRASE);
      await page.keyboard.press("Enter");
      await dialog.waitFor({ state: "detached", timeout: 30_000 });
      await page.locator(".settings-note", { hasText: "Done" }).waitFor();
      assertEquals(path(page), "/settings");
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - phone: a lock from another tab with a sheet open: the sheet and its entry go, the URL is /, unlocking lands Home and Back reopens nothing",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await phoneOnSettings(browser, server);
      const dialog = page.getByRole("dialog");
      await page.getByRole("button", { name: "Change passphrase" }).click();
      await dialog.getByLabel("Current passphrase", { exact: true }).fill(
        "half typed",
      );
      assert(
        await page.evaluate(() => typeof history.state?.sheet === "string"),
        "the sheet has no history entry",
      );

      // Locked from a second tab of the same browser (a broadcast)
      const other = await page.context().newPage();
      await other.goto(server.url);
      await openSettings(other);
      await other.getByRole("button", { name: /^Lock on this device/ })
        .click();

      // The first tab: the unlock screen, no sheet, no sheet entry, at /
      const unlock = page.getByLabel("Passphrase", { exact: true });
      await unlock.waitFor();
      await dialog.waitFor({ state: "detached" });
      await page.waitForFunction(() => location.pathname === "/");
      await page.waitForTimeout(300);
      assertEquals(
        await page.evaluate(() => history.state?.sheet ?? null),
        null,
        "a sheet entry is left on top",
      );

      // Unlocking lands on Home; Back from there opens no sheet
      await unlock.fill(PASSPHRASE);
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: NOW, exact: true }).waitFor({
        timeout: 30_000,
      });
      assertEquals(path(page), "/");
      await page.goBack();
      await page.waitForTimeout(500);
      assertEquals(await dialog.count(), 0, "a sheet came back");
      assertEquals(await page.locator("h1.settings-title").count(), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - phone: the new recovery key takes focus and keeps it; nothing behind it takes a key; focus is back on its row after",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await phoneOnSettings(browser, server);
      const row = page.getByRole("button", {
        name: "New recovery key",
        exact: true,
      });
      await row.click();
      const sheet = page.getByRole("dialog");
      await sheet.locator('input[type="password"]').fill(PASSPHRASE);
      await sheet.getByRole("button", { name: "Next", exact: true }).click();
      const overlay = page.locator("[role=dialog][aria-modal=true]", {
        hasText: "I'll write it down",
      });
      await overlay.waitFor({ timeout: 30_000 });
      await page.waitForTimeout(500); // the sheet has gone, its focus given back
      const inside = () =>
        page.evaluate(() =>
          !!document.activeElement?.closest("[role=dialog][aria-modal=true]")
        );
      assert(await inside(), "focus is behind the key");
      assert(
        await row.evaluate((el) => el.closest("[inert]") !== null),
        "the row behind it still takes a key",
      );

      // Keys meant for it never reach behind it: no sheet opens, the key stays
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Shift+Tab");
        assert(await inside(), `Shift+Tab ${i + 1} left the key`);
      }
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        assert(await inside(), `Tab ${i + 1} left the key`);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      assertEquals(await page.getByRole("dialog").count(), 1);
      await overlay.waitFor();

      // Kept: the overlay goes, Settings takes keys again, focus on its row
      await overlay.getByRole("button", { name: /I'll write it down/ })
        .click();
      await overlay.getByRole("button", { name: "Next", exact: true }).click();
      await overlay.waitFor({ state: "detached" });
      assertEquals(
        await row.evaluate((el) => el.closest("[inert]") !== null),
        false,
      );
      assert(
        await row.evaluate((el) => document.activeElement === el),
        "focus is not back on its row",
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - phone: a reload with a sheet open leaves no stale entry: Back goes Home, and the next Back never reopens Settings",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await phoneOnSettings(browser, server);
      const dialog = page.getByRole("dialog");
      await page.getByRole("button", { name: "Change passphrase" }).click();
      await dialog.waitFor();
      assert(
        await page.evaluate(() => typeof history.state?.sheet === "string"),
        "the sheet has no history entry",
      );

      // Reloaded with it open (F5, or a tab the phone evicted)
      await page.reload();
      await settingsTitle(page).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(500);
      assertEquals(await dialog.count(), 0);
      assertEquals(path(page), "/settings");
      assertEquals(
        await page.evaluate(() => history.state?.sheet ?? null),
        null,
        "a sheet entry is on top",
      );

      // Back: Home. Back again: never Settings (nor any sheet) again
      await page.goBack();
      await page.getByRole("button", { name: NOW, exact: true }).waitFor();
      assertEquals(path(page), "/");
      await page.goBack().catch(() => null);
      await page.waitForTimeout(800);
      assertEquals(
        await page.locator("h1.settings-title").count(),
        0,
        "Settings came back",
      );
      assertEquals(await dialog.count(), 0, "a sheet came back");
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - phone: a reminder tap over the check-in's help changes nothing; after Close, Back from Home never reopens the check-in",
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
      const step = page.getByText(/^Step \d+ of \d+$/);

      // Step 2 with its help open
      await page.getByRole("button", { name: NOW }).click();
      await page.getByText(/^Step 1 of \d+$/).waitFor();
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await page.getByText(/^Step 2 of \d+$/).waitFor();
      await page.getByRole("button", { name: "About these words" }).click();
      const help = page.getByRole("dialog");
      await help.waitFor();

      // A reminder's tap, as the service worker reports it to this window
      await page.evaluate((url) => {
        navigator.serviceWorker.dispatchEvent(
          new MessageEvent("message", { data: { type: "open-url", url } }),
        );
      }, `/now?reminder=${crypto.randomUUID()}`);
      await page.waitForTimeout(500);
      assertEquals(await help.count(), 1, "the help closed");
      assertEquals(path(page), "/now");

      // Help closed by its button, the form by ×: Home
      await help.getByRole("button", { name: "Close", exact: true }).click();
      await help.waitFor({ state: "detached" });
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Close — you can continue later" })
        .click();
      // Home, with the check-in waiting behind Continue / Skip it
      await page.getByRole("button", { name: "Skip it" }).waitFor();
      await page.waitForTimeout(300);

      // Back from Home: never the check-in again
      await page.goBack().catch(() => null);
      await page.waitForTimeout(800);
      assertEquals(await step.count(), 0, "the check-in reopened");
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
