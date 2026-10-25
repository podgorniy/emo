// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The descriptions one tap away (ui.md §6.5, §11.9): the
 * help link is on steps 2–9 and never on step 1, the same in every preset
 * and size; its sheet is a read-only dialog that leaves the form and its
 * encrypted draft exactly as they were, keeps the keyboard off the step
 * behind it and swallows a double tap on Close; step 6 lists only the chosen
 * word's finer words; Settings → Words opens from `#words` in check-in
 * order; both open offline; options never show a description on hover or
 * focus. The instrument version (`ui.copy` 3) is a unit test
 * (`shared/entry_test.ts`, written by `client/src/lib/theme.ts`).
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  auditA11y,
  launchBrowser,
  nextStep,
  openAppearance,
  signUp,
  startServer,
} from "./harness.ts";
import type { MessageKey } from "../shared/i18n/keys.ts";
import { t as translate } from "../shared/i18n/format.ts";
import { TERM_DESCRIPTIONS } from "../shared/glossary.ts";

const t = (key: MessageKey) => translate("en", key);

const WORDS_LINK = t("checkin.help.words");
const QUESTION_LINK = t("checkin.help.question");
/** Steps 1–9: the help link's label, or none */
const LINK: (string | null)[] = [
  null,
  WORDS_LINK,
  QUESTION_LINK,
  QUESTION_LINK,
  QUESTION_LINK,
  WORDS_LINK,
  WORDS_LINK,
  QUESTION_LINK,
  WORDS_LINK,
];

/** The number in the step counter ("Step 3 of 9" → 3), in any language */
function stepNumber(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number(
      /\d+/.exec(document.querySelector(".head .counter")?.textContent ?? "")
        ?.[0],
    )
  );
}

async function waitStep(page: Page, n: number) {
  await page.waitForFunction(
    (n) =>
      /\d+/.exec(document.querySelector(".head .counter")?.textContent ?? "")
        ?.[0] === String(n),
    n,
  );
}

/** Open a check-in and answer with nulls up to step `to`. */
async function walkTo(page: Page, to: number) {
  await page.locator("button.now").click();
  await waitStep(page, 1);
  for (let n = 1; n < to; n++) {
    if (n === 1) await page.locator('[data-null="whole_body"]').click();
    if (n === 2) await page.locator('[data-null="nothing"]').click();
    await nextStep(page);
    await waitStep(page, n + 1);
  }
}

/** End the open check-in as a partial one, so the next starts fresh. */
async function stopHere(page: Page) {
  await page.getByRole("button", { name: /^Skip|^Stop here/ }).first().click();
  await page.getByRole("status", { name: /saved/i }).waitFor();
}

/** What the person has answered on this screen, as the form shows it */
function formState(page: Page) {
  return page.evaluate(() => ({
    pressed: [...document.querySelectorAll('[aria-pressed="true"]')]
      .map((el) => el.textContent?.trim() ?? ""),
    counter: document.querySelector(".head .counter")?.textContent?.trim(),
    untouched: document.querySelectorAll(".slider.untouched").length,
    slider: document.querySelector<HTMLInputElement>("main input[type=range]")
      ?.value ?? null,
    nextDisabled: document.querySelector<HTMLButtonElement>("button.next")
      ?.disabled,
  }));
}

/** The encrypted draft as stored: nonce and ciphertext */
function storedDraft(page: Page) {
  return page.evaluate(() =>
    new Promise<string | null>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction("draft").objectStore("draft").get(
          "current",
        );
        get.onsuccess = () => {
          db.close();
          const r = get.result;
          resolve(r ? `${r.nonce_b64}.${r.ct_b64}` : null);
        };
      };
    })
  );
}

const dialog = (page: Page) =>
  page.locator('[role="dialog"][aria-modal="true"]');

async function openHelp(page: Page) {
  await page.locator("button.help-link").click();
  await dialog(page).waitFor();
}

async function closeHelp(page: Page) {
  await dialog(page).getByRole("button", { name: t("common.close") }).click();
  await dialog(page).waitFor({ state: "detached" });
  await page.waitForTimeout(400); // the tap shield
}

/** The dialog: labelled by the step's plain title; Close its only button */
async function dialogProblems(page: Page, title: MessageKey) {
  const out: string[] = [];
  const d = dialog(page);
  const id = await d.getAttribute("aria-labelledby");
  const label = id ? await page.locator(`#${id}`).textContent() : null;
  if (label?.trim() !== t(title)) out.push(`labelled "${label}"`);
  const buttons = await d.getByRole("button").allTextContents();
  if (buttons.map((b) => b.trim()).join() !== t("common.close")) {
    out.push(`buttons: ${buttons.join(", ")}`);
  }
  if (await d.locator("[aria-pressed]").count() > 0) out.push("aria-pressed");
  return out;
}

Deno.test({
  name:
    "e2e - glossary: the help link on steps 2–9, none on step 1, in every preset at 390×844 and 1280×800; the sheet passes axe",
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
      for (let i = 0; i < 10; i++) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${server.url}/settings`);
        const themes = (await openAppearance(page)).getByRole("radio");
        const preset = (await themes.nth(i).locator(".name").textContent())!
          .trim();
        await themes.nth(i).click();
        await page.waitForTimeout(300);
        for (
          const size of [{ width: 390, height: 844 }, {
            width: 1280,
            height: 800,
          }]
        ) {
          await page.setViewportSize(size);
          const at = `${preset} ${size.width}×${size.height}`;
          await page.goto(server.url);
          await walkTo(page, 1);
          for (let n = 1; n <= 9; n++) {
            const links = await page.locator("button.help-link")
              .allTextContents();
            const want = LINK[n - 1];
            const got = links.map((l) => l.trim()).join();
            // Mono themes show it in upper case through CSS only
            if (got !== (want ?? "")) {
              problems.push(`${at} step ${n}: "${got}"`);
            }
            if (n === 2 && size.width === 390) {
              await openHelp(page);
              for (
                const p of await dialogProblems(page, "checkin.step.2.title")
              ) {
                problems.push(`${at} sheet: ${p}`);
              }
              await page.waitForTimeout(300);
              for (const line of await auditA11y(page)) {
                problems.push(`${at} sheet: ${line}`);
              }
              await closeHelp(page);
            }
            if (n === 1) await page.locator('[data-null="whole_body"]').click();
            if (n === 2) await page.locator('[data-null="nothing"]').click();
            if (n < 9) {
              await nextStep(page);
              await waitStep(page, n + 1);
            }
          }
          await stopHere(page);
        }
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
    "e2e - glossary: the sheet is read-only, never re-saves the draft, blocks the keyboard and shields a double tap",
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
      await page.locator("button.now").click();
      await waitStep(page, 1);
      await page.locator('[data-null="whole_body"]').click();
      await nextStep(page);
      await waitStep(page, 2);

      // Step 2 with an answer: open, wait, close; nothing moves or is saved
      await page.getByRole("button", { name: "tight", exact: true }).click();
      await page.waitForTimeout(600); // the draft write
      const draft = await storedDraft(page);
      assert(draft, "a draft is stored");
      const before = await formState(page);
      await openHelp(page);
      assertEquals(await dialogProblems(page, "checkin.step.2.title"), []);
      assertEquals(await dialog(page).locator("dt").count(), 23);
      // The keyboard never changes the step behind the sheet
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(1000);
      assertEquals(await stepNumber(page), 2);
      // Esc closes it, and focus is back on the link
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "detached" });
      assertEquals(
        await page.evaluate(() =>
          document.activeElement?.classList.contains("help-link")
        ),
        true,
      );
      await page.waitForTimeout(600);
      assertEquals(await storedDraft(page), draft, "byte-identical draft");
      assertEquals(await formState(page), before);

      // A double click on Close: the shield takes the second click
      await openHelp(page);
      const close = await dialog(page).getByRole("button", {
        name: t("common.close"),
      }).boundingBox();
      assert(close);
      await page.mouse.dblclick(
        close.x + close.width / 2,
        close.y + close.height / 2,
      );
      await dialog(page).waitFor({ state: "detached" });
      await page.waitForTimeout(500);
      assertEquals(await formState(page), before);
      assertEquals(await storedDraft(page), draft);

      // A slider step: still untouched, Next as it was
      await nextStep(page);
      await waitStep(page, 3);
      const slider = await formState(page);
      assertEquals(slider.untouched, 1);
      await openHelp(page);
      assertEquals(await dialogProblems(page, "checkin.step.3.title"), []);
      assertEquals(await dialog(page).locator("dt").count(), 0);
      await closeHelp(page);
      assertEquals(await formState(page), slider);

      // Step 6: the words and the certainty; the chosen word's finer words
      for (let n = 3; n < 6; n++) {
        await nextStep(page);
        await waitStep(page, n + 1);
      }
      await openHelp(page);
      assertEquals(await dialog(page).locator("dt").count(), 8 + 3);
      await closeHelp(page);
      await page.getByRole("button", { name: "fear", exact: true }).click();
      await page.waitForTimeout(400);
      const word = await formState(page);
      await openHelp(page);
      const terms = (await dialog(page).locator("dt").allTextContents())
        .map((s) => s.trim());
      assertEquals(terms.length, 8 + 3 + 8);
      assert(terms.includes("anxiety"), terms.join());
      assertEquals(terms.includes("irritation"), false, "only fear's words");
      assertEquals(
        await dialog(page).locator("h3").allTextContents(),
        [t("checkin.step.6.confidence.title"), t("checkin.step.6.l2.title")],
      );
      assertEquals(await dialogProblems(page, "checkin.step.6.title"), []);
      await closeHelp(page);
      assertEquals(await formState(page), word);

      // Step 7 with an urge chosen
      await page.getByRole("button", { name: "guessing", exact: true }).click();
      await nextStep(page);
      await waitStep(page, 7);
      await page.getByRole("button", { name: "move", exact: true }).click();
      await page.waitForTimeout(400);
      const urge = await formState(page);
      await openHelp(page);
      assertEquals(await dialog(page).locator("dt").count(), 13);
      assertEquals(await dialogProblems(page, "checkin.step.7.title"), []);
      await closeHelp(page);
      assertEquals(await formState(page), urge);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - glossary: Settings → Words opens from #words, every first-level word closed, in check-in order",
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
      await page.goto(`${server.url}/settings#words`);
      const row = page.locator("#words button[aria-expanded]");
      await row.waitFor();
      assertEquals(await row.getAttribute("aria-expanded"), "true");
      const headings = page.locator("#words-body .group-heading");
      await headings.nth(8).waitFor();
      assertEquals(
        (await headings.allTextContents()).map((h) => h.trim()),
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
          t(`checkin.eyebrow.${n}` as MessageKey)
        ),
      );
      await page.getByText(t("settings.words.intro")).waitFor();
      const details = page.locator("#words details");
      assertEquals(await details.count(), 8);
      for (let i = 0; i < 8; i++) {
        assertEquals(await details.nth(i).getAttribute("open"), null);
      }
      await details.first().locator("summary").click();
      assertEquals(await details.first().locator("dt").count(), 8);
      assertEquals(await auditA11y(page), []);

      // Without the hash it is one row until opened
      await page.goto(`${server.url}/settings`);
      await row.waitFor();
      assertEquals(await row.getAttribute("aria-expanded"), "false");
      assertEquals(await page.locator("#words-body").isVisible(), false);
      await row.click();
      await headings.nth(8).waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - glossary: offline after the first load, the sheet and Settings → Words open (precached)",
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
      assert(
        await page.evaluate(() => !!navigator.serviceWorker.controller),
        "the service worker controls the app",
      );
      // Never opened online: the chunk can only come from the precache
      await context.setOffline(true);
      await walkTo(page, 2);
      await openHelp(page);
      assertEquals(await dialog(page).locator("dt").count(), 23);
      await closeHelp(page);
      await page.getByRole("button", { name: /^Close/ }).click();
      await page.locator("button.now").waitFor();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.locator("#words button[aria-expanded]").click();
      await page.locator("#words-body .group-heading").nth(8).waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - glossary: no option shows a description on hover or focus (no tooltip, no title)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    const problems: string[] = [];
    try {
      const page = await (await browser.newContext({
        locale: "en-GB",
        viewport: { width: 1280, height: 800 },
      })).newPage();
      await signUp(page, server);
      const texts = [
        ...Object.values(TERM_DESCRIPTIONS.QUALITIES),
        ...Object.values(TERM_DESCRIPTIONS.WORDS),
        ...Object.values(TERM_DESCRIPTIONS.URGES),
      ].map((d) => d.text.en).filter((s) => s !== "");
      const look = async (where: string) => {
        const found = await page.evaluate((texts) => {
          const out: string[] = [];
          const body = document.body.innerText;
          for (const s of texts) if (body.includes(s)) out.push(s);
          const flow = document.querySelector(".flow");
          if (flow?.querySelector("[title]")) out.push("a title attribute");
          if (document.querySelector('[role="tooltip"]')) out.push("tooltip");
          return out;
        }, texts);
        for (const f of found) problems.push(`${where}: ${f}`);
      };
      await walkTo(page, 2);
      const option = page.getByRole("button", { name: "tight", exact: true });
      await option.hover();
      await page.waitForTimeout(700);
      await look("step 2 hover");
      await option.focus();
      await page.waitForTimeout(700);
      await look("step 2 focus");
      await page.locator('[data-null="nothing"]').click();
      for (let n = 2; n < 6; n++) {
        await nextStep(page);
        await waitStep(page, n + 1);
      }
      const fear = page.getByRole("button", { name: "fear", exact: true });
      await fear.hover();
      await page.waitForTimeout(700);
      await look("step 6 hover");
      await fear.focus();
      await page.waitForTimeout(700);
      await look("step 6 focus");
    } finally {
      await browser.close();
      await server.stop();
    }
    assertEquals(problems, []);
  },
});
