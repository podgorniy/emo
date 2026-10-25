// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * reliability.md §1.3: an account deleted on one device is announced on the
 * other with one screen, and that device's copies are wiped only after "OK".
 * The sign-in card, the code on the same card, and the passphrase fields
 * (ui.md §12).
 */
import { assert, assertEquals } from "@std/assert";
import {
  EMAIL,
  launchBrowser,
  NOW,
  PASSPHRASE,
  signUp,
  startServer,
} from "./harness.ts";

Deno.test({
  name: "e2e - account deleted elsewhere: told first, then wiped on OK",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const a = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await signUp(a, server);

      // Device B signs in to the same account and deletes it
      const b = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await b.goto(server.url);
      await b.getByLabel("Email").fill(EMAIL);
      await b.getByRole("button", { name: "Send code", exact: true }).click();
      await b.getByLabel("Six-digit code").fill(await server.mailCode(EMAIL));
      await b.locator('input[type="password"]').first().fill(PASSPHRASE);
      await b.keyboard.press("Enter");
      await b.getByRole("button", { name: NOW }).waitFor({ timeout: 30_000 });
      await b.getByRole("button", { name: "Settings", exact: true }).first()
        .click();
      await b.getByRole("button", { name: "Delete account", exact: true })
        .click();
      await b.getByRole("dialog").locator('input[type="password"]').fill(
        PASSPHRASE,
      );
      await b.getByRole("button", { name: "Delete everything" }).click();
      await b.getByLabel("Email").waitFor({ timeout: 30_000 });

      // Device A learns it at the next start, and keeps its data until OK
      await a.reload();
      await a.getByText("This account was deleted.").waitFor();
      // Reads `meta.account` without creating the database or a store
      const accountKept = () =>
        a.evaluate(async () => {
          const names = (await indexedDB.databases()).map((d) => d.name);
          if (!names.includes("emo")) return false;
          return await new Promise((resolve) => {
            const req = indexedDB.open("emo");
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains("meta")) {
                db.close();
                resolve(false);
                return;
              }
              const get = db.transaction("meta").objectStore("meta").get(
                "account",
              );
              get.onsuccess = () => {
                db.close();
                resolve(get.result !== undefined);
              };
            };
            req.onerror = () => resolve(false);
          });
        });
      assertEquals(await accountKept(), true);
      await a.getByRole("button", { name: "OK", exact: true }).click();
      await a.getByLabel("Email").waitFor();
      assertEquals(await accountKept(), false);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - sign-in says what Emo is; Create an account; inline email check; passphrase labels",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await page.goto(server.url);
      // The wordmark and the tagline before anything is asked (ui.md §12.2)
      await page.getByText("Emo", { exact: true }).waitFor();
      await page.getByText(/^About a minute, a few times a day/).waitFor();
      // Anyone may create an account (REGISTRATION=open, the default)
      await page.getByRole("heading", {
        level: 1,
        name: "Sign in or create an account",
        exact: true,
      }).waitFor();

      // No browser bubble: "Enter your email" under the field
      await page.getByRole("button", { name: "Send code", exact: true })
        .click();
      const email = page.getByLabel("Email");
      await page.getByText("Enter your email").waitFor();
      assertEquals(await email.getAttribute("aria-invalid"), "true");
      assertEquals(
        await page.evaluate(() => document.activeElement?.id),
        "email-input",
      );
      await email.fill("someone");
      assertEquals(await page.getByText("Enter your email").count(), 0);

      // The invite field open: "Create an account"
      await page.getByRole("button", { name: "I have an invite code" }).click();
      await page.getByRole("heading", { level: 1, name: "Create an account" })
        .waitFor();

      // Change passphrase names its three fields (ui.md §11)
      await signUp(page, server);
      await page.getByRole("button", { name: "Settings", exact: true }).first()
        .click();
      await page.getByRole("button", { name: "Change passphrase" }).click();
      const dialog = page.getByRole("dialog");
      for (
        const label of [
          "Current passphrase",
          "New passphrase, 8 characters or more",
          "Repeat the new passphrase",
        ]
      ) {
        await dialog.getByLabel(label, { exact: true }).waitFor();
      }
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - email and code on one card: the address in full, Change, the code focused and sent at 6 digits; invite only, the invite hint after 60 s",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // The hint is for an invite-only server: on an open one a mistyped
    // invite is left out and the mail goes anyway (switch.e2e.ts)
    const server = await startServer({ REGISTRATION: "invite" });
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await page.clock.install();
      await page.goto(server.url);
      const active = () =>
        page.evaluate(() =>
          document.activeElement?.id ||
          document.activeElement?.getAttribute("aria-label")
        );
      await page.getByLabel("Email").fill("someone@example.com");
      await page.getByRole("button", { name: "I have an invite code" }).click();
      assertEquals(await active(), "invite-input"); // D14
      await page.getByLabel("Invite code").fill("NOTACODE1234");
      await page.getByRole("button", { name: "Send code", exact: true })
        .click();

      // The same card: the address in full, Change, the code focused
      await page.getByText("We sent 6 digits to someone@example.com.", {
        exact: false,
      }).waitFor();
      await page.getByRole("heading", { level: 1, name: "Create an account" })
        .waitFor();
      assertEquals(await active(), "Six-digit code");

      // Six digits send themselves; a wrong code comes back empty, focused
      const code = page.getByLabel("Six-digit code");
      await code.pressSequentially("000000");
      await page.getByRole("alert").filter({
        hasText: "That code doesn't match or has expired.",
      }).waitFor();
      assertEquals(await code.inputValue(), "");
      assertEquals(await active(), "Six-digit code");

      // With an invite: after 60 s, check the invite code
      const late = page.getByText(
        "No email yet? Check the invite code — it may be mistyped or already used.",
      );
      assertEquals(await late.count(), 0);
      await page.clock.fastForward(61_000);
      await late.waitFor();

      // Change: the address and the invite, kept
      await page.getByRole("button", { name: "Change", exact: true }).click();
      assertEquals(await active(), "email-input");
      assertEquals(
        await page.getByLabel("Email").inputValue(),
        "someone@example.com",
      );
      assertEquals(
        await page.getByLabel("Invite code").inputValue(),
        "NOTACODE1234",
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - passphrase fields: Show, hints before the meter, Repeat on blur, Suggest; a wrong unlock is kept and selected; the key in two lines",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await page.goto(server.url);
      await page.getByRole("button", { name: "I have an invite code" }).click();
      await page.getByLabel("Email").fill(" E2E@Example.com ");
      await page.getByLabel("Invite code").fill(await server.invite());
      await page.getByRole("button", { name: "Send code", exact: true })
        .click();
      await page.getByLabel("Six-digit code").fill(
        await server.mailCode(EMAIL),
      );

      // Setup: the first field focused; username = the normalised address
      const pass = page.getByLabel(/^Passphrase/);
      await pass.waitFor();
      assertEquals(
        await page.evaluate(() => document.activeElement?.id),
        "setup-passphrase",
      );
      assertEquals(
        await page.locator('input[autocomplete="username"]').inputValue(),
        EMAIL,
      );
      // Show / Hide
      assertEquals(await pass.getAttribute("type"), "password");
      await page.getByRole("button", { name: "Show" }).first().click();
      assertEquals(await pass.getAttribute("type"), "text");
      // Cyrillic: the keyboard hint at once, no meter
      await pass.fill("пароль-пароль");
      await page.getByText(
        "Use Latin letters, digits or symbols — switch the keyboard to English.",
      ).waitFor();
      assertEquals(await page.locator(".meter").count(), 0);
      // Repeat: no "differ" after two characters, only on leaving it
      await pass.fill("calm river stone");
      await page.locator(".meter").waitFor();
      const repeat = page.getByLabel("Repeat");
      await repeat.fill("ca");
      await page.waitForTimeout(100);
      assertEquals(await page.getByText("The two entries differ.").count(), 0);
      await repeat.blur();
      await page.getByText("The two entries differ.").waitFor();
      // Suggest: five words in both fields, in clear text, strong
      await page.getByRole("button", { name: "Suggest a passphrase" }).click();
      await page.getByText("Five random words, shown in full.", {
        exact: false,
      }).waitFor();
      const words = await pass.inputValue();
      assertEquals(words.split(" ").length, 5);
      assertEquals(await repeat.inputValue(), words);
      assertEquals(await pass.getAttribute("type"), "text");
      assertEquals(await page.locator(".meter-word").textContent(), "strong");
      assertEquals(await page.getByText("The two entries differ.").count(), 0);

      // On to Home with that passphrase
      await page.getByRole("button", { name: "Next" }).click();
      const written = page.getByRole("button", { name: /I'll write it down/ });
      await written.waitFor({ timeout: 30_000 });
      await written.click();
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: NOW }).waitFor();

      // Lock from Settings; a wrong passphrase stays, selected
      await page.getByRole("button", { name: "Settings", exact: true }).first()
        .click();
      await page.getByRole("button", { name: /^Lock on this device/ }).click();
      const unlock = page.getByLabel("Passphrase", { exact: true });
      await unlock.fill("calm river stome");
      await page.keyboard.press("Enter");
      await page.getByText("Wrong passphrase.").waitFor({ timeout: 30_000 });
      assertEquals(await unlock.inputValue(), "calm river stome");
      const selected = await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement;
        return el.selectionEnd! - el.selectionStart!;
      });
      assertEquals(selected, "calm river stome".length);
      // Unlocking lands on Home, not on Settings where it was locked
      assertEquals(new URL(page.url()).pathname, "/");

      // The recovery key: two lines of four groups, like the card
      await page.getByRole("button", { name: "Use recovery key" }).click();
      const key = page.getByLabel(/^Recovery key/);
      await key.waitFor();
      await page.waitForTimeout(100);
      assertEquals(
        await page.evaluate(() => document.activeElement?.id),
        "recovery-key",
      );
      await key.pressSequentially("abcdefghjkmnpqrstvwxyz0123456789");
      const value = await key.inputValue();
      assertEquals(
        value,
        "ABCD EFGH JKMN PQRS\nTVWX YZ01 2345 6789",
      );
      const box = await key.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      assert(box.scroll <= box.client + 1, JSON.stringify(box));
      await page.getByText(
        "you'll also get a new recovery key, so have a pen",
        { exact: false },
      ).waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - the address, encrypted in the prefs, is the username after a restart; never in plaintext; not on the lock screen",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await signUp(page, server);
      await page.waitForTimeout(1500); // the first sync pass uploads the prefs

      // A restart: the address is gone from memory, back from the prefs
      await page.reload();
      await page.getByRole("button", { name: NOW, exact: true }).waitFor();
      await page.getByRole("button", { name: "Settings", exact: true }).first()
        .click();
      await page.getByRole("button", { name: "Change passphrase" }).click();
      assertEquals(
        await page.getByRole("dialog").locator(
          'input[autocomplete="username"]',
        ).inputValue(),
        EMAIL,
      );
      await page.keyboard.press("Escape");

      // Nowhere in plaintext on the device
      const stored = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("emo");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const out: unknown[] = [];
        for (const name of db.objectStoreNames) {
          out.push(
            await new Promise((resolve) => {
              const req = db.transaction(name).objectStore(name).getAll();
              req.onsuccess = () => resolve(req.result);
            }),
          );
        }
        db.close();
        return JSON.stringify(out) + JSON.stringify({ ...localStorage });
      });
      assert(!stored.includes(EMAIL), "the address in plaintext");

      // Locked: not even in the hidden username field
      await page.getByRole("button", { name: /^Lock on this device/ }).click();
      await page.getByRole("button", { name: "Use recovery key" }).waitFor();
      assertEquals(
        await page.locator('input[autocomplete="username"]').count(),
        0,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - screens before the app: a language switch, and a way out of Unlock and of the recovery key",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      const button = (name: string | RegExp) =>
        page.getByRole("button", { name, exact: typeof name === "string" });
      const differentAccount = button("Use a different account");

      // The recovery key: leaving warns first; "Back" finds the same key
      await page.goto(server.url);
      await button("I have an invite code").click();
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Invite code").fill(await server.invite());
      await button("Send code").click();
      await page.getByLabel("Six-digit code").fill(
        await server.mailCode(EMAIL),
      );
      await page.getByLabel(/^Passphrase/).fill(PASSPHRASE);
      await page.getByLabel("Repeat").fill(PASSPHRASE);
      await button("Next").click();
      await button(/I'll write it down/).waitFor({ timeout: 30_000 });
      const key = await page.locator(".key").textContent();
      await differentAccount.click();
      await page.getByText("This key won't be shown again.", { exact: false })
        .waitFor();
      await button("Cancel").click();
      await differentAccount.click();
      await button("Leave").click();
      await button("Clear this browser and continue").waitFor();
      await button("Back").click();
      assertEquals(await page.locator(".key").textContent(), key);
      await button(/I'll write it down/).click();
      await button("Next").click();
      await button("Done").click();
      await button(NOW).waitFor();

      // Unlock: the language switch works while locked
      await button("Settings").first().click();
      await button(/^Lock on this device/).click();
      await page.getByLabel("Passphrase", { exact: true }).waitFor();
      await button("Русский").click();
      await page.getByRole("heading", { name: "Разблокировать" }).waitFor();
      await button("English").click();
      await page.getByRole("heading", { name: "Unlock" }).waitFor();

      // "Use a different account": Back keeps the device; Clear ends the
      // session too, so a reload stays on the sign-in screen
      await differentAccount.click();
      await button("Back").click();
      await page.getByLabel("Passphrase", { exact: true }).waitFor();
      await differentAccount.click();
      await button("Clear this browser and continue").click();
      await page.getByLabel("Email").waitFor();
      await page.reload();
      await page.getByLabel("Email").waitFor();
      assertEquals(
        await page.getByLabel("Passphrase", { exact: true }).count(),
        0,
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
