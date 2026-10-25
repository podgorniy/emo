// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The reach capture (ui.md §4.5 "Reach v2"; the review behind
 * the bottom-reach plan): every state the reach audit walks (e2e/states.ts),
 * as a screenshot and an inventory of every control's box against the thumb
 * band (`bandTop`, client/src/lib/band.ts), for people to look at. The gate
 * is e2e/audit.e2e.ts; this only records.
 *
 * Usage (needs bin/emo and Chromium: `make capture` builds and installs
 * both, then runs this with ARGS):
 *
 *   deno run -A tools/capture_reach.ts [--out DIR] [--config 390x844@en,...]
 *     [--matrix review|default|full] [--keyboard=false]
 *
 * --out       where to write (default e2e/report/capture, gitignored):
 *             DIR/<config>/<NN>-<state>.png, DIR/<config>/<NN>-<state>+kb.png
 *             (the first text field focused, the keyboard drawn as a grey
 *             box) and DIR/inventory.json
 * --config    these configurations (`WxH@locale`, sizes as in states.ts)
 * --matrix    review: en at 390×844 and 375×667 (the default); default: the
 *             audit's CI matrix; full: every language at every size
 * --keyboard  false: no keyboard screenshots
 *
 * One configuration at a time, each against its own server (bin/emo, or
 * EMO_BIN).
 */
import * as path from "node:path";
import type { Page } from "playwright-core";
import { launchBrowser, ROOT, startServer } from "../e2e/harness.ts";
import { hideKeyboard, showKeyboard } from "../e2e/keyboard.ts";
import {
  openConfig,
  type ReachConfig,
  reachConfigs,
  type ReachState,
  walkStates,
} from "../e2e/states.ts";
import { bandTop } from "../client/src/lib/band.ts";

function arg(name: string): string | undefined {
  const at = Deno.args.findIndex((a) =>
    a === `--${name}` || a.startsWith(`--${name}=`)
  );
  if (at < 0) return undefined;
  const a = Deno.args[at];
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : Deno.args[at + 1];
}

const OUT = path.resolve(arg("out") ?? path.join(ROOT, "e2e/report/capture"));
const KEYBOARD = arg("keyboard") !== "false";
const matrix = arg("matrix") ?? "review";
const wanted = arg("config")?.split(",").map((s) => s.trim());
const CONFIGS: ReachConfig[] = wanted
  ? reachConfigs(true).filter((c) => wanted.includes(c.id))
  : matrix === "full"
  ? reachConfigs(true)
  : matrix === "default"
  ? reachConfigs(false)
  : reachConfigs(false).filter((c) =>
    c.id === "390x844@en" || c.id === "375x667@en"
  );
if (!CONFIGS.length) {
  console.error(`No configuration matches ${wanted?.join(", ") ?? matrix}`);
  Deno.exit(2);
}

// deno-lint-ignore no-explicit-any
type Json = any;

/**
 * Runs in the page: every rendered control (and other tab stop) with its
 * box, where it sits against the band, what clips or covers it, and the
 * page's scrollers.
 */
function inventory(o: { bandTop: number }): Json {
  const vv = globalThis.visualViewport;
  const H = vv?.height ?? innerHeight;
  const W = innerWidth;
  const SEL_CONTROL = [
    "button",
    "a[href]",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=slider]",
    "[role=radio]",
    "[role=switch]",
    "[role=tab]",
    "[role=checkbox]",
    "[role=option]",
    "[role=menuitem]",
    "[contenteditable=true]",
  ].join(",");
  const SEL_TAB = '[tabindex]:not([tabindex="-1"])';
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const text = (s: string | null | undefined) =>
    (s ?? "").replace(/\s+/g, " ").trim();
  const short = (el: Element | null): string => {
    if (!el) return "";
    const parts: string[] = [];
    let e: Element | null = el;
    for (let i = 0; e && i < 4; i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) {
        parts.unshift(`${s}#${e.id}`);
        break;
      }
      const cls = [...e.classList].filter((c) => !c.startsWith("svelte-"))
        .slice(0, 2);
      if (cls.length) s += "." + cls.join(".");
      parts.unshift(s);
      e = e.parentElement;
    }
    return parts.join(" > ");
  };
  const isScroller = (el: Element) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(cs.overflowY) &&
      el.scrollHeight > el.clientHeight + 1;
  };
  const nameOf = (el: HTMLElement): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return text(aria).slice(0, 60);
    const labels = (el as HTMLInputElement).labels;
    if (labels?.length) {
      return text([...labels].map((l) => l.textContent).join(" ")).slice(0, 60);
    }
    return (text(el.textContent) || text((el as HTMLInputElement).value) ||
      text(el.getAttribute("placeholder")) || text(el.getAttribute("title")))
      .slice(0, 60);
  };
  const modal = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], dialog:modal',
    ),
  ].filter((d) => d.checkVisibility() && d.getBoundingClientRect().height > 0)
    .at(-1) ?? null;
  const controls: Json[] = [];
  const all = new Set<HTMLElement>([
    ...document.querySelectorAll<HTMLElement>(SEL_CONTROL),
    ...document.querySelectorAll<HTMLElement>(SEL_TAB),
  ]);
  for (const el of all) {
    if (
      !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    ) {
      continue;
    }
    let r = el.getBoundingClientRect();
    let label: Element | null = null;
    if (r.width <= 1 || r.height <= 1) {
      label = el.closest("label") ??
        (el.id
          ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
          : null);
      if (!label) continue;
      r = label.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
    }
    let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
    let clippedBy: string | null = null;
    let pinned: string | null = null;
    if (getComputedStyle(el).position === "fixed") pinned = "fixed";
    else {
      for (
        let p = el.parentElement;
        p && p !== document.documentElement;
        p = p.parentElement
      ) {
        const pcs = getComputedStyle(p);
        if (
          !pinned && (pcs.position === "fixed" || pcs.position === "sticky")
        ) {
          pinned = pcs.position;
        }
        if (pcs.overflowY !== "visible" || pcs.overflowX !== "visible") {
          const pr = p.getBoundingClientRect();
          const nt = Math.max(top, pr.top), nb = Math.min(bottom, pr.bottom);
          const nl = Math.max(left, pr.left), nr = Math.min(right, pr.right);
          if ((nb <= nt || nr <= nl) && !clippedBy) clippedBy = short(p);
          top = nt;
          bottom = nb;
          left = nl;
          right = nr;
        }
        if (pcs.position === "fixed") break;
      }
    }
    top = Math.max(top, 0);
    bottom = Math.min(bottom, H);
    left = Math.max(left, 0);
    right = Math.min(right, W);
    const inView = bottom > top && right > left;
    const zone = !inView
      ? "offscreen"
      : r.top >= o.bandTop - 1
      ? "band"
      : "above";
    let hitOk: boolean | null = null;
    let coveredBy: string | null = null;
    if (inView) {
      const hit = document.elementFromPoint(
        (left + right) / 2,
        (top + bottom) / 2,
      );
      hitOk = !!hit &&
        (hit === el || el.contains(hit) || !!label?.contains(hit));
      if (!hitOk) coveredBy = short(hit);
    }
    const inert = !!el.closest("[inert]");
    const ariaHidden = !!el.closest('[aria-hidden="true"]');
    const outsideModal = !!modal && !modal.contains(el);
    const tabOnly = !el.matches(SEL_CONTROL);
    const kind = tabOnly
      ? (isScroller(el) ? "scroll-region" : "focusable")
      : "control";
    controls.push({
      path: short(el),
      name: nameOf(el),
      kind,
      disabled: !!(el as HTMLButtonElement).disabled ||
        el.getAttribute("aria-disabled") === "true",
      rect: {
        top: r1(r.top),
        bottom: r1(r.bottom),
        left: r1(r.left),
        right: r1(r.right),
      },
      zone,
      inView,
      clippedBy,
      hitOk,
      coveredBy,
      pinned,
      interactive: kind !== "scroll-region" && !inert && !ariaHidden &&
        !outsideModal,
    });
  }
  const scrollers: Json[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    if (!isScroller(el)) continue;
    const rr = el.getBoundingClientRect();
    if (rr.width === 0 || rr.height === 0) continue;
    scrollers.push({
      path: el === document.body ? "body" : short(el),
      scrollTop: Math.round(el.scrollTop),
      maxScroll: el.scrollHeight - el.clientHeight,
      top: r1(rr.top),
      bottom: r1(rr.bottom),
    });
  }
  const counted = controls.filter((c) => c.interactive && c.inView);
  return {
    url: location.pathname + location.search + location.hash,
    h1: text(document.querySelector("h1")?.textContent).slice(0, 80),
    viewport: { width: W, height: innerHeight, visual: H },
    bandTop: r1(o.bandTop),
    modal: modal ? short(modal) : null,
    counts: {
      inView: counted.length,
      inBand: counted.filter((c) => c.zone === "band").length,
      aboveBand: counted.filter((c) => c.zone === "above").length,
      covered: counted.filter((c) => c.hitOk === false).length,
      offscreen: controls.filter((c) => c.interactive && !c.inView).length,
    },
    aboveBand: counted.filter((c) => c.zone === "above").map((c) =>
      `${c.name || c.path} @${c.rect.top}${c.pinned ? ` [${c.pinned}]` : ""}`
    ),
    scrollers,
    controls,
  };
}

/** The first text field on screen focused under the keyboard, drawn grey */
async function keyboardShot(page: Page, px: number, file: string) {
  const field = await page.evaluate(() => {
    const TEXT = /^(text|email|password|search|tel|url|number)$/;
    const modal = [
      ...document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ].filter((d) => d.checkVisibility()).at(-1);
    const el = [
      ...document.querySelectorAll<HTMLElement>("input, textarea"),
    ].find((el) => {
      if (el instanceof HTMLInputElement && !TEXT.test(el.type)) return false;
      if (modal && !modal.contains(el)) return false;
      const r = el.getBoundingClientRect();
      return !(el as HTMLInputElement).disabled && el.checkVisibility() &&
        r.height > 1 && r.bottom > 0 && r.top < innerHeight;
    });
    if (!el) return false;
    const g = globalThis as unknown as {
      emoCapture?: { active: Element | null; scroll: [Element, number][] };
    };
    g.emoCapture = {
      active: document.activeElement,
      scroll: [document.body, ...document.querySelectorAll("*")]
        .filter((s) => s.scrollTop !== 0).map((s) => [s, s.scrollTop]),
    };
    el.setAttribute("data-capture-kb", "");
    return true;
  });
  if (!field) return false;
  await page.locator("[data-capture-kb]").focus();
  await showKeyboard(page, px);
  await page.waitForTimeout(250);
  await page.evaluate((px) => {
    const box = document.createElement("div");
    box.id = "capture-keyboard";
    box.style.cssText =
      `position:fixed;left:0;right:0;bottom:0;height:${px}px;` +
      "background:rgb(120 120 128 / 0.55);z-index:2147483647;pointer-events:none";
    document.documentElement.append(box);
  }, px);
  await page.screenshot({ path: file, timeout: 15_000 });
  await page.evaluate(() => {
    document.getElementById("capture-keyboard")?.remove();
    const el = document.querySelector("[data-capture-kb]") as HTMLElement;
    el?.removeAttribute("data-capture-kb");
    el?.blur();
    const g = globalThis as unknown as {
      emoCapture?: { active: Element | null; scroll: [Element, number][] };
    };
    const active = g.emoCapture?.active as HTMLElement | null;
    if (active && active !== document.body) {
      active.focus?.({ preventScroll: true });
    }
    for (const [s, top] of g.emoCapture?.scroll ?? []) s.scrollTop = top;
  });
  await hideKeyboard(page);
  return true;
}

const records: Json[] = [];
const failures: string[] = [];

async function flush() {
  await Deno.writeTextFile(
    path.join(OUT, "inventory.json"),
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        configs: CONFIGS.map((c) => c.id),
        failures,
        states: records,
      },
      null,
      1,
    ),
  );
}

async function capture(state: ReachState, cfg: ReachConfig, n: number) {
  const dir = path.join(OUT, cfg.id);
  const base = `${String(n).padStart(2, "0")}-${state.name}`;
  const page = state.page;
  const screenshot = path.join(dir, `${base}.png`);
  await page.screenshot({ path: screenshot, timeout: 15_000 });
  const h = await page.evaluate(() =>
    globalThis.visualViewport?.height ?? innerHeight
  );
  const inv = await page.evaluate(inventory, { bandTop: bandTop(h) });
  let keyboard: string | null = null;
  if (KEYBOARD && state.kind === "rest" && state.keyboard !== false) {
    const file = path.join(dir, `${base}+kb.png`);
    if (await keyboardShot(page, cfg.size.keyboard, file)) keyboard = file;
  }
  records.push({
    config: cfg.id,
    name: state.name,
    screen: state.screen,
    kind: state.kind,
    step: state.step ?? null,
    notes: state.notes,
    screenshot: path.relative(OUT, screenshot),
    keyboard: keyboard && path.relative(OUT, keyboard),
    ...inv,
  });
  console.log(
    `${cfg.id} ${
      String(n).padStart(2, "0")
    } ${state.name}: ${inv.counts.aboveBand} of ${inv.counts.inView} above the band`,
  );
}

await Deno.mkdir(OUT, { recursive: true });
const browser = await launchBrowser();
try {
  for (const cfg of CONFIGS) {
    await Deno.mkdir(path.join(OUT, cfg.id), { recursive: true });
    const server = await startServer();
    try {
      const session = await openConfig(browser, cfg);
      const errors: string[] = [];
      let n = 0;
      for await (
        const state of walkStates(session.page, {
          server,
          config: cfg,
          context: session.context,
          newPage: session.newPage,
          errors,
        })
      ) {
        try {
          await capture(state, cfg, ++n);
        } catch (err) {
          failures.push(
            `${cfg.id} ${state.name}: ${String(err).split("\n")[0]}`,
          );
        }
        await flush();
      }
      failures.push(...errors);
      await session.context.close();
    } finally {
      await server.stop().catch(() => -1);
    }
  }
} finally {
  await flush();
  await browser.close().catch(() => {});
}
console.log(
  `${records.length} states captured into ${OUT}${
    failures.length ? `\nFailures:\n  ${failures.join("\n  ")}` : ""
  }`,
);
if (failures.length) Deno.exit(1);
