// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * reliability.md §1.3, one account per browser: on a device that holds an
 * account the sign-in screen is "Sign in to sync", and another account
 * signing in there gets a choice instead of a dead end. That account's
 * session never acts on this device's data, not even across a reload in the
 * middle of the choice. ui.md §12.3: on an invite-only
 * server the invite note is a way back to the invite field; on an open one
 * (the default) anyone signs up without an invite.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import {
  auditA11y,
  type E2eServer,
  launchBrowser,
  NOW,
  signUp,
  startServer,
  watchCsp,
} from "./harness.ts";

/** An account made over the API, without a keyring yet */
async function account(server: E2eServer, email: string): Promise<void> {
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${server.url}${path}`, {
      method: "POST",
      headers: { Origin: server.url, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await res.body?.cancel();
    return res.status;
  };
  assertEquals(
    await post("/api/auth/request-code", {
      email,
      invite_code: await server.invite(),
    }),
    202,
  );
  assertEquals(
    await post("/api/auth/verify", {
      email,
      code: await server.mailCode(email),
      tz: "UTC",
      locale: "en",
    }),
    200,
  );
}

/** A `meta` value, or with no key the row count of `store` */
function idb(page: Page, store: string, key?: string): Promise<unknown> {
  return page.evaluate(([store, key]) =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const s = db.transaction(store).objectStore(store);
        const get = key === undefined ? s.count() : s.get(key);
        get.onsuccess = () => {
          db.close();
          resolve(key === undefined ? get.result : get.result?.value);
        };
        get.onerror = () => reject(get.error);
      };
    }), [store, key] as const);
}

/** One check-in saved here but not uploaded (its ciphertext is a stand-in) */
function seedUnsynced(page: Page): Promise<void> {
  return page.evaluate(() =>
    new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["entries", "outbox"], "readwrite");
        const id = crypto.randomUUID();
        const blob = {
          key_version: 1,
          nonce_b64: "A".repeat(32),
          ct_b64: "AAAA",
        };
        tx.objectStore("entries").put({
          id,
          seq: 0,
          deleted: false,
          received_at: "",
          ...blob,
        });
        tx.objectStore("outbox").put({
          id,
          op: "put",
          attempt_count: 0,
          created_at: new Date().toISOString(),
          ...blob,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    })
  );
}

Deno.test({
  name:
    "e2e - one account per browser: Sign in to sync, the choice, nothing mixed",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ locale: "en-GB" });
      const page = await context.newPage();
      const drain = await watchCsp(page);
      const button = (name: string | RegExp) =>
        page.getByRole("button", { name, exact: typeof name === "string" });
      const heading = (name: string) => page.getByRole("heading", { name });
      const a11y: string[] = [];
      const audit = async (screen: string) => {
        for (const line of await auditA11y(page)) {
          a11y.push(`${screen}: ${line}`);
        }
      };
      // Any upload the server accepted from this device
      const uploads: string[] = [];
      page.on("response", (res) => {
        const method = res.request().method();
        if (
          res.url().includes("/api/entries/") && method !== "GET" && res.ok()
        ) {
          uploads.push(`${method} ${res.url()}`);
        }
      });

      await signUp(page, server);
      const own = await idb(page, "meta", "account_id");
      assert(typeof own === "string");

      // The session ends; a check-in made since waits in the outbox
      await context.clearCookies();
      await seedUnsynced(page);
      await page.reload();
      // The dot explains first (ui.md §3); the sheet's button
      // opens the sign-in
      const signInToSync = async () => {
        await button(/Not synced/).click();
        await page.getByRole("dialog").getByRole("button", {
          name: "Sign in to sync",
        }).click();
        await heading("Sign in to sync").waitFor();
      };
      await signInToSync();
      assertEquals(await button("I have an invite code").count(), 0);
      await audit("sign in to sync");
      await button("Back").click();
      await button(NOW).waitFor();

      const other = "other@example.com";
      const third = "third@example.com";
      await account(server, other);
      await account(server, third);
      const signInAs = async (email: string) => {
        await signInToSync();
        await page.getByLabel("Email").fill(email);
        await button("Send code").click();
        await page.getByLabel("Six-digit code").fill(
          await server.mailCode(email),
        );
        await heading("Another account is set up on this browser").waitFor();
      };

      // Another account signs in: a choice that says what clearing would lose
      await signInAs(other);
      await page.getByText("You signed in as o•", { exact: false }).waitFor();
      await page.getByText(
        "This browser holds 1 check-in of the account set up on it.",
      )
        .waitFor();
      await page.getByText("1 check-in is not on the server yet").waitFor();
      await audit("another account");

      // A reload in the middle: this device's account, its data kept, nothing sent
      await page.reload();
      await button(/Not synced/).waitFor();
      assertEquals(await idb(page, "meta", "account_id"), own);
      assertEquals(await idb(page, "outbox"), 1);

      // "Back" ends the other account's session here
      await signInAs(other);
      await button("Back").click();
      await button(NOW).waitFor();
      assertEquals(
        await page.evaluate(async () => (await fetch("/api/session")).status),
        401,
      );
      assertEquals(await idb(page, "meta", "account_id"), own);

      // "Use a different account" before any code; Back returns to the sign-in
      await signInToSync();
      await button("Use a different account").click();
      await heading("Use a different account?").waitFor();
      await button("Back").click();
      await heading("Sign in to sync").waitFor();
      await button("Back").click();
      await button(NOW).waitFor();

      // Clearing: the unsynced check-in takes a second tap, then the new account
      await signInAs(third);
      await button("Clear this browser and continue").click();
      await page.getByRole("dialog").getByRole("button", {
        name: "Discard 1 unsynced check-in",
      }).click();
      await page.getByLabel(/^Passphrase/).waitFor({ timeout: 30_000 });
      const now = await idb(page, "meta", "account_id");
      assert(typeof now === "string" && now !== own);
      assertEquals(await idb(page, "outbox"), 0);
      assertEquals(await idb(page, "entries"), 0);

      assertEquals(uploads, []);
      assertEquals(a11y, []);
      assertEquals(await drain(), []);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name:
    "e2e - invite only, no invite sent: the code screen leads back to the invite field",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer({ REGISTRATION: "invite" });
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await page.goto(server.url);
      await page.getByRole("heading", {
        level: 1,
        name: "Sign in",
        exact: true,
      }).waitFor();
      await page.getByLabel("Email").fill("new@example.com");
      await page.getByRole("button", { name: "Send code", exact: true })
        .click();
      await page.getByText("No code? A new account needs an invite code.")
        .waitFor();
      await page.getByRole("button", { name: "Add an invite code" }).click();
      await page.getByLabel("Invite code").waitFor();
      assertEquals(
        await page.evaluate(() => document.activeElement?.id),
        "invite-input",
      );
      assertEquals(
        await page.getByLabel("Email").inputValue(),
        "new@example.com",
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});

Deno.test({
  name: "e2e - anyone can sign up: no invite needed on an open server",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await page.clock.install();
      await page.goto(server.url);
      await page.getByRole("heading", {
        level: 1,
        name: "Sign in or create an account",
      }).waitFor();
      await page.getByLabel("Email").fill("anyone@example.com");
      // A mistyped invite stops nothing: it is left out
      await page.getByRole("button", { name: "I have an invite code" }).click();
      await page.getByLabel("Invite code").fill("NOTACODE1234");
      await page.getByRole("button", { name: "Send code", exact: true })
        .click();
      await page.getByLabel("Six-digit code").waitFor();
      await page.clock.fastForward(61_000);
      for (
        const note of [
          "A new account needs an invite code",
          "Check the invite code",
        ]
      ) {
        assertEquals(await page.getByText(note).count(), 0, note);
      }
      await page.getByLabel("Six-digit code").fill(
        await server.mailCode("anyone@example.com"),
      );
      // A new account: on to its passphrase
      await page.getByLabel(/^Passphrase/).waitFor();
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
