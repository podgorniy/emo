// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `make perf` (performance.md §5–§6, ops.md §1): Lighthouse on the built
 * binary, the bundle-size table and the Deno benches, printed as one report
 * and written to `perf/report/` (`summary.md`, `lighthouse.html`,
 * `lighthouse.json`). Fails when a Lighthouse category or a size is below its
 * minimum; benches are informational. Device timings stay manual
 * (`llm/perf_log.md`).
 */
import * as path from "node:path";
import { MINIMUM, runLighthouse } from "./lighthouse.ts";
import { ROOT } from "../e2e/harness.ts";

const REPORT = path.join(ROOT, "perf/report");
const BENCHES = ["shared/entry.bench.ts", "server/services/scheduler.bench.ts"];

async function deno(args: string[]): Promise<{ ok: boolean; text: string }> {
  const out = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: ROOT,
    env: { NO_COLOR: "1", LOG_LEVEL: "warn" },
  }).output();
  const decode = (b: Uint8Array) => new TextDecoder().decode(b);
  return {
    ok: out.success,
    text: (decode(out.stdout) + decode(out.stderr)).trim(),
  };
}

const sizes = await deno(["run", "-A", "perf/check_budget.ts"]);
const benches = await deno(["bench", "-A", "--quiet", ...BENCHES]);
const lighthouse = await runLighthouse(REPORT);

const version = (await Deno.readTextFile(path.join(ROOT, "VERSION"))).trim();
const commit = await new Deno.Command("git", {
  args: ["rev-parse", "--short", "HEAD"],
  cwd: ROOT,
}).output().then((o) => new TextDecoder().decode(o.stdout).trim(), () => "?");

const pct = (score: number | undefined) =>
  score === undefined ? "—" : String(Math.round(score * 100));
const categories = Object.keys(MINIMUM);
const lines = [
  `# make perf — ${
    new Date().toISOString().slice(0, 16)
  }Z, ${version} (${commit})`,
  "",
  `## Lighthouse (mobile, simulated throttling; minimum ${
    categories.map((c) => `${c} ${MINIMUM[c] * 100}`).join(", ")
  })`,
  "",
  `| Step | ${categories.join(" | ")} | |`,
  `| :--- | ${categories.map(() => "---:").join(" | ")} | :--- |`,
  ...lighthouse.map((r) =>
    `| ${r.step} | ${categories.map((c) => pct(r.scores[c])).join(" | ")} | ${
      r.failed.length ? `**below: ${r.failed.join(", ")}**` : "ok"
    } |`
  ),
  "",
  "Details: `perf/report/lighthouse.html`.",
  "",
  "## Bundle sizes (`perf/budgets.json`)",
  "",
  "```text",
  sizes.text,
  "```",
  "",
  "## Benches (Deno on this machine; informational)",
  "",
  "```text",
  benches.text,
  "```",
  "",
];
const summary = lines.join("\n");
await Deno.mkdir(REPORT, { recursive: true });
await Deno.writeTextFile(path.join(REPORT, "summary.md"), summary);
console.log(summary);

const failed = !sizes.ok || lighthouse.some((r) => r.failed.length > 0);
if (failed) {
  console.error(
    "make perf: below the minimum (performance.md §1.4, §1.1)",
  );
}
Deno.exit(failed ? 1 : 0);
