// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * development.md §5.1: the stored crypto vectors in Chromium, not only in Deno.
 * The cases (`shared/crypto/vectors.ts`) are bundled and served on a routed
 * `localhost` page (a secure context, so WebCrypto is there); no server needed.
 */
import { assertEquals } from "@std/assert";
import * as path from "node:path";
import { launchBrowser, ROOT } from "./harness.ts";

Deno.test("e2e - the crypto vectors open and reproduce in Chromium", async () => {
  const out = await new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--quiet",
      "--platform",
      "browser",
      path.join(ROOT, "e2e/vectors_entry.ts"),
    ],
    cwd: ROOT,
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  const script = new TextDecoder().decode(out.stdout);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.route("http://localhost/vectors.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>vectors</title>",
      }));
    await page.route(
      "http://localhost/vectors.js",
      (route) =>
        route.fulfill({ contentType: "text/javascript", body: script }),
    );
    await page.goto("http://localhost/vectors.html");
    await page.addScriptTag({ url: "/vectors.js", type: "module" });
    const results = await page.evaluate(() =>
      (globalThis as unknown as {
        runVectors: () => Promise<{ name: string; error: string | null }[]>;
      }).runVectors()
    );
    assertEquals(results.length, 4);
    assertEquals(results.filter((r) => r.error), []);
  } finally {
    await browser.close();
  }
});
