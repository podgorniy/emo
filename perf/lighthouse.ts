// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Lighthouse (mobile, simulated throttling: Lighthouse's defaults) against the
 * built binary, as one user flow (performance.md §1.4, §5): the sign-in
 * screen on a first visit (storage cleared), then, signed in through
 * Playwright in the same profile, Home and check-in step 1 (`/now`), and
 * Settings (opened from Home: a timespan, then a snapshot). Writes
 * `perf/report/lighthouse.{html,json}` and returns one row per step.
 *
 * Lighthouse 12+ has no PWA category; installability and offline are left to
 * the e2e smoke (Milestone 7).
 */
import * as path from "node:path";
import { chromium } from "playwright-core";
import puppeteer from "puppeteer-core";
import { startFlow } from "lighthouse";
import { ROOT, signUp, startServer } from "../e2e/harness.ts";

/** performance.md §1.4 */
export const MINIMUM: Record<string, number> = {
  performance: 0.9,
  accessibility: 0.9,
  "best-practices": 0.9,
};

export interface LighthouseRow {
  step: string;
  /** Category → score 0..1; only the categories of MINIMUM a step has. */
  scores: Record<string, number>;
  failed: string[];
}

export async function runLighthouse(
  reportDir: string,
): Promise<LighthouseRow[]> {
  const server = await startServer();
  const profile = await Deno.makeTempDir({ prefix: "emo-perf-" });
  const context = await chromium.launchPersistentContext(profile, {
    locale: "en-GB",
    args: ["--remote-debugging-port=0"],
  });
  try {
    const port = (await Deno.readTextFile(
      path.join(profile, "DevToolsActivePort"),
    )).split("\n")[0];
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${port}`,
      defaultViewport: null,
    });
    const page = await browser.newPage();
    const flow = await startFlow(page, { name: "Emo" });

    await flow.navigate(server.url, {
      name: "Sign-in, first visit",
      disableStorageReset: false,
    });

    // Signed in through Playwright: same profile, so the same storage
    const setup = await context.newPage();
    await signUp(setup, server);
    await setup.close();

    await flow.navigate(server.url, {
      name: "Home",
      disableStorageReset: true,
    });
    await page.waitForSelector("button.now");
    await flow.navigate(`${server.url}/now`, {
      name: "Check-in step 1",
      disableStorageReset: true,
    });
    await page.waitForSelector("button.next");

    // Step 1 left a draft, which reopens at start (ui.md §6.2): close the form
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Close")?.click()
    );
    await page.waitForSelector("button.now");
    await flow.startTimespan({ name: "Open Settings" });
    await page.click('button.pane-dot:not([aria-current="page"])');
    await page.waitForSelector("[role=radiogroup]");
    await flow.endTimespan();
    await flow.snapshot({ name: "Settings" });

    await Deno.mkdir(reportDir, { recursive: true });
    await Deno.writeTextFile(
      path.join(reportDir, "lighthouse.html"),
      await flow.generateReport(),
    );
    const result = await flow.createFlowResult();
    await Deno.writeTextFile(
      path.join(reportDir, "lighthouse.json"),
      JSON.stringify(result),
    );
    await browser.disconnect();

    return result.steps.map((s) => {
      const scores: Record<string, number> = {};
      const failed: string[] = [];
      for (const [id, min] of Object.entries(MINIMUM)) {
        const category = s.lhr.categories[id];
        // A snapshot has a performance category without weighted audits
        if (
          typeof category?.score !== "number" ||
          !category.auditRefs.some((a) => a.weight > 0)
        ) continue;
        scores[id] = category.score;
        if (category.score < min) failed.push(id);
      }
      return { step: s.name, scores, failed };
    });
  } finally {
    await context.close();
    await server.stop();
    await Deno.remove(profile, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) {
  const rows = await runLighthouse(path.join(ROOT, "perf/report"));
  for (const r of rows) console.log(r.step, r.scores, r.failed);
  Deno.exit(rows.some((r) => r.failed.length) ? 1 : 0);
}
