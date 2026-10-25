// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A sheet on the on-screen keyboard (ui.md §4.5 Reach v2,
 * lib/viewport.ts, ConfirmSheet): on a phone, with the keyboard up
 * (e2e/keyboard.ts), the sheet's bottom is the keyboard's top, the field
 * typed in sits right over the buttons, inside the body, and Save is on
 * screen above the keyboard; Return brings the next field down there too.
 * With the keyboard gone the sheet is back at the bottom, as it was. A
 * desktop sheet never moves for a keyboard.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  launchBrowser,
  NOW,
  PASSPHRASE,
  settingsTitle,
  signUp,
  startServer,
} from "./harness.ts";
import { hideKeyboard, installKeyboardStub, showKeyboard } from "./keyboard.ts";

/** The phones, each with a keyboard of its size */
const PHONES = [
  { viewport: { width: 390, height: 844 }, keyboard: 336 },
  { viewport: { width: 375, height: 667 }, keyboard: 260 },
];
/** Sub-pixel layout against the keyboard's whole pixels */
const SLACK = 2;
/** "Right over the buttons": the field's bottom this close to the keyboard */
const NEAR = 100;

/** Settings → Data and keys → Change passphrase, open */
async function openChangePassphrase(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first()
    .click();
  await settingsTitle(page).waitFor();
  await page.getByRole("button", { name: "Change passphrase" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  return dialog;
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface Sheet {
  innerHeight: number;
  sheet: Box;
  body: Box;
  /** The focused element, and its id */
  field: Box;
  focused: string;
  save: Box;
  /** A tap at Save's centre lands on Save */
  saveHit: boolean;
}

/** Where the open sheet, its body, the focused field and Save are drawn */
function measure(page: Page): Promise<Sheet> {
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const sheet = document.querySelector("[role=dialog]")!;
    const save = [...sheet.querySelectorAll("button")].find((b) =>
      b.textContent?.trim() === "Save"
    )!;
    const s = box(save);
    const hit = document.elementFromPoint(
      (s.left + s.right) / 2,
      (s.top + s.bottom) / 2,
    );
    return {
      innerHeight,
      sheet: box(sheet),
      body: box(sheet.querySelector(".body")!),
      field: box(document.activeElement!),
      focused: document.activeElement?.id ?? "",
      save: s,
      saveHit: hit !== null && save.contains(hit),
    };
  });
}

/**
 * The keyboard's top is `top`, the visible part starts at `seen`: the sheet
 * stands on the keyboard, all of it in view, the field and Save right above
 */
function onKeyboard(at: Sheet, top: number, label: string, seen = 0) {
  assert(
    Math.abs(at.sheet.bottom - top) <= SLACK,
    `${label}: the sheet's bottom at ${at.sheet.bottom}, the keyboard's top at ${top}`,
  );
  assert(
    at.sheet.top >= seen,
    `${label}: the sheet's top at ${at.sheet.top}, the view's at ${seen}`,
  );
  assert(
    at.field.bottom <= top && top - at.field.bottom <= NEAR,
    `${label}: the field's bottom at ${at.field.bottom}, the keyboard's top at ${top}`,
  );
  assert(
    at.field.top >= at.body.top - 1 && at.field.bottom <= at.body.bottom + 1,
    `${label}: the field (${at.field.top}–${at.field.bottom}) is cut off by the body (${at.body.top}–${at.body.bottom})`,
  );
  assert(
    at.save.top >= seen && at.save.bottom <= top && at.saveHit,
    `${label}: Save at ${at.save.top}–${at.save.bottom} (hit: ${at.saveHit}), the keyboard's top at ${top}`,
  );
}

for (const { viewport, keyboard } of PHONES) {
  const size = `${viewport.width}×${viewport.height}`;
  Deno.test({
    name:
      `e2e - sheet: on a phone it stands on the keyboard, the field typed in right over the buttons (${size}, ${keyboard} px keyboard)`,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const server = await startServer();
      const browser = await launchBrowser();
      try {
        const context = await browser.newContext({
          locale: "en-GB",
          viewport,
          hasTouch: true,
          isMobile: true,
        });
        await installKeyboardStub(context);
        const page = await context.newPage();
        await signUp(page, server);
        const dialog = await openChangePassphrase(page);
        await dialog.getByLabel("Current passphrase", { exact: true }).focus();
        const rest = await measure(page);
        assert(
          Math.abs(rest.sheet.bottom - rest.innerHeight) <= SLACK,
          `${size}: at rest the sheet's bottom at ${rest.sheet.bottom}`,
        );

        // The keyboard comes up under the first field
        await showKeyboard(page, keyboard);
        const up = await measure(page);
        assertEquals(up.focused, "data-pass");
        onKeyboard(up, up.innerHeight - keyboard, `${size}, first field`);

        // It goes: the sheet is back at the bottom, as high as it was
        await hideKeyboard(page);
        const down = await measure(page);
        assert(
          Math.abs(down.sheet.bottom - down.innerHeight) <= SLACK,
          `${size}: with the keyboard gone the sheet's bottom at ${down.sheet.bottom}`,
        );
        assert(
          Math.abs(down.sheet.top - rest.sheet.top) <= 1,
          `${size}: the sheet's top at ${down.sheet.top}, ${rest.sheet.top} before`,
        );

        // iOS moved the visual viewport up to show the field: the sheet
        // stands on the keyboard all the same
        const lifted = 120;
        await showKeyboard(page, keyboard, { offsetTop: lifted });
        onKeyboard(
          await measure(page),
          lifted + (viewport.height - keyboard),
          `${size}, visual viewport moved up`,
          lifted,
        );
        await hideKeyboard(page);

        // Return: the next field comes down over the buttons in turn
        await showKeyboard(page, keyboard);
        await page.keyboard.type(PASSPHRASE);
        await page.keyboard.press("Enter");
        const next = await measure(page);
        assertEquals(next.focused, "data-new-passphrase");
        onKeyboard(next, next.innerHeight - keyboard, `${size}, next field`);
        await hideKeyboard(page);
        assertEquals(await dialog.count(), 1);
      } finally {
        await browser.close();
        await server.stop();
      }
    },
  });
}

Deno.test({
  name:
    "e2e - sheet: a desktop sheet stays where it is with a keyboard up (1280×800)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({
        locale: "en-GB",
        viewport: { width: 1280, height: 800 },
      });
      const plain = await context.newPage();
      await signUp(plain, server);
      await openChangePassphrase(plain);
      const without = (await measure(plain)).sheet;

      // A second tab of the same browser, with the stub
      const stubbed = await context.newPage();
      await installKeyboardStub(stubbed);
      await stubbed.goto(server.url);
      await stubbed.getByRole("button", { name: NOW, exact: true }).waitFor();
      await openChangePassphrase(stubbed);
      assertEquals((await measure(stubbed)).sheet, without);
      await showKeyboard(stubbed, 336);
      assertEquals(
        (await measure(stubbed)).sheet,
        without,
        "the sheet moved for the keyboard",
      );
      await hideKeyboard(stubbed);
      assertEquals((await measure(stubbed)).sheet, without);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
