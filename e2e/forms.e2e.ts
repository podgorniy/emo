// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Forms that keep their footing: Settings → Reminders with no copy of the
 * settings on this device and no server waits and says why, then loads once
 * Emo is in reach again (ui.md §11.3), and with a copy an
 * edit or a pause made before the server answers stays; a "+" that makes the
 * window too short never moves the stepper, and the fixes come under the
 * card (ui.md §4.5: a reveal never moves what was just tapped); Return in the first
 * new-passphrase field moves on to Repeat, and each Show button is named
 * after its field (ui.md §12.5, §10).
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  EMAIL,
  launchBrowser,
  NOW,
  PASSPHRASE,
  settingsTitle,
  signUp,
  startServer,
} from "./harness.ts";

/** Removes this device's copy of the reminder settings (meta `settings`) */
function forgetSettings(page: Page): Promise<void> {
  return page.evaluate(() =>
    new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("meta", "readwrite");
        tx.objectStore("meta").delete("settings");
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    })
  );
}

Deno.test({
  name:
    "e2e - Reminders with no copy and no server: the controls wait with a line, then load once back online",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await signUp(page, server);
      const dots = page.locator("nav.dots");
      const note = page.getByText("let it pass — nothing is counted", {
        exact: false,
      });

      // Settings once while online, so its code is in the page; then Home
      await dots.getByRole("button", { name: "Settings" }).click();
      await settingsTitle(page).waitFor();
      await note.waitFor();
      await dots.getByRole("button", { name: "Check-in" }).click();
      await page.getByRole("button", { name: NOW }).waitFor();

      // Offline, and this device forgets its copy: nothing to show yet
      await context.setOffline(true);
      await page.getByRole("status").filter({ hasText: "You're offline" })
        .waitFor({ state: "attached" });
      await forgetSettings(page);
      await dots.getByRole("button", { name: "Settings" }).click();
      await settingsTitle(page).waitFor();
      const line = page.getByText(
        "Reminder settings load when Emo can reach the server.",
      );
      await line.waitFor();
      const reminders = page.locator("#reminders");
      const controls = {
        from: reminders.locator('input[type="time"]').nth(0),
        to: reminders.locator('input[type="time"]').nth(1),
        fewer: reminders.getByRole("button", { name: "Fewer reminders" }),
        more: reminders.getByRole("button", { name: "More reminders" }),
        day: reminders.getByRole("button", { name: "1 day", exact: true }),
        days: reminders.getByRole("button", { name: "3 days", exact: true }),
        week: reminders.getByRole("button", { name: "1 week", exact: true }),
      };
      for (const [name, control] of Object.entries(controls)) {
        assertEquals(await control.isDisabled(), true, `offline: ${name}`);
      }

      // Back online: asked again; the controls take edits
      await context.setOffline(false);
      await line.waitFor({ state: "detached" });
      await note.waitFor();
      for (const [name, control] of Object.entries(controls)) {
        assertEquals(await control.isDisabled(), false, `online: ${name}`);
      }
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - Reminders: a double '+' into a window too short stays on the stepper; the fixes come under the card",
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
      await page.goto(`${server.url}/settings`);
      await settingsTitle(page).waitFor();

      // 09:00 – 14:00 holds 3 a day exactly (2 × 2 h + 1 h)
      const reminders = page.locator("#reminders");
      const from = reminders.locator('input[type="time"]').nth(0);
      const to = reminders.locator('input[type="time"]').nth(1);
      await to.fill("14:00");
      await to.dispatchEvent("change");
      const saved = page.getByText("Saved — from tomorrow.", { exact: false });
      await saved.waitFor();
      assertEquals(await from.inputValue(), "09:00");

      // Two quick taps where "+" is: both on "+" (3 → 5), never on a fix
      const plus = reminders.getByRole("button", { name: "More reminders" });
      const before = await plus.boundingBox();
      assert(before, "no + on screen");
      const x = before.x + before.width / 2;
      const y = before.y + before.height / 2;
      await page.mouse.click(x, y);
      await page.mouse.click(x, y);
      await page.getByText(
        "The window must be at least 9 hours long for 5 reminders a day.",
      ).waitFor();
      assertEquals(await reminders.locator(".stepper output").innerText(), "5");
      assertEquals(await from.inputValue(), "09:00");
      assertEquals(await to.inputValue(), "14:00");
      assertEquals(await to.getAttribute("aria-invalid"), "true");

      // The stepper never moved
      const after = await plus.boundingBox();
      assert(after, "no + on screen");
      assertEquals(Math.round(after.y), Math.round(before.y));
      assertEquals(Math.round(after.x), Math.round(before.x));

      // The message and the fixes: under the card
      const card = await reminders.locator(".settings-card").boundingBox();
      assert(card, "no card");
      const bottom = card.y + card.height;
      const message = await reminders.getByText("The window must be at least", {
        exact: false,
      }).boundingBox();
      assert(
        message && message.y >= bottom,
        "the message is not under the card",
      );
      const fixes = reminders.locator(".fixes button");
      assertEquals(await fixes.count(), 2);
      for (
        const box of [
          await fixes.nth(0).boundingBox(),
          await fixes.nth(1).boundingBox(),
        ]
      ) {
        assert(box && box.y >= bottom, "a fix is not under the card");
      }

      // A fix still fixes it in one tap
      await reminders.getByRole("button", { name: "Use 3 a day" }).click();
      await saved.waitFor();
      assertEquals(await reminders.locator(".stepper output").innerText(), "3");
      assertEquals(await to.getAttribute("aria-invalid"), "false");
      assertEquals(await fixes.count(), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - Reminders: an edit made while the server's first answer is on its way stays, and is what is saved",
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
      // This device has a copy (the first sync pass keeps one), so the
      // controls take edits before the server answers
      await page.waitForFunction(() =>
        new Promise<boolean>((resolve) => {
          const req = indexedDB.open("emo");
          req.onerror = () => resolve(false);
          req.onsuccess = () => {
            const db = req.result;
            const get = db.transaction("meta").objectStore("meta").get(
              "settings",
            );
            get.onerror = () => resolve(false);
            get.onsuccess = () => {
              db.close();
              resolve(get.result !== undefined);
            };
          };
        })
      );

      // The server's answer to GET /api/settings waits until released
      let release = () => {};
      const held = new Promise<void>((r) => (release = r));
      await page.route("**/api/settings", async (route) => {
        if (route.request().method() === "GET") await held;
        await route.continue();
      });
      await page.goto(`${server.url}/settings`);
      await settingsTitle(page).waitFor();
      const to = page.locator('#reminders input[type="time"]').nth(1);
      await to.fill("14:00");
      await to.dispatchEvent("change");
      const answered = page.waitForResponse((r) =>
        new URL(r.url()).pathname === "/api/settings" &&
        r.request().method() === "GET"
      );
      release();
      await answered;
      await page.getByText("Saved — from tomorrow.", { exact: false })
        .waitFor();
      assertEquals(await to.inputValue(), "14:00");

      // And the server has it: a fresh load shows it
      await page.unroute("**/api/settings");
      await page.reload();
      await settingsTitle(page).waitFor();
      await page.waitForLoadState("networkidle");
      assertEquals(
        await page.locator('#reminders input[type="time"]').nth(1)
          .inputValue(),
        "14:00",
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

/** This device's copy of the settings (meta `settings`), once there is one */
function cachedSettings(
  page: Page,
): Promise<{ reminders_paused_until: string | null } | null> {
  return page.evaluate(() =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction("meta").objectStore("meta").get("settings");
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          db.close();
          resolve(get.result?.value ?? null);
        };
      };
    })
  );
}

Deno.test({
  name:
    "e2e - Reminders: a pause made while the server's first answer is on its way stays, on screen and in this device's copy",
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
      // A copy here (the first sync pass keeps one): the pause takes taps
      // before the server answers
      await page.waitForFunction(async () =>
        await new Promise<boolean>((resolve) => {
          const req = indexedDB.open("emo");
          req.onerror = () => resolve(false);
          req.onsuccess = () => {
            const get = req.result.transaction("meta").objectStore("meta")
              .get("settings");
            get.onerror = () => resolve(false);
            get.onsuccess = () => resolve(get.result !== undefined);
          };
        })
      );

      // The first GET is answered by the server at once, but the answer
      // reaches the page only when released: what it had before the pause
      let release = () => {};
      const held = new Promise<void>((r) => (release = r));
      let answeredBefore = () => {};
      const before = new Promise<void>((r) => (answeredBefore = r));
      await page.route("**/api/settings", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        const response = await route.fetch();
        answeredBefore();
        await held;
        await route.fulfill({ response });
      });
      await page.goto(`${server.url}/settings`);
      await settingsTitle(page).waitFor();
      await before;
      await page.locator("#reminders").getByRole("button", {
        name: "1 day",
        exact: true,
      }).click();
      const until = page.getByText(/^Paused until /);
      await until.waitFor();

      // The old answer lands: the pause stays, here and in the copy
      const answered = page.waitForResponse((r) =>
        new URL(r.url()).pathname === "/api/settings" &&
        r.request().method() === "GET"
      );
      release();
      await answered;
      await page.waitForTimeout(500);
      assertEquals(await until.count(), 1, "the pause was undone on screen");
      assert(
        (await cachedSettings(page))?.reminders_paused_until,
        "the copy lost the pause",
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - new passphrase: Return in the first field moves on to Repeat; each Show button is named after its field",
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
      // Sign-up up to the passphrase step (as harness.signUp)
      await page.goto(server.url);
      await page.getByLabel("Email").waitFor();
      await page.getByRole("button", {
        name: "I have an invite code",
        exact: true,
      }).click();
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Invite code").fill(await server.invite());
      await page.getByRole("button", { name: "Send code", exact: true })
        .click();
      await page.getByLabel("Six-digit code").fill(
        await server.mailCode(EMAIL),
      );
      const pass = page.getByLabel(/^Passphrase/);
      await pass.waitFor();
      const repeat = page.getByLabel("Repeat", { exact: true });

      // Two Show buttons, told apart by name; the field labels stay unique
      const showPass = page.getByRole("button", {
        name: /^Show\s*—\s*Passphrase, 8 characters or more$/,
      });
      const showRepeat = page.getByRole("button", {
        name: /^Show\s*—\s*Repeat$/,
      });
      assertEquals(await showPass.count(), 1);
      assertEquals(await showRepeat.count(), 1);
      assertEquals(await page.getByLabel("Repeat").count(), 1);
      await showRepeat.click();
      await page.getByRole("button", { name: /^Hide\s*—\s*Repeat$/ })
        .waitFor();
      assertEquals(await repeat.getAttribute("type"), "text");

      // Return in the first field: on to Repeat, nothing sent
      assertEquals(await pass.getAttribute("enterkeyhint"), "next");
      await pass.fill(PASSPHRASE);
      await pass.press("Enter");
      assertEquals(
        await page.evaluate(() => document.activeElement?.id),
        "setup-repeat",
      );
      await page.waitForTimeout(200);
      assertEquals(await pass.count(), 1);
      assertEquals(await pass.inputValue(), PASSPHRASE);

      // Return in Repeat, once both match: Next
      await page.keyboard.type(PASSPHRASE);
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: /I'll write it down/ })
        .waitFor({ timeout: 30_000 });
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
