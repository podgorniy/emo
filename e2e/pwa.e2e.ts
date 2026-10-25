// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The PWA shell (ui.md §4, §5.3, §16.2) in the compiled app: no
 * over-the-border scroll (the page stops at its edges, every inner scroller
 * contains its own), pinch-zoom on the panes, buttons that neither zoom on a
 * double tap nor select, a column that never shifts by a scrollbar, inputs at
 * 16 px or more, a sheet whose Close is always on screen, the manifest's
 * shortcut, and a reminder tap that opens the check-in from any pane
 * (ui.md §15.2).
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  launchBrowser,
  nextStep,
  NOW,
  seedCheckIns,
  signUp,
  startServer,
} from "./harness.ts";

const PHONE = { locale: "en-GB", viewport: { width: 375, height: 667 } };

async function waitStep(page: Page, n: number) {
  await page.getByText(new RegExp(`^Step ${n} of \\d+$`)).waitFor();
}

/** Opens a pane by its route and waits for its heading (Home: Now) */
async function open(page: Page, url: string, path: string) {
  await page.goto(url + path);
  await page.locator(
    path === "/"
      ? "button.now"
      : path === "/history"
      ? "#history-title"
      : "h1.settings-title",
  ).waitFor();
  await page.waitForTimeout(100);
}

/** `html` and `body` both stop at their edges: no bounce, no pull-to-refresh */
async function rootOverscroll(page: Page, at: string): Promise<string[]> {
  const values = await page.evaluate(() =>
    [document.documentElement, document.body].map((el) =>
      getComputedStyle(el).overscrollBehaviorY
    )
  );
  return values[0] === "none" && values[1] === "none"
    ? []
    : [`${at}: html/body overscroll-behavior-y ${values.join(" / ")}`];
}

/** Every element that scrolls vertically contains its scroll */
async function scrollerSweep(page: Page, at: string): Promise<string[]> {
  const leaks = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const s = getComputedStyle(el);
      if (s.overflowY !== "auto" && s.overflowY !== "scroll") continue;
      if (s.overscrollBehaviorY !== "auto") continue;
      const cls = typeof el.className === "string" && el.className
        ? `.${el.className.trim().split(/\s+/).join(".")}`
        : "";
      out.push(
        `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}>`,
      );
    }
    return out;
  });
  return leaks.map((l) => `${at}: ${l} scrolls without overscroll-behavior`);
}

/**
 * Buttons: `touch-action: manipulation` and no selection; Home's Now
 * `pinch-zoom`, as a drag there carries its bead (ui.md §4); the
 * pane root still lets the page pan and pinch-zoom.
 */
async function touch(page: Page, at: string, root?: string): Promise<string[]> {
  return await page.evaluate(({ at, root }) => {
    const out: string[] = [];
    if (root) {
      const el = document.querySelector(root);
      const value = el ? getComputedStyle(el).touchAction : "missing";
      if (!/pinch-zoom/.test(value)) {
        out.push(`${at}: ${root} touch-action ${value}`);
      }
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>("button")) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(b);
      const action = b.matches("button.now") ? "pinch-zoom" : "manipulation";
      if (s.touchAction !== action || s.userSelect !== "none") {
        const name = b.getAttribute("aria-label") ??
          b.textContent?.trim().slice(0, 30);
        out.push(
          `${at}: button "${name}" touch-action ${s.touchAction}, user-select ${s.userSelect}`,
        );
      }
    }
    return out;
  }, { at, root });
}

/** Every visible field at 16 px or more, so iOS never zooms on focus */
async function fieldSizes(page: Page, at: string): Promise<string[]> {
  return await page.evaluate((at) => {
    const out: string[] = [];
    for (
      const el of document.querySelectorAll<HTMLElement>("input, textarea")
    ) {
      if ((el as HTMLInputElement).type === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) {
        out.push(
          `${at}: <${el.tagName.toLowerCase()}${
            el.id ? `#${el.id}` : ""
          }> ${size}px`,
        );
      }
    }
    return out;
  }, at);
}

/** A reminder's tap as the service worker reports it to an open window */
function reminderTap(page: Page) {
  return page.evaluate((url) => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "open-url", url } }),
    );
  }, `/now?reminder=${crypto.randomUUID()}`);
}

Deno.test({
  name: "e2e - PWA shell: overscroll, touch, gutter, fields, sheet, manifest",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    try {
      const context = await browser.newContext(PHONE);
      const page = await context.newPage();
      // The sign-in email, the code and the passphrase fields on the way in
      await signUp(page, server, async (name) => {
        problems.push(...await fieldSizes(page, name));
      });

      // 7. The manifest: the "Check in now" shortcut, a manual check-in
      const manifest = await (await page.request.get(
        `${server.url}/manifest.webmanifest`,
      )).json();
      assertEquals(manifest.id, "/");
      assertEquals(manifest.shortcuts?.[0]?.url, "/now");
      assertEquals(manifest.shortcuts?.[0]?.name, "Check in now");
      // Its icons and the page's carry the file's hash, so a new icon changes
      // the manifest (ui.md §16.2), and each is served as itself
      const pageIcons = await page.locator(
        'link[rel="icon"], link[rel="apple-touch-icon"]',
      ).evaluateAll((links) => links.map((l) => l.getAttribute("href")!));
      for (
        const src of [
          ...manifest.icons.map((i: { src: string }) => i.src),
          ...pageIcons,
        ]
      ) {
        assert(/\?v=[0-9a-f]{8}$/.test(src), `icon ${src} has no hash`);
        const icon = await page.request.get(`${server.url}${src}`);
        assertEquals(icon.status(), 200, src);
        assert(icon.headers()["content-type"].startsWith("image/"), src);
      }

      // A record to open in History
      await seedCheckIns(page, [{ daysAgo: 0, at: "08:00", note: "kitchen" }]);

      // 1–3. The panes: the page stops at its edges, scrollers contain
      // theirs, the pane root pinch-zooms, buttons neither zoom nor select
      for (const path of ["/", "/history", "/settings"]) {
        await open(page, server.url, path);
        problems.push(...await rootOverscroll(page, path));
        problems.push(...await scrollerSweep(page, path));
        problems.push(
          ...await touch(
            page,
            path,
            path === "/" ? ".home" : ".settings-container",
          ),
        );
      }

      // 3. An open record's text stays selectable
      await open(page, server.url, "/history");
      const row = page.locator("main h3 button").first();
      await row.click();
      const record = page.locator(
        `#${await row.getAttribute("aria-controls")}`,
      );
      await record.locator("dl").waitFor();
      const ddSelect = await record.locator("dd").first().evaluate((el) =>
        getComputedStyle(el).userSelect
      );
      if (ddSelect === "none") {
        problems.push("history: record text user-select none");
      }
      problems.push(...await scrollerSweep(page, "history, record open"));

      // 5. Settings: the reminder window's time fields
      await open(page, server.url, "/settings");
      problems.push(...await fieldSizes(page, "settings"));

      // 2, 6. An open sheet: its body is the scroller, Close always on screen
      const howTo = page.getByRole("button", {
        name: "How to allow",
        exact: true,
      });
      if (await howTo.isVisible()) await howTo.click();
      else {
        await page.getByRole("button", {
          name: "Export: JSONL, CSV, encrypted copy",
          exact: true,
        }).click();
      }
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      problems.push(...await scrollerSweep(page, "sheet"));
      const fit = await page.evaluate(() => {
        const s = document.querySelector<HTMLElement>(".sheet")!;
        return {
          max: parseFloat(getComputedStyle(s).maxHeight),
          limit: 0.9 * innerHeight,
          height: innerHeight,
          width: innerWidth,
        };
      });
      if (!(fit.max <= fit.limit + 0.5)) {
        problems.push(`sheet max-height ${fit.max}px > 90% of ${fit.height}px`);
      }
      const close = await sheet.getByRole("button", {
        name: "Close",
        exact: true,
      })
        .boundingBox();
      if (
        !close || close.y < 0 || close.x < 0 ||
        close.y + close.height > fit.height || close.x + close.width > fit.width
      ) {
        problems.push(`sheet Close off screen: ${JSON.stringify(close)}`);
      }
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "detached" });

      // 1–3, 5. The check-in: steps 2 and 9, the "other" field and the note
      await page.goto(`${server.url}/now`);
      await waitStep(page, 1);
      problems.push(...await rootOverscroll(page, "/now"));
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      problems.push(...await scrollerSweep(page, "/now step 2"));
      problems.push(...await touch(page, "/now step 2"));
      await page.locator('[data-null="nothing"]').click();
      for (let n = 3; n <= 9; n++) {
        await nextStep(page);
        await waitStep(page, n);
      }
      await page.getByRole("button", { name: "other", exact: true }).click();
      await page.locator("#context-other").waitFor();
      problems.push(...await scrollerSweep(page, "/now step 9"));
      problems.push(...await fieldSizes(page, "/now step 9"));
      const noteSelect = await page.locator("textarea#note").evaluate((el) =>
        getComputedStyle(el).userSelect
      );
      if (noteSelect === "none") {
        problems.push("/now step 9: note user-select none");
      }
      await page.getByRole("button", { name: /^Close/ }).click();
      // Home: "Continue" now stands where Now was (ui.md §3)
      await page.locator("button.now").waitFor();

      // 4. A desktop: the gutter is kept, so the column never shifts between
      // Home (no scroll) and Settings (scrolls)
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, server.url, "/");
      const gutter = await page.evaluate(() =>
        getComputedStyle(document.body).scrollbarGutter
      );
      if (!/stable/.test(gutter)) {
        problems.push(`body scrollbar-gutter ${gutter}`);
      }
      const homeX = await page.locator(".wordmark").evaluate((el) =>
        el.getBoundingClientRect().x
      );
      await open(page, server.url, "/settings");
      const scrolls = await page.evaluate(() =>
        document.body.scrollHeight > document.body.clientHeight
      );
      assert(scrolls, "Settings should scroll at 1280×800");
      const settingsX = await page.locator(".wordmark").evaluate((el) =>
        el.getBoundingClientRect().x
      );
      if (Math.abs(homeX - settingsX) > 0.5) {
        problems.push(`wordmark x ${homeX} on Home, ${settingsX} on Settings`);
      }
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, []);
  },
});

Deno.test({
  name: "e2e - a reminder tap opens the check-in from History and Settings",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    try {
      const page = await (await browser.newContext(PHONE)).newPage();
      await signUp(page, server);
      // An older check-in made without a reminder, so the newest row tells
      await seedCheckIns(page, [
        { daysAgo: 1, at: "08:00", trigger: "manual", note: "kitchen" },
      ]);
      const now = page.getByRole("button", { name: NOW });
      const done = page.getByRole("button", { name: "Done", exact: true });

      /** The newest row's metadata line, its record opened */
      const newestMeta = async () => {
        await open(page, server.url, "/history");
        const row = page.locator("main h3 button").first();
        await row.click();
        const record = page.locator(
          `#${await row.getAttribute("aria-controls")}`,
        );
        return await record.locator(".meta").innerText();
      };

      for (const path of ["/history", "/settings"]) {
        await open(page, server.url, path);
        if (path === "/history") {
          // An open record: past answers on screen when the reminder comes
          const row = page.locator("main h3 button").first();
          await row.click();
          await page.locator("main dl").first().waitFor();
        }
        await reminderTap(page);
        // Straight into the form; the pane and its rows are gone
        await waitStep(page, 1);
        if (await page.locator("#history-title").count() > 0) {
          problems.push(`${path}: History still mounted`);
        }
        if (await page.locator("main dl").count() > 0) {
          problems.push(`${path}: a record still in the DOM`);
        }
        if (await page.locator("h1.settings-title").count() > 0) {
          problems.push(`${path}: Settings still mounted`);
        }
        // Skipped: still a reminder's check-in (trigger random)
        await page.getByRole("button", { name: "Skip check-in" }).click();
        await done.click();
        await now.waitFor();
        const meta = await newestMeta();
        if (!meta.includes("From a reminder")) {
          problems.push(`${path}: newest record reads "${meta}"`);
        }
      }

      // An open form keeps its own: the same step, the same answers
      await page.goto(`${server.url}/now`);
      await waitStep(page, 1);
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      const tight = page.getByRole("button", { name: "tight", exact: true });
      await tight.click();
      assertEquals(await tight.getAttribute("aria-pressed"), "true");
      await reminderTap(page);
      await page.waitForTimeout(500);
      if (await page.getByText(/^Step 2 of \d+$/).count() !== 1) {
        problems.push("/now: the step changed after a reminder tap");
      }
      if (await tight.getAttribute("aria-pressed") !== "true") {
        problems.push("/now: an answer changed after a reminder tap");
      }
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, []);
  },
});
