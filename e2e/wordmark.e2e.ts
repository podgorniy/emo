// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The wordmark "Emo" in the pane bar (ui.md §2.2,
 * ui.md §15.3): a tap or click goes Home from History and Settings,
 * straight (History is not mounted on the way from Settings), as a pane dot
 * would — Back never returns to the pane left; on Home it only moves focus to
 * Now, with no reload and no draft. A 600 ms hold still opens Settings and
 * never also goes Home; a move of more than 10 px or a cancelled pointer does
 * nothing. Enter works; its name is "Emo — Check-in" in every language; a
 * closed draft stays behind "Continue"; a reminder-window change made just
 * before leaving Settings is saved once, an invalid one never. The check-in
 * has no wordmark and no pane bar. On a phone a tap on Home brings the page
 * back to where it opens, its reach room out of view (lib/reach.ts).
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { launchBrowser, NOW, signUp, startServer } from "./harness.ts";

const PHONE = { locale: "en-GB", viewport: { width: 390, height: 844 } };

async function until(fn: () => Promise<boolean>, what: string) {
  const end = Date.now() + 10_000;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** The row count of a store of this browser's database */
function count(page: Page, store: string): Promise<number> {
  return page.evaluate((store) =>
    new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const c = db.transaction(store).objectStore(store).count();
        c.onsuccess = () => {
          db.close();
          resolve(c.result);
        };
      };
    }), store);
}

interface Watch {
  __routes: string[];
  __nowAdded: boolean;
}

/**
 * Records every path the app sets (pushState, replaceState, popstate) and
 * whether the Now button was put on screen again, from `resetWatch` on.
 */
async function watchRoutes(page: Page) {
  await page.evaluate(() => {
    const w = globalThis as unknown as Watch;
    w.__routes = [];
    w.__nowAdded = false;
    const note = () => w.__routes.push(location.pathname);
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<History["pushState"]>) => {
      push(...args);
      note();
    };
    history.replaceState = (...args: Parameters<History["replaceState"]>) => {
      replace(...args);
      note();
    };
    addEventListener("popstate", note);
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches("button.now") || node.querySelector("button.now"))
          ) w.__nowAdded = true;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

function resetWatch(page: Page) {
  return page.evaluate(() => {
    const w = globalThis as unknown as Watch;
    w.__routes = [];
    w.__nowAdded = false;
  });
}

function watched(page: Page) {
  return page.evaluate(() => {
    const w = globalThis as unknown as Watch;
    return { routes: [...w.__routes], nowAdded: w.__nowAdded };
  });
}

Deno.test({
  name:
    "e2e - wordmark: a tap or click goes Home, the hold opens Settings, never both",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    try {
      const page = await (await browser.newContext(PHONE)).newPage();
      const fetched: string[] = [];
      page.on("request", (r) => fetched.push(new URL(r.url()).pathname));
      await signUp(page, server);
      await watchRoutes(page);
      const path = () => new URL(page.url()).pathname;
      const wordmark = page.locator("button.wordmark");
      const now = page.getByRole("button", { name: NOW, exact: true });
      const settings = page.getByRole("heading", {
        level: 1,
        name: "Settings",
        exact: true,
      });
      const historyTitle = page.getByRole("heading", {
        level: 1,
        name: "History",
      });
      const paneDot = (name: string) =>
        page.locator(`nav.dots button[aria-label="${name}"]`);
      const focusedNow = () =>
        page.evaluate(() =>
          document.activeElement?.classList.contains("now") ?? false
        );
      const focusMark = () =>
        page.evaluate(() => {
          const el = document.activeElement;
          return el ? `${el.tagName}.${el.className}:${el.textContent}` : "";
        });
      /** A press on the wordmark that the test controls step by step */
      const press = async (kind: "touch" | "mouse" = "touch") => {
        const box = (await wordmark.boundingBox())!;
        const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await wordmark.dispatchEvent("pointerdown", {
          clientX: at.x,
          clientY: at.y,
          pointerType: kind,
          isPrimary: true,
          button: 0,
        });
        return at;
      };
      // A synthetic click has detail 0, which the wordmark takes for Enter
      // or Space (always Home): a pointer's click has detail 1
      const release = async () => {
        await wordmark.dispatchEvent("pointerup", { pointerType: "touch" });
        await wordmark.dispatchEvent("click", { detail: 1 });
      };

      // 1. From Settings: Home, focus on Now, History never fetched
      await paneDot("Settings").click();
      await settings.waitFor();
      assertEquals(path(), "/settings");
      await wordmark.click();
      await now.waitFor();
      assertEquals(path(), "/");
      await until(focusedNow, "focus on Now after Settings");
      assertEquals(
        fetched.filter((p) => /^\/assets\/History-/.test(p)),
        [],
        "History mounted on the way from Settings to Home",
      );

      // 2. From History: Home; Back never returns to History; the same
      //    browser history as a pane dot leaves
      await paneDot("History").click();
      await historyTitle.waitFor();
      await paneDot("Check-in").click();
      await now.waitFor();
      const byDot = await page.evaluate(() => history.length);
      await paneDot("History").click();
      await historyTitle.waitFor();
      assertEquals(path(), "/history");
      await wordmark.click();
      await now.waitFor();
      assertEquals(path(), "/");
      await until(focusedNow, "focus on Now after History");
      assertEquals(await page.evaluate(() => history.length), byDot);
      await page.goBack().catch(() => null);
      await page.waitForTimeout(300);
      assert(path() !== "/history", `Back returned to ${path()}`);
      if (path() !== "/") {
        await page.goto(server.url);
        await now.waitFor();
        await watchRoutes(page);
      }

      // 3. The hold, from Home and from History: Settings, Home never between
      for (const from of ["home", "history"] as const) {
        if (from === "history") {
          await paneDot("History").click();
          await historyTitle.waitFor();
        }
        await resetWatch(page);
        await press();
        await page.waitForTimeout(650);
        await release();
        await settings.waitFor();
        await page.waitForTimeout(300);
        assertEquals(path(), "/settings", `hold from ${from}`);
        const seen = await watched(page);
        if (seen.routes.includes("/") || seen.nowAdded) {
          problems.push(`hold from ${from}: Home too, ${JSON.stringify(seen)}`);
        }
        await paneDot("Check-in").click();
        await now.waitFor();
      }

      // 4. Cancelled: a move of 15 px, or pointercancel, then the click
      await paneDot("History").click();
      await historyTitle.waitFor();
      await until(
        () => page.evaluate(() => document.activeElement?.tagName === "H1"),
        "focus on History's heading",
      );
      for (const how of ["move", "cancel"] as const) {
        const focusBefore = await focusMark();
        await resetWatch(page);
        const at = await press();
        if (how === "move") {
          await wordmark.dispatchEvent("pointermove", {
            clientX: at.x + 15,
            clientY: at.y,
            pointerType: "touch",
          });
        } else {
          await wordmark.dispatchEvent("pointercancel", {
            pointerType: "touch",
          });
        }
        await page.waitForTimeout(650);
        await release();
        await page.waitForTimeout(300);
        assertEquals(path(), "/history", `${how}: the route changed`);
        assertEquals(await focusMark(), focusBefore, `${how}: focus moved`);
        assertEquals((await watched(page)).routes, [], `${how}: routes`);
      }

      // 6. Enter on the focused wordmark goes Home (detail 0)
      await wordmark.focus();
      await page.keyboard.press("Enter");
      await now.waitFor();
      assertEquals(path(), "/");
      await until(focusedNow, "focus on Now after Enter");

      // 5. On Home: no route change, no reload, no draft; focus on Now
      await page.evaluate(() => {
        (globalThis as unknown as { __alive: boolean }).__alive = true;
        sessionStorage.removeItem("e2e-unloaded");
        addEventListener("beforeunload", () => {
          sessionStorage.setItem("e2e-unloaded", "1");
        });
      });
      const navigations = () =>
        page.evaluate(() => performance.getEntriesByType("navigation").length);
      const navBefore = await navigations();
      const draftsBefore = await count(page, "draft");
      // Focus elsewhere first, so it is the click that brings it to Now
      await page.evaluate(() =>
        (document.activeElement as HTMLElement)?.blur()
      );
      await resetWatch(page);
      await wordmark.click();
      await until(focusedNow, "focus on Now on Home");
      await page.waitForTimeout(300);
      assertEquals(path(), "/");
      assertEquals(
        await page.evaluate(() =>
          (globalThis as unknown as { __alive?: boolean }).__alive === true &&
          sessionStorage.getItem("e2e-unloaded") === null
        ),
        true,
        "the page reloaded",
      );
      assertEquals(await navigations(), navBefore);
      assertEquals(await count(page, "draft"), draftsBefore);
      assertEquals((await watched(page)).routes, [], "Home: a route was set");

      // 8. A reminder-window change just before leaving: saved exactly once;
      //    a window too short for the count: never sent
      // Before any language change: a sync pass PUTs settings when the
      // locale differs, so only bodies with the window typed here count
      const puts: string[] = [];
      page.on("request", (r) => {
        if (
          r.method() === "PUT" &&
          new URL(r.url()).pathname === "/api/settings"
        ) puts.push(r.postData() ?? "");
      });
      const sent = (start: string) =>
        puts.filter((b) => b.includes(`"wake_start":"${start}"`)).length;
      const from = page.getByLabel("from", { exact: true });
      const to = page.getByLabel("to", { exact: true });
      await paneDot("Settings").click();
      await settings.waitFor();
      await from.waitFor();
      await page.waitForTimeout(500); // the fresh settings have arrived
      await from.fill("08:00");
      await page.waitForTimeout(100);
      await wordmark.click();
      await now.waitFor();
      await page.waitForTimeout(1500);
      assertEquals(sent("08:00"), 1, "a valid change left within the debounce");

      await paneDot("Settings").click();
      await settings.waitFor();
      await from.waitFor();
      await page.waitForTimeout(500);
      assertEquals(await to.inputValue(), "22:00");
      await from.fill("21:00"); // 1 h for 3 a day: too short
      await page.getByText(/^The window must be at least/).waitFor();
      await page.waitForTimeout(100);
      await wordmark.click();
      await now.waitFor();
      await page.waitForTimeout(1500);
      assertEquals(sent("21:00"), 0, "a window too short was sent");
      // Put it back, so nothing below depends on it
      await paneDot("Settings").click();
      await from.waitFor();
      await from.fill("09:00");
      await until(
        () => Promise.resolve(sent("09:00") === 1),
        "the window put back",
      );
      await paneDot("Check-in").click();
      await now.waitFor();

      // 6. Its name, in every language; the pointer cursor
      assertEquals(await wordmark.getAttribute("aria-label"), "Emo — Check-in");
      await page.getByRole("button", { name: "Emo — Check-in", exact: true })
        .waitFor();
      assertEquals(
        await wordmark.evaluate((el) => getComputedStyle(el).cursor),
        "pointer",
      );
      await paneDot("Settings").click();
      await settings.waitFor();
      await page.getByRole("radio", { name: "Русский" }).click();
      await until(
        async () =>
          (await wordmark.getAttribute("aria-label")) === "Emo — Запись",
        "ru name",
      );
      await page.getByRole("radio", { name: "Українська" }).click();
      await until(
        async () =>
          (await wordmark.getAttribute("aria-label")) === "Emo — Запис",
        "uk name",
      );
      await page.getByRole("radio", { name: "English" }).click();
      await until(
        async () =>
          (await wordmark.getAttribute("aria-label")) === "Emo — Check-in",
        "en name",
      );

      // 9. The check-in has no wordmark and no pane bar
      await paneDot("Check-in").click();
      await now.click();
      await page.getByText(/^Step 1 of/).waitFor();
      assertEquals(await page.locator(".wordmark").count(), 0);
      assertEquals(await page.locator(".panebar").count(), 0);

      // 7. A closed draft: the wordmark from History lands on Home with
      //    "Continue", and does not reopen it
      await page.locator('[data-null="whole_body"]').click();
      await page.getByRole("button", { name: /^Close/ }).click();
      await page.getByRole("button", { name: "Continue" }).waitFor();
      await paneDot("History").click();
      await historyTitle.waitFor();
      await wordmark.click();
      await page.getByRole("button", { name: "Continue" }).waitFor();
      await page.getByText("A check-in is open.").waitFor();
      await page.waitForTimeout(500);
      assertEquals(path(), "/");
      assertEquals(await page.getByText(/^Step \d of/).count(), 0);
      assertEquals(await count(page, "draft"), 1);
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, []);
  },
});

Deno.test({
  name:
    "e2e - wordmark on Home: the page goes back to where it opens, its reach room out of view",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext(PHONE)).newPage();
      await signUp(page, server);
      await page.getByRole("button", { name: NOW, exact: true }).waitFor();
      const wordmark = page.locator("button.wordmark");
      const top = () => page.evaluate(() => document.body.scrollTop);
      const settlesAt = (want: number) =>
        until(
          async () => Math.abs((await top()) - want) <= 1,
          `the page back at ${want}`,
        );
      const rest = await top();
      assert(rest > 0, `Home opens with its room out of view (${rest})`);

      // At rest a tap leaves the page where it is: no room scrolls into view
      await wordmark.click();
      await page.waitForTimeout(800);
      assertEquals(await top(), rest);

      // Pulled down into the room, a tap brings it back to where it opens
      await page.evaluate(() => document.body.scrollTo({ top: 0 }));
      await settlesAt(0);
      await wordmark.click();
      await settlesAt(rest);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
