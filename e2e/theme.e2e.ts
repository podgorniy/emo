// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §14.3, §14.8; architecture.md §8.1: a chosen theme is
 * painted again at the next start from `localStorage['emo-css']`, which holds
 * CSS values only; the choice itself is only in the encrypted prefs. Home and
 * the open check-in pass axe in every preset (ui.md §10), not only in Calm.
 */
import { assert, assertEquals } from "@std/assert";
import {
  auditA11y,
  launchBrowser,
  NOW,
  openAppearance,
  settingsTitle,
  signUp,
  startServer,
} from "./harness.ts";

Deno.test({
  name: "e2e - a theme survives a reload with nothing about it in plaintext",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await signUp(page, server);
      const ground = () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--c-ground").trim()
        );
      const before = await ground();

      await page.getByRole("button", { name: "Settings", exact: true })
        .first().click();
      const themes = (await openAppearance(page)).getByRole("radio");
      await themes.nth(3).click();
      await page.waitForTimeout(300);
      const chosen = await ground();
      assert(chosen && chosen !== before, `${before} → ${chosen}`);

      // The reload keeps the route: Settings again
      await page.reload();
      await settingsTitle(page).waitFor();
      assertEquals(await ground(), chosen);

      const stored = await page.evaluate(async () => {
        const local = Object.fromEntries(
          Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
        );
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("emo");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const appearance = await new Promise((resolve) => {
          const req = db.transaction("meta").objectStore("meta").get(
            "appearance",
          );
          req.onsuccess = () => resolve(req.result ?? null);
        });
        db.close();
        return { local, appearance };
      });
      assertEquals(stored.appearance, null);
      assertEquals("emo-theme-preset" in stored.local, false);
      const css = JSON.parse(stored.local["emo-css"] ?? "{}");
      assertEquals(Object.keys(css).sort(), ["themeColor", "vars"]);
      assertEquals(css.vars["--c-ground"], chosen);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - 'Match the system': off by default; Calm when light, Dusk when dark, from the first paint; a theme turns it off",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await signUp(page, server);
      const ground = () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--c-ground").trim().toUpperCase()
        );
      const CALM = "#E4EDF1";
      const DUSK = "#14172B";
      // Dark mode alone changes nothing: light by default (D4)
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      assertEquals(await ground(), CALM);

      await page.getByRole("button", { name: "Settings", exact: true })
        .first().click();
      await openAppearance(page);
      const auto = page.getByRole("switch", {
        name: "Match the system: Calm by day, Dusk at night",
      });
      assertEquals(await auto.getAttribute("aria-checked"), "false");
      await auto.click();
      await page.waitForTimeout(300);
      assertEquals(await ground(), DUSK);
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForTimeout(200);
      assertEquals(await ground(), CALM);

      // The next start paints Dusk before the app runs, in dark mode
      await page.emulateMedia({ colorScheme: "dark" });
      await page.reload();
      const first = await page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--c-ground")
          .toUpperCase()
      );
      assertEquals(first, DUSK);

      // Choosing a theme turns it off
      await settingsTitle(page).waitFor();
      const themes = (await openAppearance(page)).getByRole("radio");
      await themes.nth(3).click();
      await page.waitForTimeout(300);
      assertEquals(await auto.getAttribute("aria-checked"), "false");
      const after = await ground();
      assert(![CALM, DUSK].includes(after), after);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - every preset (and a gradient): Home and the open check-in pass axe and 44 px",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
      })).newPage();
      await signUp(page, server);
      const audit = async (where: string) => {
        await page.waitForTimeout(400); // transitions settle
        for (const line of await auditA11y(page)) {
          problems.push(`${where}: ${line}`);
        }
      };
      const check = async (name: string) => {
        await page.goto(server.url);
        await page.getByRole("button", { name: NOW, exact: true }).waitFor();
        await audit(`${name} home`);
        await page.getByRole("button", { name: NOW, exact: true }).click();
        await page.getByText(/^Step 1 of/).waitFor();
        await audit(`${name} check-in`);
        await page.getByRole("button", { name: /^Close/ }).click();
        await page.waitForURL((u) => u.pathname === "/");
      };
      for (let i = 0; i < 10; i++) {
        await page.goto(`${server.url}/settings`);
        const themes = (await openAppearance(page)).getByRole("radio");
        const name = (await themes.nth(i).locator(".name").textContent())!
          .trim();
        await themes.nth(i).click();
        await page.waitForTimeout(300);
        await check(name);
      }
      // Calm with a gradient background
      await page.goto(`${server.url}/settings`);
      await (await openAppearance(page)).getByRole("radio").first().click();
      await page.getByRole("switch", { name: "Gradient background" }).click();
      await page.waitForTimeout(300);
      await check("Calm gradient");
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, []);
  },
});
