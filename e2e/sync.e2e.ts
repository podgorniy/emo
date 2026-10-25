// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The sync dot (ui.md §3–§3.6): eight states in five shapes. A
 * 500 ms hover (or keyboard focus) shows the short tooltip, which ends with
 * "Click for details"; a tap or click (Enter too) syncs — never when signed
 * out or an update is needed — and opens the explanation sheet: the state,
 * live; the last sync; the legend of the five shapes; the encryption line;
 * the one action when one is needed. It stays until Close, the backdrop or
 * Esc, and focus comes back to the dot. A 5xx without X-Emo-Server is "Can't
 * reach the Emo server", and the band says so; a device offline is "This
 * device is offline" and "Offline". The shapes survive forced colours and
 * reduced motion; ≥ 3:1 and never the accent in every preset; axe on the open
 * sheet; no digits but the time; no pane bar in the check-in or on Saved.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page, Route } from "playwright-core";
import {
  auditA11y,
  launchBrowser,
  NOW,
  openAppearance,
  seedCheckIns,
  signUp,
  startServer,
} from "./harness.ts";

const dot = (page: Page) => page.locator("button.sync");
const tip = (page: Page) => page.locator("#sync-tip");
const sheet = (page: Page) => page.getByRole("dialog");
const glyph = (page: Page) => page.locator("button.sync svg.sync-glyph");
const band = (page: Page) => page.locator(".offline-band");
/** The band's visible words (the screen-reader sentence is beside them) */
const bandText = async (page: Page) =>
  (await band(page).locator("span[aria-hidden='true']").innerText()).trim();

/** The legend's rows, in order (lib/syncDot.ts GLYPHS) */
const LOOKS = ["synced", "sending", "waiting", "notConnected", "needsLook"];

/** Hovers the dot for 600 ms; the tooltip's text, or null when hidden */
async function hover(page: Page): Promise<string | null> {
  await page.mouse.move(5, 400);
  await page.waitForTimeout(200);
  const box = (await dot(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(650);
  const shown = await tip(page).evaluate((el) =>
    getComputedStyle(el).visibility === "visible"
  );
  return shown
    ? (await tip(page).innerText()).replace(/\s+/g, " ").trim()
    : null;
}

/** Puts the oldest outbox item `days` days back */
function ageOutbox(page: Page, days: number) {
  return page.evaluate((days) =>
    new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction("outbox", "readwrite");
        const store = tx.objectStore("outbox");
        const all = store.getAll();
        all.onsuccess = () => {
          for (const row of all.result) {
            row.created_at = new Date(Date.now() - days * 86_400_000)
              .toISOString();
            store.put(row);
          }
        };
        tx.oncomplete = () => resolve();
      };
    }), days);
}

/** The dot's glyph: its look (a class of SyncGlyph) */
function look(page: Page): Promise<string> {
  return glyph(page).evaluate((el) =>
    ["synced", "sending", "waiting", "notConnected", "needsLook"].find((c) =>
      el.classList.contains(c)
    ) ?? ""
  );
}

function focusOnDot(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.activeElement?.classList.contains("sync") ?? false
  );
}

/**
 * What the open sheet says, with the `{time}` taken out ("Synced · ",
 * "Last synced "), for the digit rule; its buttons; and its legend
 */
function readSheet(page: Page) {
  return sheet(page).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    const last = copy.querySelector(".sheet-last");
    const lastText = last?.textContent?.trim() ?? null;
    last?.remove();
    const title = copy.querySelector("h2");
    if (title?.textContent?.startsWith("Synced · ")) {
      title.textContent = "Synced · ";
    }
    const legend = [...el.querySelectorAll(".legend li")].map((li) => ({
      look: li.querySelector("svg")?.getAttribute("class") ?? "",
      shape: li.querySelector("svg")?.innerHTML ?? "",
      text: li.textContent?.trim() ?? "",
    }));
    return {
      title: el.querySelector("h2")?.textContent?.trim() ?? "",
      text: (copy.textContent ?? "").replace(/\s+/g, " ").trim(),
      last: lastText,
      buttons: [...el.querySelectorAll("button")].map((b) =>
        b.textContent?.trim() ?? ""
      ),
      legend,
      e2ee: el.querySelector(".sheet-e2ee")?.textContent?.trim() ?? "",
    };
  });
}

/** Contrast of every glyph on screen against the grounds, and the accent */
function glyphColours(page: Page) {
  return page.evaluate(() => {
    const rgb = (c: string): number[] => {
      const s = c.trim();
      if (s.startsWith("#")) {
        const h = s.length === 4
          ? [...s.slice(1)].map((x) => x + x).join("")
          : s.slice(1, 7);
        return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      }
      return (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const root = getComputedStyle(document.documentElement);
    const v = (name: string) => root.getPropertyValue(name).trim();
    const grounds = [v("--c-ground"), v("--c-surface")];
    // The gradient's second colour (theme.ts --c-page), when it is on
    const stops = v("--c-page").match(/#[0-9a-f]{3,8}/gi) ?? [];
    if (stops.length > 1) grounds.push(stops[1]);
    const accent = rgb(v("--c-accent")).join(",");
    // A preset whose accent is its ink or muted (Mono: ink #0B0B0C) has no
    // separate accent colour: the glyph's ink is then not the accent
    const own = [v("--c-ink"), v("--c-muted")].map((c) => rgb(c).join(","));
    const distinct = !own.includes(accent);
    return [...document.querySelectorAll<SVGElement>("svg.sync-glyph")].map(
      (el) => {
        const colour = rgb(getComputedStyle(el).color);
        return {
          look: el.getAttribute("class") ?? "",
          min: Math.min(...grounds.map((g) => ratio(colour, rgb(g)))),
          accent: distinct && colour.join(",") === accent,
        };
      },
    );
  });
}

Deno.test({
  name:
    "e2e - sync dot: eight states, the tooltip, the sheet, keyboard, shapes, themes",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    const seen: string[] = [];
    try {
      // Emo's own errors carry its header (api.md §1)
      const res = await fetch(`${server.url}/api/instance`);
      await res.body?.cancel();
      const EMO = { "X-Emo-Server": res.headers.get("X-Emo-Server")! };
      const context = await browser.newContext({
        locale: "en-GB",
        viewport: { width: 1280, height: 800 },
        // The dot's pulse is checked with motion on, then under reduced
        // motion (the harness asks for reduced motion by default)
        reducedMotion: "no-preference",
      });
      const page = await context.newPage();
      await signUp(page, server);
      await page.waitForTimeout(800); // the first sync pass
      const name = () => dot(page).getAttribute("aria-label");

      /** The tooltip on a 500 ms hover: title, detail, "Click for details" */
      const expectTip = async (
        state: string,
        title: string,
        detail?: string,
      ) => {
        const before = await name();
        const text = await hover(page);
        seen.push((text ?? "").replace(/^Synced · [^A-Z]*/, "Synced · "));
        if (!text?.startsWith(title)) {
          problems.push(`${state}: "${text}" should start "${title}"`);
        }
        if (detail && !text?.includes(detail)) {
          problems.push(`${state}: "${text}" lacks "${detail}"`);
        }
        if (!text?.endsWith("Click for details")) {
          problems.push(`${state}: "${text}" should end "Click for details"`);
        }
        assertEquals(
          await dot(page).getAttribute("aria-describedby"),
          "sync-tip",
        );
        assertEquals(await name(), before, `${state}: the name changed`);
      };

      /**
       * A click: the sheet with the state's title (it follows the state live),
       * the legend, the encryption line; Esc closes it, focus back on the dot
       */
      const expectSheet = async (
        state: string,
        title: string,
        glyphLook: string,
        action?: string,
      ) => {
        await page.mouse.move(5, 400);
        await dot(page).click();
        await sheet(page).getByRole("heading", { name: title, exact: true })
          .waitFor({ timeout: 5000 });
        assertEquals(await look(page), glyphLook, `${state}: look`);
        const s = await readSheet(page);
        seen.push(s.text);
        assertEquals(
          s.legend.map((row) => LOOKS.find((l) => row.look.includes(l))),
          LOOKS,
          `${state}: legend rows`,
        );
        assertEquals(
          new Set(s.legend.map((row) => row.shape)).size,
          5,
          `${state}: five different shapes`,
        );
        assert(s.e2ee.startsWith("Each check-in is encrypted"), state);
        if (state === "synced") assertEquals(s.last, null, "synced: no last");
        else {
          assert(
            s.last === "Not synced from this device yet" ||
              s.last?.startsWith("Last synced "),
            `${state}: ${s.last}`,
          );
        }
        // Close, and the one action where one is needed; never "Sync now"
        assertEquals(s.buttons, action ? ["Close", action] : ["Close"], state);
        await page.keyboard.press("Escape");
        await sheet(page).waitFor({ state: "detached" });
        assert(await focusOnDot(page), `${state}: focus not back on the dot`);
        // Focus came back from the sheet: no tooltip on top of it
        assert(
          !(await tip(page).evaluate((el) => el.classList.contains("open"))),
          `${state}: the tooltip opened on the way back`,
        );
      };

      // 8. Synced
      await expectTip(
        "synced",
        "Synced · just now",
        "Everything is on the server.",
      );
      assertEquals(await name(), "Sync: Synced");
      assertEquals(await dot(page).getAttribute("aria-haspopup"), "dialog");
      await expectSheet("synced", "Synced · just now", "synced");

      // Enter on the focused dot opens it too (the tooltip shows on focus)
      await page.locator("button.wordmark").focus();
      await page.keyboard.press("Tab");
      assert(await focusOnDot(page));
      assert(await tip(page).evaluate((el) => el.classList.contains("open")));
      await page.keyboard.press("Enter");
      await sheet(page).waitFor();
      assert(
        !(await tip(page).evaluate((el) => el.classList.contains("open"))),
        "the tooltip stayed under the sheet",
      );
      await page.keyboard.press("Escape");
      await sheet(page).waitFor({ state: "detached" });
      assert(await focusOnDot(page), "Enter: focus not back on the dot");

      // 7. Waiting: Emo itself does not take uploads for now (its 503, with
      //    its header: an answer, so no band)
      let block: "503" | "hang" | null = "503";
      let release: () => void = () => {};
      await page.route("**/api/entries/**", async (route: Route) => {
        if (route.request().method() !== "PUT" || block === null) {
          return route.continue();
        }
        if (block === "hang") {
          await new Promise<void>((r) => (release = r));
        }
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          headers: EMO,
          body: JSON.stringify({
            error: { code: "server_unavailable", message: "busy" },
          }),
        });
      });
      await seedCheckIns(page, [{ daysAgo: 0, at: "09:00" }], { queued: true });
      await expectSheet("waiting", "Waiting to sync", "waiting");
      await expectTip(
        "waiting",
        "Waiting to sync",
        "Saved on this device, not on the server yet.",
      );
      assertEquals(await band(page).count(), 0, "waiting: the band showed");

      // 6. Stale: waiting for over a day
      await ageOutbox(page, 2);
      await expectSheet("stale", "Not sent for over a day", "needsLook");
      await expectTip(
        "stale",
        "Not sent for over a day",
        "Check-ins are saved on this device. Emo keeps trying.",
      );

      // 5. Sending: a pass is running; the half disc pulses, and is still a
      //    half disc under reduced motion
      block = "hang";
      await page.mouse.move(5, 400);
      await dot(page).click();
      await sheet(page).getByRole("heading", { name: "Sending check-ins…" })
        .waitFor();
      assertEquals(await look(page), "sending");
      assert(
        (await glyph(page).evaluate((el) =>
          getComputedStyle(el).animationName
        )) !== "none",
        "sending does not pulse",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      assertEquals(
        await glyph(page).evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      assertEquals(await glyph(page).locator("path").count(), 1, "half disc");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      seen.push((await readSheet(page)).text);
      await page.keyboard.press("Escape");
      await sheet(page).waitFor({ state: "detached" });
      await expectTip("sending", "Sending check-ins…");
      block = null;
      release();
      await page.waitForTimeout(800);

      // 3. Offline: the device says so
      await context.setOffline(true);
      await page.getByRole("status").filter({ hasText: "You're offline" })
        .waitFor({ state: "attached" });
      assertEquals(await bandText(page), "Offline");
      await expectTip(
        "offline",
        "This device is offline",
        "Check-ins are saved here and will be sent when you're back online.",
      );
      await expectSheet("offline", "This device is offline", "notConnected");
      await context.setOffline(false);
      await band(page).waitFor({ state: "detached", timeout: 15_000 });

      // 4. Unreachable: a proxy answers for a stopped server (no header)
      await page.route("**/api/**", (route: Route) =>
        route.fulfill({
          status: 502,
          contentType: "text/html",
          body: "<html><body>Bad Gateway</body></html>",
        }));
      await expectSheet(
        "unreachable",
        "Can't reach the Emo server",
        "notConnected",
      );
      await band(page).waitFor();
      assertEquals(
        await bandText(page),
        "Can't reach the server",
      );
      await page.getByRole("status").filter({
        hasText: "Can't reach the Emo server. Entries are saved here",
      }).waitFor({ state: "attached" });
      await expectTip(
        "unreachable",
        "Can't reach the Emo server",
        "This device is online, but the server isn't answering.",
      );
      // The probe stays offline on the proxy's 502: no flapping
      await page.waitForTimeout(11_000);
      assertEquals(await band(page).count(), 1, "the band flapped");
      await page.unroute("**/api/**");
      await page.mouse.move(5, 400);
      await dot(page).click(); // a sync that gets Emo's answer
      await band(page).waitFor({ state: "detached", timeout: 15_000 });
      await page.keyboard.press("Escape");
      await sheet(page).waitFor({ state: "detached" });

      // The pointer can move from the dot onto the tooltip; clear of the tabs
      await hover(page);
      const tipBox = (await tip(page).boundingBox())!;
      await page.mouse.move(
        tipBox.x + tipBox.width / 2,
        tipBox.y + tipBox.height / 2,
        { steps: 4 },
      );
      await page.waitForTimeout(400);
      assert(
        await tip(page).evaluate((el) => el.classList.contains("open")),
        "kept while hovered",
      );
      const tabs = (await page.locator("nav.tabs").boundingBox())!;
      assert(tipBox.x + tipBox.width <= tabs.x, "over the tabs");

      // 2. Update needed (a 426): "Go to the update" in the sheet
      await page.route("**/api/**", (route: Route) =>
        route.fulfill({
          status: 426,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "upgrade_required",
              message: "x",
              min_client: "9.0.0",
            },
          }),
        }));
      await expectSheet(
        "update",
        "Sync paused until Emo updates",
        "needsLook",
        "Go to the update",
      );
      await expectTip(
        "update",
        "Sync paused until Emo updates",
        "Check-ins are saved on this device. They'll be sent after the update.",
      );
      await page.unroute("**/api/**");

      // Forced colours: the glyph is still there, in the system's colour
      await page.emulateMedia({ forcedColors: "active" });
      const box = await glyph(page).boundingBox();
      assert(
        box && box.width > 0 && box.height > 0,
        "no glyph in forced colours",
      );
      assert(
        (await glyph(page).evaluate((el) => getComputedStyle(el).color)) !==
          "rgba(0, 0, 0, 0)",
      );
      await page.emulateMedia({ forcedColors: "none" });

      // ru, uk: the same words in the interface language
      await page.goto(`${server.url}/settings`);
      await page.getByRole("radio", { name: "Русский" }).click();
      await page.waitForTimeout(800);
      const ru = await hover(page);
      assert(ru?.startsWith("Синхронизировано"), `ru: ${ru}`);
      assert(ru?.endsWith("Нажмите, чтобы узнать подробнее"), `ru: ${ru}`);
      await page.getByRole("radio", { name: "Українська" }).click();
      await page.waitForTimeout(800);
      const uk = await hover(page);
      assert(uk?.startsWith("Синхронізовано"), `uk: ${uk}`);
      assert(uk?.endsWith("Натисніть, щоб дізнатися більше"), `uk: ${uk}`);
      await page.getByRole("radio", { name: "English" }).click();
      await page.waitForTimeout(500);

      // Every preset, and Calm with its gradient: each look ≥ 3:1 on the
      // grounds, never the accent; axe on the open sheet
      const preset = async (label: string) => {
        await page.goto(server.url);
        await page.getByRole("button", { name: NOW, exact: true }).waitFor();
        await page.mouse.move(5, 400);
        await dot(page).click();
        await sheet(page).waitFor();
        await page.waitForTimeout(300);
        const colours = await glyphColours(page);
        assertEquals(colours.length, 6, `${label}: the dot and five rows`);
        for (const c of colours) {
          if (c.min < 3) {
            problems.push(`${label} ${c.look}: ${c.min.toFixed(2)}:1`);
          }
          if (c.accent) problems.push(`${label} ${c.look}: the accent`);
        }
        for (const line of await auditA11y(page)) {
          problems.push(`${label} sheet: ${line}`);
        }
        await page.keyboard.press("Escape");
        await sheet(page).waitFor({ state: "detached" });
      };
      for (let i = 0; i < 10; i++) {
        await page.goto(`${server.url}/settings`);
        const themes = (await openAppearance(page)).getByRole("radio");
        await themes.nth(i).click();
        await page.waitForTimeout(300);
        await preset(`theme ${i + 1}`);
      }
      await page.goto(`${server.url}/settings`);
      await (await openAppearance(page)).getByRole("radio").first().click();
      await page.getByRole("switch", { name: "Gradient background" }).click();
      await page.waitForTimeout(300);
      await preset("Calm gradient");

      // The tooltip is instant under reduced motion
      await page.emulateMedia({ reducedMotion: "reduce" });
      assertEquals(
        await tip(page).evaluate((el) =>
          getComputedStyle(el).transitionDuration
        ),
        "0s",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });

      // 1. Signed out: "Not synced"; explained first, the sign-in on its button
      await context.clearCookies();
      await page.goto(server.url);
      await page.getByText("Not synced", { exact: true }).waitFor();
      await expectTip(
        "signed out",
        "Signed out on this device",
        "Check-ins stay here, encrypted. Sign in to send them.",
      );
      await expectSheet(
        "signed out",
        "Signed out on this device",
        "needsLook",
        "Sign in to sync",
      );

      // No digits but the time
      for (const text of seen) {
        if (/\d/.test(text)) problems.push(`digits: ${text}`);
      }
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, []);
  },
});

Deno.test({
  name:
    "e2e - sync dot on a phone: a tap syncs once and explains; sign-in and the update on its button",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        locale: "en-GB",
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await signUp(page, server);
      await page.waitForTimeout(800);
      const url = page.url();
      // One sync pass pulls `GET /api/entries` once
      const pulls: string[] = [];
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (r.method() === "GET" && u.pathname === "/api/entries") {
          pulls.push(r.url());
        }
      });
      const closeButton = () =>
        sheet(page).getByRole("button", { name: "Close", exact: true });

      // A tap: one sync, the sheet, live; nothing navigates
      await dot(page).tap();
      await sheet(page).getByRole("heading", { name: "Synced · just now" })
        .waitFor({ timeout: 5000 });
      await page.waitForTimeout(1500);
      assertEquals(pulls.length, 1, `syncs: ${pulls.length}`);
      assertEquals(page.url(), url);
      // It stays (the old tooltip went after 4 s)
      await page.waitForTimeout(4600);
      assertEquals(await sheet(page).count(), 1, "the sheet closed by itself");
      // The backdrop closes it, the sheet's top area being the backdrop
      await page.touchscreen.tap(187, 40);
      await sheet(page).waitFor({ state: "detached" });
      // Close, then Esc
      await dot(page).tap();
      await closeButton().tap();
      await sheet(page).waitFor({ state: "detached" });
      await dot(page).tap();
      await sheet(page).waitFor();
      await page.keyboard.press("Escape");
      await sheet(page).waitFor({ state: "detached" });
      assert(await focusOnDot(page), "focus not back on the dot");

      // Unreachable: the proxy's 502; the slashed ring; the band by cause
      await page.route(
        "**/api/**",
        (route: Route) =>
          route.fulfill({
            status: 502,
            contentType: "text/html",
            body: "<html>",
          }),
      );
      await dot(page).tap();
      await sheet(page).getByRole("heading", {
        name: "Can't reach the Emo server",
      }).waitFor({ timeout: 5000 });
      assertEquals(await look(page), "notConnected");
      assertEquals(
        await bandText(page),
        "Can't reach the server",
      );
      await closeButton().tap();
      await page.unroute("**/api/**");
      await dot(page).tap();
      await band(page).waitFor({ state: "detached", timeout: 15_000 });
      await closeButton().tap();

      // Offline: the device's own word
      await context.setOffline(true);
      await band(page).waitFor();
      assertEquals(await bandText(page), "Offline");
      await dot(page).tap();
      await sheet(page).getByRole("heading", { name: "This device is offline" })
        .waitFor();
      assertEquals(await look(page), "notConnected");
      await closeButton().tap();
      await context.setOffline(false);
      await band(page).waitFor({ state: "detached", timeout: 15_000 });

      // No pane bar in the check-in, nor on Saved
      await page.getByRole("button", { name: NOW, exact: true }).tap();
      await page.getByText(/^Step 1 of/).waitFor();
      assertEquals(await page.locator(".panebar").count(), 0, "/now");
      assertEquals(await dot(page).count(), 0, "/now");
      await page.getByRole("button", { name: "Skip check-in" }).tap();
      await page.getByText("You can go back to what you were doing.").waitFor();
      assertEquals(await page.locator(".panebar").count(), 0, "Saved");
      assertEquals(await dot(page).count(), 0, "Saved");
      await page.getByRole("button", { name: "Done", exact: true }).tap();
      await page.getByRole("button", { name: NOW, exact: true }).waitFor();
      await page.waitForTimeout(800);

      // Update needed: "Go to the update" closes the sheet and leads to the
      // card — its button when it can be pressed, else the card in view
      await page.route("**/api/**", (route: Route) =>
        route.fulfill({
          status: 426,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "upgrade_required",
              message: "x",
              min_client: "9.0.0",
            },
          }),
        }));
      await dot(page).tap();
      const goToUpdate = sheet(page).getByRole("button", {
        name: "Go to the update",
      });
      await goToUpdate.waitFor({ timeout: 5000 });
      await goToUpdate.tap();
      await sheet(page).waitFor({ state: "detached" });
      await page.waitForTimeout(300);
      const landed = await page.evaluate(() => {
        const restart = document.querySelector(".update-restart");
        if (restart && document.activeElement === restart) return "focused";
        const title = document.getElementById("update-title");
        if (!title) return "no card";
        const r = title.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight
          ? "in view"
          : "out of view";
      });
      assert(landed === "focused" || landed === "in view", landed);
      await page.unroute("**/api/**");

      // Signed out: the sheet first, no sync; the sign-in only on its button
      await context.clearCookies();
      await page.goto(server.url);
      await page.getByText("Not synced", { exact: true }).waitFor();
      await page.waitForTimeout(800);
      pulls.length = 0;
      await dot(page).tap();
      await sheet(page).getByRole("heading", {
        name: "Signed out on this device",
      }).waitFor();
      const signIn = sheet(page).getByRole("button", {
        name: "Sign in to sync",
      });
      await signIn.waitFor();
      assertEquals(await page.getByLabel("Email").count(), 0);
      await page.waitForTimeout(500);
      assertEquals(pulls.length, 0, "signed out: a tap synced");
      await signIn.tap();
      await page.getByLabel("Email").waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
