// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Export (architecture.md §10) from Settings in a real browser: the export code
 * is a lazy chunk (performance.md §3.3) fetched on the first tap, and
 * the files still download.
 */
import { assertEquals } from "@std/assert";
import { launchBrowser, signUp, startServer } from "./harness.ts";

Deno.test({
  name: "e2e - export loads on first use and downloads its files",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const server = await startServer();
    const browser = await launchBrowser();
    try {
      const page = await (await browser.newContext({ locale: "en-GB" }))
        .newPage();
      await signUp(page, server);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: /^Export/ }).click();

      const fetched: string[] = [];
      page.on("request", (r) => fetched.push(new URL(r.url()).pathname));
      const names: string[] = [];
      const contents = new Map<string, string>();
      const two = new Promise<void>((resolve) => {
        page.on("download", async (d) => {
          const path = await d.path();
          names.push(d.suggestedFilename());
          contents.set(d.suggestedFilename(), await Deno.readTextFile(path));
          // Both read, not just both named: the reads finish in any order
          if (contents.size === 2) resolve();
        });
      });
      await page.getByRole("button", { name: /^Full data for analysis/ })
        .click();
      await two;

      assertEquals(names.sort(), ["dictionaries.json", "entries.jsonl"]);
      // "Saved {filename}" after the download (UX-23)
      await page.getByRole("status").filter({
        hasText: "Saved entries.jsonl, dictionaries.json",
      }).waitFor();
      assertEquals(contents.get("entries.jsonl"), "");
      assertEquals(
        JSON.parse(contents.get("dictionaries.json")!).schema_v,
        2,
      );
      assertEquals(
        fetched.some((p) => /^\/assets\/export-[\w-]+\.js$/.test(p)),
        true,
        fetched.join(" "),
      );
      // What the fields mean: the methodology's field map, in the app's
      // language (legal.e2e.ts opens the page itself)
      assertEquals(
        await page.getByRole("link", { name: "What each field means" })
          .getAttribute("href"),
        "/methodology#en-s4",
      );
    } finally {
      await browser.close();
      await server.stop();
    }
  },
});
