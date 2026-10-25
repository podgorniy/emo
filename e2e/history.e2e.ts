// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The History pane (ui.md §15.19) in the compiled app: the third
 * pane and its routes; rows with no valence, arousal, word or count; an open
 * record; delete as a tombstone (offline too) that reaches another device
 * and another tab; hidden while a check-in is in progress; pages of whole
 * days; the unsynced ring; the unreadable note; and no plaintext left
 * anywhere once it is locked.
 */
import { assert, assertEquals } from "@std/assert";
import type { BrowserContext, Page } from "playwright-core";
import {
  auditA11y,
  type E2eServer,
  EMAIL,
  launchBrowser,
  NOW,
  openAppearance,
  PASSPHRASE,
  seedCheckIns,
  signUp,
  startServer,
} from "./harness.ts";

const PHONE = { locale: "en-GB", viewport: { width: 390, height: 844 } };

/** Rows (h3) and days (h2) on screen */
const rows = (page: Page) => page.locator("main h3");
const days = (page: Page) => page.locator("main h2");

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

/** Every value of a store, as stored */
function dump(page: Page, store: string): Promise<unknown[]> {
  return page.evaluate((store) =>
    new Promise<unknown[]>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction(store).objectStore(store).getAll();
        all.onsuccess = () => {
          db.close();
          resolve(all.result);
        };
      };
    }), store);
}

async function until(fn: () => Promise<boolean>, what: string) {
  const end = Date.now() + 15_000;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const synced = async (page: Page) =>
  await until(async () => (await count(page, "outbox")) === 0, "outbox empty");

/** The History pane from Home: its dot on a phone, its tab on a desktop */
async function openHistory(page: Page) {
  await page.getByRole("button", { name: "History", exact: true }).first()
    .click();
  await page.getByRole("heading", { level: 1, name: "History" }).waitFor();
}

/** A second device signing in to the account `signUp` made */
async function signIn(context: BrowserContext, server: E2eServer) {
  const page = await context.newPage();
  await page.goto(server.url);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.getByLabel("Six-digit code").fill(await server.mailCode(EMAIL));
  // A browser that did not hold the account (ui.md §12)
  await page.getByRole("heading", { level: 1, name: "New device" }).waitFor();
  await page.locator('input[type="password"]').first().fill(PASSPHRASE);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: NOW }).waitFor({ timeout: 30_000 });
  return page;
}

const SKIPPED = {
  skipped: true,
  untouched: null,
  body: null,
  affect: null,
  urge: null,
  head_mode: null,
  context_tag: null,
  note: null,
};

Deno.test({
  name: "e2e - History: the third pane, rows, a record, delete",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext(PHONE)).newPage();
      const fetched: string[] = [];
      page.on("request", (r) => fetched.push(new URL(r.url()).pathname));
      await signUp(page, server);
      const path = () => new URL(page.url()).pathname;
      const now = page.getByRole("button", { name: NOW });
      const historyTitle = page.getByRole("heading", { name: "History" });

      // Three dots: Check-in · History · Settings (owner decision 2026-10-09)
      assertEquals(
        await page.locator("nav.dots button").evaluateAll((b) =>
          b.map((el) => el.getAttribute("aria-label"))
        ),
        ["Check-in", "History", "Settings"],
      );
      // Home ↔ Settings is direct: the dots, the long press, Esc and Back
      // never mount History (its chunk is not even fetched)
      const settings = page.getByRole("heading", {
        level: 1,
        name: "Settings",
        exact: true,
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await settings.waitFor();
      assertEquals(path(), "/settings");
      await page.keyboard.press("Escape");
      await now.waitFor();
      assertEquals(path(), "/");
      const wordmark = page.locator("button.wordmark");
      await wordmark.dispatchEvent("pointerdown");
      await settings.waitFor({ timeout: 3000 });
      // No back chevron at the top left: the dots at the bottom go Home
      // (ui.md §2.2, v1.9)
      assertEquals(await page.locator(".settings-back").count(), 0);
      await page.getByRole("button", { name: "Check-in", exact: true }).click();
      await now.waitFor();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await settings.waitFor();
      await page.goBack();
      await now.waitFor();
      assertEquals(await historyTitle.count(), 0);
      assertEquals(
        fetched.filter((p) => /^\/assets\/History-/.test(p)),
        [],
        "History mounted on the way between Home and Settings",
      );

      // A step passes it: Home → History → Settings, and back; Back goes Home
      await page.keyboard.press("ArrowRight");
      await historyTitle.waitFor();
      assertEquals(path(), "/history");
      await page.getByText("No check-ins yet").waitFor();
      await page.keyboard.press("ArrowRight");
      await settings.waitFor();
      assertEquals(path(), "/settings");
      await page.keyboard.press("ArrowLeft");
      await historyTitle.waitFor();
      await page.keyboard.press("ArrowLeft");
      await now.waitFor();
      assertEquals(path(), "/");
      await page.keyboard.press("ArrowRight");
      await historyTitle.waitFor();
      await page.keyboard.press("Escape");
      await now.waitFor();
      await page.keyboard.press("ArrowRight");
      await historyTitle.waitFor();
      await page.goBack();
      await now.waitFor();
      assertEquals(path(), "/");
      // The desktop tabs read the same order
      await page.setViewportSize({ width: 1280, height: 800 });
      assertEquals(
        await page.locator("nav.tabs button").allInnerTexts(),
        ["Check-in", "History", "Settings"],
      );
      await page.setViewportSize(PHONE.viewport);

      // Three check-ins, uploaded by the next sync
      await seedCheckIns(page, [
        {
          daysAgo: 0,
          at: "14:10",
          trigger: "after_event",
          note: "call with manager",
          affect: {
            valence: -3,
            arousal: 9,
            word: "fear.anxiety",
            word_confidence: "guess",
          },
        },
        {
          daysAgo: 0,
          at: "09:42",
          untouched: ["head_mode"],
          head_mode: 5,
          urge: null,
          affect: { valence: 0, arousal: 2, word: null, word_confidence: null },
          body: {
            locations: ["nowhere"],
            qualities: ["nothing"],
            intensity: 0,
          },
        },
        { daysAgo: 1, at: "16:30", ...SKIPPED, abandoned: true },
      ], { queued: true });
      await page.reload();
      await now.waitFor();
      await synced(page);

      // A cold start on /history opens it after unlock; Back goes Home
      await page.goto(`${server.url}/history`);
      await historyTitle.waitFor();
      await rows(page).first().waitFor();
      assertEquals(await days(page).allInnerTexts(), ["TODAY", "YESTERDAY"]);
      assertEquals(await rows(page).count(), 3);
      // h1 → h2 per day → h3 per row
      assertEquals(await page.locator("h1").count(), 1);
      // Decrypted in the Worker (performance.md §3.1), no fallback
      assert(
        fetched.some((p) => /^\/assets\/decrypt\.worker-[\w-]+\.js$/.test(p)),
      );
      const diag =
        (await dump(page, "meta") as Array<{ key: string; value: unknown }>)
          .find((m) => m.key === "diag_counts")?.value ?? {};
      assertEquals("decrypt.fallback_main_thread" in (diag as object), false);

      // Rows: an index, never a valence, arousal, word, number or count
      const summaries = await page.locator("main h3 button").allInnerTexts();
      for (const text of summaries) {
        const withoutTime = text.replace(/\d{1,2}:\d{2}( [AP]M)?/, "");
        assert(!/\d/.test(withoutTime), text);
        assert(!/fear|anxiety|guessing|pleasant|charge/i.test(text), text);
      }
      assert(summaries[0].includes("after an event"), summaries[0]);
      assert(summaries[0].includes("“call with manager”"), summaries[0]);
      assert(summaries[1].includes("nowhere — nothing"), summaries[1]);
      assert(summaries[2].includes("Form left open"), summaries[2]);

      // A record: in recorded order, sliders as images named in words
      const first = page.locator("main h3 button").first();
      assertEquals(await first.getAttribute("aria-expanded"), "false");
      await first.click();
      assertEquals(await first.getAttribute("aria-expanded"), "true");
      const record = page.locator(
        `#${await first.getAttribute("aria-controls")}`,
      );
      await record.locator("dl").waitFor();
      assertEquals(
        await record.locator("dt").evaluateAll((d) =>
          d.map((el) => el.firstChild?.textContent?.trim())
        ),
        [
          "BODY",
          "QUALITY",
          "INTENSITY",
          "TONE",
          "CHARGE",
          "WORD",
          "URGE",
          "ATTENTION",
          "SITUATION",
          "NOTE",
        ],
      );
      const tracks = await record.locator("[role=img]").evaluateAll((t) =>
        t.map((el) => el.getAttribute("aria-label") ?? "")
      );
      assertEquals(tracks.length, 4);
      for (const label of tracks) assert(!/\d/.test(label), label);
      assertEquals(await page.locator("meter, progress").count(), 0);

      // The null answers: plain words, same element as any answer
      const second = page.locator("main h3 button").nth(1);
      await second.click();
      const nulls = page.locator(
        `#${await second.getAttribute("aria-controls")}`,
      );
      await nulls.locator("dl").waitFor();
      const text = await nulls.innerText();
      for (const word of ["nowhere", "nothing", "not chosen", "not moved"]) {
        assert(text.includes(word), `${word} in ${text}`);
      }

      // One record at a time (ui.md §15.9): opening the second closed the first
      assertEquals(await first.getAttribute("aria-expanded"), "false");

      // Delete from the first record: the row goes, focus moves on
      const secondId = await second.getAttribute("id");
      await first.click();
      await record.locator("dl").waitFor();
      assertEquals(await second.getAttribute("aria-expanded"), "false");
      await record.getByRole("button", { name: "Delete this check-in" })
        .click();
      const sheet = page.getByRole("dialog");
      await sheet.getByText("Delete this check-in?").waitFor();
      await sheet.getByRole("button", { name: "Delete", exact: true }).click();
      await sheet.waitFor({ state: "detached" });
      assertEquals(await rows(page).count(), 2);
      assertEquals(
        await page.evaluate(() => document.activeElement?.id),
        secondId,
      );
      await page.locator("[aria-live=polite]").filter({
        hasText: "Check-in deleted",
      }).waitFor({ state: "attached" });
      // A tombstone, sent to the server; never a draft
      await synced(page);
      const stored = await dump(page, "entries") as Array<{ deleted: boolean }>;
      assertEquals(stored.filter((e) => e.deleted).length, 1);
      assertEquals(await count(page, "draft"), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name: "e2e - History: an offline delete reaches the other tab and device",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const contextA = await browser.newContext(PHONE);
      const page = await contextA.newPage();
      await signUp(page, server);
      await seedCheckIns(page, [
        { daysAgo: 0, at: "08:00", note: "first" },
        { daysAgo: 0, at: "07:00", note: "second" },
        { daysAgo: 1, at: "21:00", note: "third" },
      ], { queued: true });
      await page.reload();
      await page.getByRole("button", { name: NOW }).waitFor();
      await synced(page);

      // Another device signs in and pulls them
      const other = await signIn(await browser.newContext(PHONE), server);
      await openHistory(other);
      await until(async () => (await rows(other).count()) === 3, "pulled");

      // A second tab of the first device
      const tab = await contextA.newPage();
      await tab.goto(`${server.url}/history`);
      await until(async () => (await rows(tab).count()) === 3, "tab rows");

      // Offline: delete; the other tab hears it at once
      await page.goto(`${server.url}/history`);
      await rows(page).first().waitFor();
      await contextA.setOffline(true);
      await page.locator("main h3 button").first().click();
      await page.getByRole("button", { name: "Delete this check-in" }).click();
      await page.getByRole("dialog").getByRole("button", {
        name: "Delete",
        exact: true,
      }).click();
      assertEquals(await rows(page).count(), 2);
      await until(async () => (await rows(tab).count()) === 2, "broadcast");
      const queued = await dump(page, "outbox") as Array<{ op?: string }>;
      assertEquals(queued.map((o) => o.op), ["delete"]);

      // Back online: sent; the other device loses it after its sync
      await contextA.setOffline(false);
      await synced(page);
      await other.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange"))
      );
      await until(async () => (await rows(other).count()) === 2, "other");
      assert(!(await other.locator("main").innerText()).includes("first"));
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - History: a check-in in progress, pages, the ring, and nothing kept",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext(PHONE);
      const page = await context.newPage();
      await signUp(page, server);
      // "Now", or "Continue" while a check-in is open (ui.md §3)
      const now = page.locator("button.now");

      // Start a check-in, Close: History shows only "in progress"
      await now.click();
      await page.getByText("Step 1 of 9").waitFor();
      await page.getByRole("button", { name: "whole body" }).first().click();
      await page.locator("button.next").click();
      await page.getByText("Step 2 of 9").waitFor();
      await page.getByRole("button", { name: /^Close/ }).click();
      await now.waitFor();
      await openHistory(page);
      await page.getByText("A check-in is in progress.").waitFor();
      assertEquals(await rows(page).count(), 0);
      await page.getByRole("button", { name: "Continue it" }).click();
      await page.getByText("Step 2 of 9").waitFor();
      await page.getByRole("button", { name: /^Close/ }).click();
      await now.waitFor();

      // The form open in another tab: History says so. Closed by the person,
      // it waits there behind "Continue" instead of reopening by itself
      const tab = await context.newPage();
      await tab.goto(server.url);
      await tab.getByRole("button", { name: "Continue" }).click();
      await tab.getByText("Step 2 of 9").waitFor();
      await openHistory(page);
      await page.getByText("A check-in is open in another window.").waitFor();
      await page.getByRole("button", { name: "Go to it" }).waitFor();
      // Skipped there; back in this tab, the list is here again
      await tab.getByRole("button", { name: /^Skip|^Stop here/ }).first()
        .click();
      await tab.getByRole("status", { name: /saved/i }).waitFor();
      await tab.close();
      await until(async () => {
        await page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange"))
        );
        await page.waitForTimeout(200);
        return (await rows(page).count()) > 0;
      }, "the list again");

      // 61 check-ins: the first page is 30, rounded up to a whole day
      const specs = [];
      for (let d = 1; d <= 15; d++) {
        for (const at of ["20:00", "15:00", "11:00", "08:00"]) {
          specs.push({ daysAgo: d, at, note: `day ${d} at ${at}` });
        }
      }
      await seedCheckIns(page, specs);
      await page.goto(`${server.url}/history`);
      await rows(page).first().waitFor();
      assertEquals(await rows(page).count(), 33);
      assertEquals(await days(page).count(), 9);
      assertEquals(await page.getByText("No earlier check-ins").count(), 0);
      await page.getByRole("button", { name: "Show earlier" }).click();
      await until(async () => (await rows(page).count()) === 61, "page 2");
      assertEquals(
        await page.evaluate(() =>
          document.activeElement?.closest("h3") !== null
        ),
        true,
      );
      assertEquals(
        await page.evaluate(() => document.activeElement?.textContent),
        await page.locator("main h3 button").nth(33).textContent(),
      );
      await page.getByText("No earlier check-ins on this device.").waitFor();

      // Saved offline: the ring and "Not synced yet", until the sync
      await context.setOffline(true);
      await seedCheckIns(page, [{ daysAgo: 0, at: "00:01", note: "offline" }], {
        queued: true,
      });
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange"))
      );
      const ring = page.getByRole("img", { name: "Not synced yet" });
      await ring.waitFor();
      await context.setOffline(false);
      await synced(page);
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange"))
      );
      await ring.waitFor({ state: "detached" });

      // A row this device cannot read: one quiet note, not a row
      await page.evaluate(() =>
        new Promise<void>((resolve) => {
          const req = indexedDB.open("emo");
          req.onsuccess = () => {
            const tx = req.result.transaction("entries", "readwrite");
            tx.objectStore("entries").put({
              id: crypto.randomUUID(),
              seq: 9999,
              key_version: 1,
              nonce_b64: "AAAAAAAAAAAAAAAA",
              ct_b64: "AAAA",
              deleted: false,
              received_at: new Date().toISOString(),
              check: "undecryptable",
            });
            tx.oncomplete = () => resolve();
          };
        })
      );
      await page.reload();
      await page.getByText("1 entry could not be decrypted").waitFor();

      // An open record leaves no plaintext behind (ui.md §15.17) …
      await page.locator("main h3 button", { hasText: "day 1 at 20:00" })
        .click();
      await page.locator("main dl").first().waitFor();
      const kept = await page.evaluate(() => ({
        local: JSON.stringify({ ...localStorage }),
        state: JSON.stringify(history.state),
        url: location.href,
        titles: document.querySelectorAll("[title]").length,
      }));
      assert(!kept.local.includes("day 1"), kept.local);
      assert(!kept.state.includes("day 1"), kept.state);
      assertEquals(new URL(kept.url).pathname, "/history");
      assertEquals(new URL(kept.url).search, "");
      assertEquals(kept.titles, 0);
      for (const store of ["entries", "outbox", "meta", "draft", "prefs"]) {
        const text = JSON.stringify(await dump(page, store));
        assert(!text.includes("day 1 at"), `${store} holds plaintext`);
      }

      // … and a lock in another tab closes it
      const settings = await context.newPage();
      await settings.goto(`${server.url}/settings`);
      await settings.getByRole("button", { name: /^Lock on this device/ })
        .click();
      await page.getByRole("button", { name: "Use recovery key" }).waitFor();
      assertEquals(await page.locator(".entry").count(), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

/** Where the BODY row of an open record puts its text and its figure */
interface BodyLayout {
  direction: string;
  dd: DOMRectLike;
  text: DOMRectLike;
  figure: DOMRectLike;
  label: DOMRectLike;
  children: string[];
  orders: string[];
  hidden: string | null;
  svgs: [number, number][];
}
type DOMRectLike = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
};

/**
 * Opens row `n` of the list on screen and measures its BODY row; `shifts`
 * counts layout shifts of the record's own nodes, and any shift not caused
 * by the tap itself, from the tap until it is drawn.
 */
async function openBody(page: Page, n: number) {
  const row = page.locator("main h3 button").nth(n);
  await row.waitFor();
  const id = (await row.getAttribute("aria-controls"))!;
  await page.evaluate((id) => {
    const w = globalThis as unknown as { __shifts: string[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      // deno-lint-ignore no-explicit-any
      for (const e of list.getEntries() as any[]) {
        const record = document.getElementById(id);
        // deno-lint-ignore no-explicit-any
        const inside = (e.sources ?? []).some((s: any) =>
          s.node && record?.contains(s.node)
        );
        if (inside || !e.hadRecentInput) {
          w.__shifts.push(`${e.value} inside=${inside}`);
        }
      }
    }).observe({ type: "layout-shift" });
  }, id);
  if (await row.getAttribute("aria-expanded") === "false") await row.click();
  const record = page.locator(`#${id}`);
  await record.locator("dl dd").first().waitFor();
  await page.waitForTimeout(300);
  const layout: BodyLayout = await record.evaluate((rec) => {
    const box = (el: Element) => {
      const b = el.getBoundingClientRect();
      return {
        top: b.top,
        bottom: b.bottom,
        left: b.left,
        right: b.right,
        width: b.width,
      };
    };
    const dd = rec.querySelector("dd")!;
    const figure = dd.querySelector(".glyph")!;
    return {
      direction: getComputedStyle(dd).flexDirection,
      dd: box(dd),
      text: box(dd.querySelector(".text")!),
      figure: box(figure),
      label: box(rec.querySelector("dt")!),
      children: [...dd.children].map((c) =>
        c.classList.contains("text")
          ? "text"
          : c.classList.contains("glyph")
          ? "figure"
          : c.tagName
      ),
      orders: [...dd.children].map((c) => getComputedStyle(c).order),
      hidden: figure.getAttribute("aria-hidden"),
      svgs: [...figure.querySelectorAll("svg")].map((s) => {
        const b = s.getBoundingClientRect();
        return [Math.round(b.width), Math.round(b.height)] as [number, number];
      }),
    };
  });
  const shifts = await page.evaluate(() =>
    (globalThis as unknown as { __shifts: string[] }).__shifts
  );
  return { layout, shifts };
}

Deno.test({
  name:
    "e2e - History: the body figure under the zones on a phone, beside them when wide",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 360, height: 740 },
      })).newPage();
      await signUp(page, server);
      const body = (locations: string[]) => ({
        body: { locations, qualities: ["squeeze"], intensity: 5 },
      });
      // Newest first: five zones, whole body, nowhere. Not a legacy []: the
      // read path's validator rejects an empty list (shared/entry.ts
      // validateEntryV2), so such a row is listed as unreadable, never drawn
      await seedCheckIns(page, [
        {
          daysAgo: 0,
          at: "12:00",
          ...body(["forehead_eyes", "jaw", "throat", "shoulders", "chest"]),
        },
        { daysAgo: 0, at: "11:00", ...body(["whole_body"]) },
        { daysAgo: 0, at: "10:00", ...body(["nowhere"]) },
      ]);
      const history = async () => {
        await page.goto(`${server.url}/history`);
        await page.locator("#history-title").waitFor();
        await page.locator("main h3 button").first().waitFor();
      };
      const near = (a: number, b: number) => Math.abs(a - b) <= 1;
      const stacked = (at: string, l: BodyLayout) => {
        if (l.direction !== "column") {
          problems.push(`${at}: flex-direction ${l.direction}`);
        }
        if (l.figure.top < l.text.bottom - 0.5) {
          problems.push(
            `${at}: figure top ${l.figure.top} above text bottom ${l.text.bottom}`,
          );
        }
        if (!near(l.figure.left, l.dd.left)) {
          problems.push(
            `${at}: figure left ${l.figure.left}, dd left ${l.dd.left}`,
          );
        }
      };
      const beside = (at: string, l: BodyLayout) => {
        if (l.direction !== "row") {
          problems.push(`${at}: flex-direction ${l.direction}`);
        }
        if (!(l.figure.top < l.text.bottom)) {
          problems.push(
            `${at}: figure top ${l.figure.top}, text bottom ${l.text.bottom}`,
          );
        }
        if (!near(l.figure.right, l.dd.right)) {
          problems.push(
            `${at}: figure right ${l.figure.right}, dd right ${l.dd.right}`,
          );
        }
      };
      const noShift = (at: string, shifts: string[]) => {
        if (shifts.length > 0) {
          problems.push(`${at}: layout shifts ${shifts.join(", ")}`);
        }
      };

      // Phones, in a short and a long language: stacked, figure on the left
      for (const language of ["English", "Русский"]) {
        if (language !== "English") {
          await page.goto(`${server.url}/settings`);
          await page.getByRole("radio", { name: language }).click();
          await page.waitForTimeout(300);
        }
        for (
          const size of [{ width: 360, height: 740 }, {
            width: 320,
            height: 568,
          }]
        ) {
          await page.setViewportSize(size);
          await history();
          const at = `${language} ${size.width}×${size.height}`;
          const { layout, shifts } = await openBody(page, 0);
          stacked(at, layout);
          noShift(at, shifts);
        }
      }
      await page.goto(`${server.url}/settings`);
      await page.getByRole("radio", { name: "English" }).click();
      await page.waitForTimeout(300);

      // Text first, then the figure, in the DOM and on screen; the figure is
      // hidden from assistive technology (the zone list says the same)
      await page.setViewportSize({ width: 360, height: 740 });
      await history();
      const phone = (await openBody(page, 0)).layout;
      assertEquals(phone.children, ["text", "figure"]);
      assertEquals(phone.orders, ["0", "0"]);
      assertEquals(phone.hidden, "true");
      // whole body and nowhere draw as before
      for (const n of [1, 2]) {
        const { layout } = await openBody(page, n);
        assertEquals(layout.svgs, [[44, 88], [44, 88]], `row ${n}`);
        stacked(`row ${n} 360×740`, layout);
      }

      // A desktop: beside the text, on the right, labels 140 px (unchanged)
      await page.setViewportSize({ width: 1280, height: 800 });
      await history();
      const wide = await openBody(page, 0);
      beside("1280×800", wide.layout);
      noShift("1280×800", wide.shifts);
      if (!near(wide.layout.label.width, 140)) {
        problems.push(`1280×800: label column ${wide.layout.label.width}px`);
      }
      assertEquals(wide.layout.svgs, [[44, 88], [44, 88]]);

      // A small window still has room: the record is at least 26rem wide
      await page.setViewportSize({ width: 600, height: 800 });
      await history();
      beside("600×800", (await openBody(page, 0)).layout);

      // Doubled text: the same window stacks, because rem scales
      await page.setViewportSize({ width: 1280, height: 800 });
      await history();
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "32px"),
      );
      await page.waitForTimeout(100);
      stacked("1280×800 at 32px", (await openBody(page, 0)).layout);
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));

      // Every theme: an open record passes axe and the 44 px targets
      await page.setViewportSize({ width: 360, height: 740 });
      for (let i = 0; i < 10; i++) {
        await page.goto(`${server.url}/settings`);
        await (await openAppearance(page)).getByRole("radio").nth(i).click();
        await page.waitForTimeout(200);
        await history();
        await openBody(page, 0);
        for (const line of await auditA11y(page)) {
          problems.push(`theme ${i + 1}: ${line}`);
        }
      }
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, []);
  },
});
