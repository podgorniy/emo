// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The check-in flow in the compiled app (ui.md §5–§7): a quick
 * second tap never skips a question (ui.md §5.1); every null answer of steps 1, 2
 * and 6 is on screen and tappable without scrolling on a small phone, a
 * phone under Safari's toolbars, the reference phone and a desktop, in
 * English, Russian and Ukrainian, with the help link (principle 4, ui.md §6.5);
 * leaving is visible and reversible — Close keeps the check-in on Home and
 * never reopens it by itself, a self-started form closed untouched leaves
 * nothing, and Stop here / Skip it keep the answers given so far (ui.md §6.2).
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
import {
  BODY_ZONES,
  type Locale,
  WORD_CONFIDENCE,
  WORDS,
} from "../shared/dictionaries.ts";
import type { MessageKey } from "../shared/i18n/keys.ts";
import { t as translate } from "../shared/i18n/format.ts";

/** The rows of a store of this browser's database */
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

/** "Step 3 of 9" → 3 */
async function stepNumber(page: Page): Promise<number> {
  const text = await page.locator(".head .counter").textContent();
  return Number(/Step (\d+) of/.exec(text ?? "")?.[1]);
}

async function waitStep(page: Page, n: number) {
  await page.getByText(new RegExp(`^Step ${n} of \\d+$`)).waitFor();
}

/**
 * Whether the element's centre is inside the viewport and a tap there
 * reaches it (not the footer, not something scrolled over it).
 */
function tappable(page: Page, selector: string, text?: string) {
  return page.evaluate(([selector, text]) => {
    const all = [...document.querySelectorAll<HTMLElement>(selector)];
    const el = text === undefined
      ? all[0]
      : all.find((b) => b.textContent?.trim() === text);
    if (!el) return `missing: ${selector} ${text ?? ""}`;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) {
      return `off screen at ${Math.round(x)},${Math.round(y)}`;
    }
    const hit = document.elementFromPoint(x, y);
    return hit && el.contains(hit)
      ? "ok"
      : `covered by <${hit?.tagName.toLowerCase()}.${hit?.className}>`;
  }, [selector, text] as const);
}

Deno.test({
  name: "e2e - check-in: a double tap on Next moves one step, never two",
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
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      await page.locator('[data-null="nothing"]').click();
      await nextStep(page);
      await waitStep(page, 3);
      // The sliders pressed once on the way to step 6 and back, so steps
      // 3–5 are answered: Next is enabled on each as it arrives
      for (let n = 4; n <= 6; n++) {
        await nextStep(page);
        await waitStep(page, n);
      }
      await page.locator("h1").focus();
      for (let n = 5; n >= 3; n--) {
        await page.keyboard.press("ArrowLeft");
        await waitStep(page, n);
      }

      // Two taps 60 ms apart, then 250 ms apart, on answered steps
      await page.waitForTimeout(400);
      const box = (await page.locator("button.next").boundingBox())!;
      const tapNext = () =>
        page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      for (const gap of [60, 250]) {
        const before = await stepNumber(page);
        await tapNext();
        await page.waitForTimeout(gap);
        await tapNext();
        await waitStep(page, before + 1);
        await page.waitForTimeout(400);
        assertEquals(await stepNumber(page), before + 1, `${gap} ms apart`);
      }
      // The same through the keyboard: → twice
      await page.locator("h1").focus();
      const before = await stepNumber(page);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(400);
      assertEquals(await stepNumber(page), before + 1, "→ →");
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

/** The number in the step counter, in any language */
function stepIn(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number(
      /\d+/.exec(document.querySelector(".head .counter")?.textContent ?? "")
        ?.[0],
    )
  );
}

async function waitStepIn(page: Page, n: number) {
  await page.waitForFunction(
    (n) =>
      /\d+/.exec(document.querySelector(".head .counter")?.textContent ?? "")
        ?.[0] === String(n),
    n,
  );
}

const LANGUAGE: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  uk: "Українська",
};

/**
 * Every null answer of steps 1, 2 and 6 is tappable without scrolling, with
 * the help link at the end of the hint (ui.md §6.5), in the
 * given language: its labels come from the dictionaries.
 */
async function nullVisibility(locale: Locale) {
  const server = await startServer();
  const browser = await launchBrowser();
  const problems: string[] = [];
  const t = (key: MessageKey) => translate(locale, key);
  const zone = (key: string) =>
    BODY_ZONES.find((z) => z.key === key)!.label[locale];
  const word = (key: string) => WORDS.find((w) => w.key === key)!.label[locale];
  const cantSay = WORD_CONFIDENCE.find((c) => c.key === "unknown")!
    .label[locale];
  try {
    const context = await browser.newContext({
      locale: "en-GB",
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await signUp(page, server);
    if (locale !== "en") {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("radio", { name: LANGUAGE[locale] }).click();
      await page.getByText(t("settings.language.header")).waitFor();
    }
    const sizes = [
      { width: 375, height: 667 },
      { width: 390, height: 664 },
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ];
    const check = async (where: string, sel: string, text?: string) => {
      const result = await tappable(page, sel, text);
      if (result !== "ok") {
        problems.push(`${where}: ${text ?? sel} ${result}`);
      }
    };
    const link = async (where: string, want: string | null) => {
      const got = (await page.locator("button.help-link").allTextContents())
        .map((l) => l.trim()).join();
      if (got !== (want ?? "")) problems.push(`${where}: help link "${got}"`);
    };
    for (const size of sizes) {
      await page.setViewportSize(size);
      const at = `${locale} ${size.width}×${size.height}`;
      await page.goto(server.url);
      await page.locator("button.now").click();
      await waitStepIn(page, 1);
      await link(`${at} step 1`, null);
      // Step 1, also with a long summary and the back view
      for (const z of ["chest", "throat", "jaw", "belly", "lower_belly"]) {
        await page.getByRole("button", { name: zone(z), exact: true }).first()
          .click();
      }
      await page.waitForTimeout(200);
      await check(`${at} step 1`, '[data-null="whole_body"]');
      await check(`${at} step 1`, '[data-null="nowhere"]');
      await page.locator('[data-null="nowhere"]').click();
      await nextStep(page);
      await waitStepIn(page, 2);
      await link(`${at} step 2`, t("checkin.help.words"));
      await check(`${at} step 2`, '[data-null="nothing"]');
      await check(`${at} step 2`, '[data-null="cant_tell"]');
      await page.locator('[data-null="cant_tell"]').click();
      for (let n = 3; n <= 6; n++) {
        await nextStep(page);
        await waitStepIn(page, n);
      }
      await link(`${at} step 6`, t("checkin.help.words"));
      await check(`${at} step 6`, "main button", word("empty"));
      await check(`${at} step 6`, "main button", word("unknown"));
      // With a word chosen, the greyed Next brings its certainty into view
      await page.getByRole("button", { name: word("joy"), exact: true })
        .click();
      await page.waitForTimeout(360);
      await page.locator("button.next").click({ force: true });
      await page.getByText(t("checkin.step.6.confidence.ask")).waitFor();
      await page.waitForTimeout(500); // the smooth scroll
      await check(`${at} step 6 asked`, "main button", cantSay);
      assertEquals(await stepIn(page), 6, `${at}: Next waited`);
      // A fresh form for the next size
      await page.getByRole("button", { name: t("checkin.stopHere") }).click();
      await page.getByRole("status", { name: t("checkin.saved.aria") })
        .waitFor();
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  assertEquals(problems, []);
}

for (const locale of ["en", "ru", "uk"] as const) {
  Deno.test({
    name:
      `e2e - check-in: null answers are on screen without scrolling, with the help link (${locale}; 375×667, 390×664, 390×844, 1280×800)`,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: () => nullVisibility(locale),
  });
}

Deno.test({
  name:
    "e2e - check-in: Close keeps it on Home without reopening it; Stop here and Skip it keep the answers",
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
      const path = () => new URL(page.url()).pathname;
      const now = page.locator("button.now");
      const close = page.getByRole("button", {
        name: "Close — you can continue later",
      });

      // Opened by mistake and closed untouched: nothing kept, Home as before
      await now.click();
      await waitStep(page, 1);
      await close.click();
      await page.getByRole("button", { name: NOW }).waitFor();
      assertEquals(await count(page, "draft"), 0);
      assertEquals(await page.getByText("A check-in is open.").count(), 0);

      // Answered, then Close: Home says so and offers Continue / Skip it
      await now.click();
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      // The header: × at the left, "Stop here" from step 2 on
      await page.getByRole("button", { name: "Stop here" }).waitFor();
      assertEquals(await page.getByText("Skip check-in").count(), 0);
      await close.click();
      await page.getByRole("button", { name: "Continue" }).waitFor();
      await page.getByText("A check-in is open.").waitFor();
      assertEquals(await page.getByText("after an event").count(), 0);

      // An app start does not reopen a check-in the person closed, also when
      // it starts on /now (a restored tab)
      await page.waitForURL(`${server.url}/`);
      await page.goto(`${server.url}/now`);
      await page.getByRole("button", { name: "Continue" }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Continue" }).waitFor();
      await page.waitForTimeout(500);
      assertEquals(path(), "/");

      // Continue reopens it on its step; a reload (not a Close) resumes it
      await page.getByRole("button", { name: "Continue" }).click();
      await waitStep(page, 2);
      await page.reload();
      await waitStep(page, 2);
      assertEquals(path(), "/now");

      // Browser Back leaves like Close: it waits on Home
      await page.goBack();
      await page.getByRole("button", { name: "Continue" }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Continue" }).waitFor();
      assertEquals(path(), "/");

      // Skip it: saved as skipped with the zone answered, Undo offered
      await page.getByRole("button", { name: "Skip it" }).click();
      await page.getByRole("button", { name: NOW }).waitFor();
      await page.getByRole("button", { name: "Undo" }).waitFor();
      assertEquals(await count(page, "draft"), 0);

      // Stop here on step 3: zones and qualities kept, nothing after them
      await now.click();
      await waitStep(page, 1);
      await page.getByRole("button", { name: "chest", exact: true }).click();
      await nextStep(page);
      await waitStep(page, 2);
      await page.getByRole("button", { name: "tight", exact: true }).click();
      await nextStep(page);
      await waitStep(page, 3);
      await page.getByRole("button", { name: "Stop here" }).click();
      await page.getByRole("status", { name: /saved/i }).waitFor();

      // History: both under "Skipped", with what was answered
      await page.goto(`${server.url}/history`);
      const rows = page.locator("main h3 button");
      await rows.first().waitFor();
      assertEquals(await rows.count(), 2);
      await rows.first().click();
      const record = page.locator("main .record").first();
      await record.getByText("Skipped").waitFor();
      await record.getByText("chest").first().waitFor();
      await record.getByText("tight").waitFor();
      const labels = await record.locator("dt").allTextContents();
      assertEquals(labels.map((l) => l.trim()), ["BODY", "QUALITY"]);
      // One record at a time (ui.md §15.9): this closes the first,
      // so the second is found by its own id, not by its place
      await rows.nth(1).click();
      const second = page.locator(
        `#${await rows.nth(1).getAttribute("aria-controls")} .record`,
      );
      await second.getByText("Skipped").waitFor();
      assertEquals(
        (await second.locator("dt").allTextContents()).map((l) => l.trim()),
        ["BODY"],
      );

      // From a reminder, closed untouched: kept (compliance data)
      await page.goto(
        `${server.url}/now?reminder=0192f1c4-7b43-7000-8000-0000000000aa`,
      );
      await waitStep(page, 1);
      await close.click();
      await page.getByRole("button", { name: "Continue" }).waitFor();
      assertEquals(await count(page, "draft"), 1);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - Saved: the same orienting line for every check-in; Done or a tap returns home to Now; the toast stays above the dots, the quiet lines wait under it",
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
      const now = page.getByRole("button", { name: NOW });
      const line = page.getByText("You can go back to what you were doing.");

      // Skipped on step 1: the same screen; Done returns home at once
      await now.click();
      await waitStep(page, 1);
      await page.getByRole("button", { name: "Skip check-in" }).click();
      await line.waitFor();
      const started = Date.now();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await now.waitFor();
      assertEquals(Date.now() - started < 2000, true, "Done waited");
      // Focus lands on Now (ui.md §5.5)
      assertEquals(
        await page.evaluate(() =>
          document.activeElement?.classList.contains("now")
        ),
        true,
      );
      // The Undo toast sits above the pane dots, never over them
      await page.waitForTimeout(400); // its slide-in
      const toast = await page.locator(".toast-container").boundingBox();
      const dots = await page.locator("nav.dots").boundingBox();
      assertEquals(
        toast!.y + toast!.height <= dots!.y,
        true,
        "toast over dots",
      );
      // The quiet line it would cover ("Reminders aren't reaching this
      // device") waits under it, its room kept, and is back once it goes
      const quiet = page.locator("footer.bottom");
      const seen = () =>
        quiet.evaluate((el) => getComputedStyle(el).visibility);
      assertEquals(await quiet.locator(".line").count() > 0, true, "a line");
      assertEquals(await seen(), "hidden", "the line under the toast");
      await page.locator(".toast-container .close-btn").click();
      await page.locator(".toast-container").waitFor({ state: "detached" });
      await quiet.evaluate((el) =>
        new Promise<void>((resolve, reject) => {
          const end = Date.now() + 2000;
          const check = () => {
            if (getComputedStyle(el).visibility === "visible") resolve();
            else if (Date.now() > end) {
              reject(new Error("the line after the toast"));
            } else requestAnimationFrame(check);
          };
          check();
        })
      );

      // Stopped with answers: the same line; a tap anywhere returns home
      await now.click();
      await page.locator('[data-null="nowhere"]').click();
      await nextStep(page);
      await waitStep(page, 2);
      await page.getByRole("button", { name: "Stop here" }).click();
      await line.waitFor();
      await page.mouse.click(195, 120);
      await now.waitFor({ timeout: 2000 });
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - nine screens: the note under the situation, never focused; single sliders low, with their question",
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
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await page.locator('[data-null="nothing"]').click();
      await nextStep(page);
      await waitStep(page, 3);
      // A single slider and its question are one group at the bottom, just
      // above the footer, where the thumb rests; the space left is above
      const zone = await page.evaluate(() => {
        const box = (q: string) =>
          document.querySelector(q)!.getBoundingClientRect();
        const slider = box(".slider");
        return {
          gap: box("footer.foot").top - slider.bottom,
          question: slider.top - box("main h1").bottom,
          centre: slider.top + slider.height / 2,
          height: innerHeight,
        };
      });
      assert(
        zone.gap >= 0 && zone.gap < 48 && zone.question < 120 &&
          zone.centre > zone.height * 0.7,
        JSON.stringify(zone),
      );
      // Next waits for a touch; a press where the thumb is lights it there,
      // as the null body's hint asks (ui.md §6.2, §6.9)
      const range = page.locator("main input[type=range]");
      const next = page.locator("button.next");
      await page.getByText("Nothing to rate? Tap the slider where it is.")
        .waitFor();
      assertEquals(await next.isDisabled(), true);
      await range.click();
      await page.locator("main .slider:not(.untouched)").waitFor();
      assertEquals([await range.inputValue(), await next.isDisabled()], [
        "5",
        false,
      ]);
      await nextStep(page);
      await waitStep(page, 4);
      // From the keyboard: Space is the same press
      assertEquals(await next.isDisabled(), true);
      await range.focus();
      await page.keyboard.press("Space");
      await page.locator("main .slider:not(.untouched)").waitFor();
      assertEquals([await range.inputValue(), await next.isDisabled()], [
        "0",
        false,
      ]);
      for (let n = 5; n <= 9; n++) {
        await nextStep(page);
        await waitStep(page, n);
      }
      // The last screen: situation and the note, "Save"; the heading has
      // focus, not the note (no keyboard by itself)
      await page.getByText("Step 9 of 9").waitFor();
      await page.getByLabel("One fact, one line").waitFor();
      await page.waitForTimeout(400);
      assertEquals(
        await page.evaluate(() => document.activeElement?.tagName),
        "H1",
      );
      const save = page.locator("button.next");
      assertEquals((await save.textContent())?.trim(), "Save");
      assertEquals(await save.isDisabled(), true); // no situation yet
      // "other": its field takes focus once (D14); typing in the note then
      // keeps the focus in the note
      await page.getByRole("button", { name: "other", exact: true }).click();
      await page.waitForTimeout(100);
      assertEquals(
        await page.evaluate(() => document.activeElement?.id),
        "context-other",
      );
      await page.getByLabel("One fact, one line").click();
      await page.keyboard.type("call");
      assertEquals(
        await page.getByLabel("One fact, one line").inputValue(),
        "call",
      );
      assertEquals(
        await page.evaluate(() => document.activeElement?.id),
        "note",
      );
      await page.getByRole("button", { name: "work", exact: true }).click();
      // Ctrl + Enter in the note saves
      await page.getByLabel("One fact, one line").fill("kitchen, 15 minutes");
      await page.keyboard.press("Control+Enter");
      await page.getByRole("status", { name: /saved/i }).waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - desktop: step 1 in two columns, the summary beside the figure; the legend says ⌘ on a Mac",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      })).newPage();
      await signUp(page, server);
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await page.locator('[data-null="nowhere"]').click();
      const r = await page.evaluate(() => {
        const box = (sel: string) =>
          document.querySelector(sel)!.getBoundingClientRect();
        return {
          figure: box(".figure"),
          tabs: box(".tabs"),
          nulls: box(".controls"),
          summary: box("main .summary"),
          footerSummary: document.querySelectorAll("footer .summary").length,
        };
      });
      assert(r.figure.right <= r.tabs.left, JSON.stringify(r));
      assert(r.tabs.bottom <= r.nulls.top, JSON.stringify(r));
      assert(r.nulls.bottom <= r.summary.top, JSON.stringify(r));
      assertEquals(r.footerSummary, 0);
      await page.getByText("“Nowhere” is an answer too.").waitFor();
      await page.getByText("⌘ + Enter save note", { exact: false }).waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

/** From Home to the note with the fewest answers (ui.md §6.2) */
async function toNote(page: Page) {
  await page.getByRole("button", { name: NOW }).click();
  await waitStep(page, 1);
  await page.locator('[data-null="whole_body"]').click();
  await nextStep(page);
  await waitStep(page, 2);
  await page.locator('[data-null="nothing"]').click();
  for (let n = 3; n <= 9; n++) {
    await nextStep(page);
    await waitStep(page, n);
  }
  // The last screen: the situation, and the note under it
  await page.getByRole("button", { name: "work", exact: true }).click();
}

Deno.test({
  name:
    "e2e - note: a 'why' is quoted, Remove keeps the facts, Save without the note leaves none; hedges pass",
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
      const note = page.locator("textarea");
      const save = page.locator("button.next");

      await toNote(page);
      // A hedge is not a "why"
      await note.fill("maybe 10 people at the standup");
      assertEquals(await save.isDisabled(), false);
      // A cause: quoted; Save waits; Remove keeps what came before it
      await note.fill("call with boss, because I was late");
      await page.getByText("“because” is about why.", { exact: false })
        .waitFor();
      assertEquals(await save.isDisabled(), true);
      await page.getByRole("button", { name: "Remove “because…”" }).click();
      assertEquals(await note.inputValue(), "call with boss");
      assertEquals(await save.isDisabled(), false);
      // A "why" question; then saved without any note
      await note.fill("kitchen. Why again");
      await page.getByText("“Why” is about why.", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Save without the note" })
        .click();
      await page.getByRole("status", { name: /saved/i }).waitFor();

      // History: the check-in has no note
      await page.goto(`${server.url}/history`);
      await page.locator("main h3 button").first().click();
      const record = page.locator("main .record").first();
      await record.locator("dt").first().waitFor();
      const labels = (await record.locator("dt").allTextContents()).map((l) =>
        l.trim()
      );
      assertEquals(labels.includes("NOTE"), false, labels.join(" "));
      assertEquals(labels.includes("SITUATION"), true, labels.join(" "));
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - reminders: pause for 3 days, shown on Home and in Settings, resumed from Home",
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
      // The permission to let one pass is part of the note
      await page.goto(`${server.url}/settings`);
      await page.getByText("let it pass — nothing is counted", {
        exact: false,
      }).first().waitFor();
      await page.getByRole("button", { name: "3 days", exact: true }).click();
      const until = page.getByText(/^Paused until /);
      await until.waitFor();
      // Home: one quiet line with Resume
      await page.goto(server.url);
      const line = page.getByText(/^Reminders paused until /);
      await line.waitFor();
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await line.waitFor({ state: "detached" });
      await page.goto(`${server.url}/settings`);
      await page.getByRole("button", { name: "1 week", exact: true }).waitFor();
      assertEquals(await until.count(), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - Home: 'Reminders aren't reaching this device' only when not chosen; Keep off hides it for good",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const line = (page: Page) =>
        page.getByText("Reminders aren't reaching this device");
      // Onboarding finished without allowing: not the person's choice
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
      })).newPage();
      await signUp(page, server);
      await line(page).waitFor();
      await page.getByRole("button", { name: "Keep off", exact: true })
        .click();
      await line(page).waitFor({ state: "detached" });
      await page.reload();
      await page.getByRole("button", { name: NOW }).waitFor();
      await page.waitForTimeout(500);
      assertEquals(await line(page).count(), 0);

      // "Not now" or the switch turned off is a choice: no line. The
      // headless shell keeps notifications "denied", so onboarding never
      // offers "Not now" here; the choice it records is written directly
      const other = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 390, height: 844 },
      })).newPage();
      await signUp(other, server, async () => {}, "second@example.com");
      await line(other).waitFor();
      await other.evaluate(() =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("emo");
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const tx = req.result.transaction("meta", "readwrite");
            tx.objectStore("meta").put({ key: "push_declined", value: true });
            tx.oncomplete = () => resolve();
          };
        })
      );
      await other.reload();
      await other.getByRole("button", { name: NOW }).waitFor();
      await other.waitForTimeout(500);
      assertEquals(await line(other).count(), 0);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - orientation before the first check-in; Reminders: blocked first with How to allow, one-tap fixes, Saved",
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
      let step3 = "";
      await signUp(page, server, async (name) => {
        if (name === "install and reminders") {
          step3 = await page.locator("main").innerText();
        }
      });
      // Onboarding step 3: "Reminders" (nothing to install here) and what a
      // check-in is, before the first one
      assert(step3.includes("Reminders"), step3);
      assert(!step3.includes("Install & reminders"), step3);
      assert(step3.includes("You can stop at any step."), step3);

      // The first check-in says it on step 1; once one exists, it does not
      const first = page.getByText(
        "About a minute. “Nowhere” and “don't know” are answers too.",
      );
      await page.getByRole("button", { name: NOW }).click();
      await first.waitFor();
      await page.getByRole("button", { name: "Skip check-in" }).click();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await page.waitForTimeout(300);
      assertEquals(await first.count(), 0);
      await page.getByRole("button", { name: /^Close/ }).click();
      // Home first: Close goes back in history, which must not land after
      // the next navigation
      await page.waitForURL((u) => u.pathname === "/");

      // Settings → Reminders: blocked notifications, first and in ink
      await page.goto(`${server.url}/settings`);
      await page.getByText(
        "Not receiving reminders — notifications are blocked for Emo.",
      ).waitFor();
      await page.getByRole("button", { name: "How to allow" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByText("Chrome or Edge:", { exact: false }).waitFor();
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "detached" });

      // A window too short for 3 a day: marked, explained, fixed in one tap
      const to = page.locator('#reminders input[type="time"]').nth(1);
      await to.fill("10:00");
      await to.dispatchEvent("change");
      await page.getByText(
        "The window must be at least 5 hours long for 3 reminders a day.",
      ).waitFor();
      assertEquals(await to.getAttribute("aria-invalid"), "true");
      await page.getByRole("button", { name: "Use 09:00 – 14:00" }).waitFor();
      await page.getByRole("button", { name: "Use 1 a day" }).click();
      await page.getByText("Saved — from tomorrow.", { exact: false })
        .waitFor();
      assertEquals(await to.getAttribute("aria-invalid"), "false");
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - steps 2–3 carry the where; null answers are validated where given",
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
      const carry = page.locator("#step-carry");
      const h1 = page.locator("main h1");

      // Zones and sensations: carried, linked to the title (not hidden)
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await page.getByText("Nothing marked yet").waitFor();
      for (const z of ["shoulders", "chest"]) {
        await page.getByRole("button", { name: z, exact: true }).first()
          .click();
      }
      await nextStep(page);
      await waitStep(page, 2);
      assertEquals(await carry.innerText(), "shoulders, chest");
      assertEquals(await h1.getAttribute("aria-describedby"), "step-carry");
      await page.getByText("No choice yet").waitFor();
      for (const q of ["warm", "pulsing", "tense"]) {
        await page.getByRole("button", { name: q, exact: true }).click();
      }
      await page.getByText("Chosen: warm, pulsing, tense").waitFor();
      await nextStep(page);
      await waitStep(page, 3);
      assertEquals(
        await carry.innerText(),
        "shoulders, chest — warm, pulsing, tense",
      );
      await page.getByRole("button", { name: /^Stop here/ }).click();
      await page.getByRole("button", { name: "Done", exact: true }).click();

      // Nowhere and nothing: "an answer too", and nothing to rate
      await page.getByRole("button", { name: NOW }).click();
      await waitStep(page, 1);
      await page.locator('[data-null="nowhere"]').click();
      await page.getByText("“Nowhere” is an answer too.").waitFor();
      await nextStep(page);
      await waitStep(page, 2);
      assertEquals(await carry.innerText(), "nowhere");
      await page.locator('[data-null="nothing"]').click();
      await page.getByText("“Nothing” is an answer too.").waitFor();
      await page.locator('[data-null="cant_tell"]').click();
      await page.getByText("“Can't tell” is an answer too.").waitFor();
      await nextStep(page);
      await waitStep(page, 3);
      await page.getByText("Nothing to rate? Tap the slider where it is.")
        .waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
