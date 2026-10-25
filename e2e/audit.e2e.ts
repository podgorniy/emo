// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The at-rest reach audit (ui.md §1.12, §4.5 "Reach v2"):
 * on a phone every control rests in the thumb band, the bottom third of the
 * keyboard-free visual viewport (the bottom half, at least 300 px, under
 * 500 px tall: `bandTop`, client/src/lib/band.ts). e2e/states.ts walks every
 * screen per configuration; each state is held to:
 *
 * (a) "rest" states: every interactive control — button, a[href], input,
 *     select, textarea, summary, the control roles and [tabindex ≥ 0],
 *     disabled ones included — has its top at or below the band's top and
 *     its bottom on the screen. Its box is taken as the scrollers inside the
 *     page clip it (a list that scrolls in itself), not as the page scrolls:
 *     a control the page has scrolled off the screen counts. Not counted:
 *     display:none, visibility:hidden, opacity 0, inert and aria-hidden
 *     subtrees; anything outside an open modal sheet (behind its backdrop);
 *     visually hidden helpers (≤ 1 px, unless a label stands for them) and
 *     controls wholly off the side of the screen (skip links); a region
 *     focusable only so a keyboard can scroll it (WCAG 2.1.1); a control its
 *     list has scrolled wholly out of view.
 * (b) every primary, nav, pin and dock control (`KEY`) is whole inside the
 *     visual viewport, not clipped by a scroller, and a tap at its centre
 *     reaches it (elementFromPoint hits it or a descendant).
 * (c) the instrument exceptions, which may reach above the band:
 *     `.bodymap .hit` on step 1 — the whole figure on screen and every
 *     zone at least `ZONE_MIN` px tall (and `ZONE_MIN_W` wide), each
 *     reachable at its centre; `main .answer` on steps 2, 6, 7 and 9 — every
 *     option on screen (step 2: at least `STEP2_MIN`, today's copy-5
 *     count) and every null answer on screen.
 *
 * "scrolled" states hold only the pinned controls (`PINNED`) to (a) and (b).
 * The keyboard check: in each rest state with a text field on screen, each
 * field (up to four) is focused under a stubbed on-screen keyboard
 * (e2e/keyboard.ts; `Size.keyboard` px): the field and its submit must be
 * whole between the visual viewport's top and the keyboard, each ending
 * within `KB_GAP` px of the keyboard's top. It is reported as `<state>+kb`.
 *
 * PENDING (e2e/reach_pending.ts): a failing state listed there is reported
 * (the summary here and e2e/report/reach_audit.json), not failed; a failure
 * not listed fails the test, and so does a phase the walker could not
 * finish. REACH_STRICT=1 also fails on a listed state that passes, or an
 * entry nothing ran matched. REACH_FULL=1 runs every language at every size;
 * REACH_WRITE=1 rewrites PENDING from this run's failures (REACH_WRITE=add
 * adds them to the entries there: a state that fails only now and then is
 * pending too); REACH_JOBS=n
 * sets how many configurations run side by side (default 5);
 * REACH_ONLY=390x844@en,… runs just those; REACH_VERBOSE=1 logs each state.
 */
import { assertEquals } from "@std/assert";
import type { Browser, Page } from "playwright-core";
import { launchBrowser, ROOT, startServer } from "./harness.ts";
import { hideKeyboard, showKeyboard } from "./keyboard.ts";
import { PENDING } from "./reach_pending.ts";
import {
  nullLabels,
  openConfig,
  type ReachConfig,
  reachConfigs,
  type ReachState,
  type Screen,
  screenOf,
  walkStates,
} from "./states.ts";
import { bandTop } from "../client/src/lib/band.ts";

const env = (name: string) => Deno.env.get(name) === "1";
const FULL = env("REACH_FULL");
const STRICT = env("REACH_STRICT");
const WRITE = Deno.env.get("REACH_WRITE");
const VERBOSE = env("REACH_VERBOSE");
const JOBS = Math.max(1, Number(Deno.env.get("REACH_JOBS") ?? 5));
const REPORT = `${ROOT}/e2e/report/reach_audit.json`;
const PENDING_FILE = `${ROOT}/e2e/reach_pending.ts`;

/**
 * (b): the primaries (Button's `primary` variant and the hand-made ones:
 * Next, Done, Go to it, Restart, Undo), the sheet actions, the pane dots,
 * the check-in footer (Back, Next, Stop here or Skip check-in, ×, the pinned
 * null answers), Saved's actions, the toast, and whatever a later phase
 * pins with `data-reach-pin` (the bottom dock).
 */
const KEY = [
  ".btn-primary",
  '[role="dialog"] .actions button',
  "nav.dots button",
  "footer.foot button",
  ".saved .actions button",
  "[data-null]",
  ".toast-container button",
  "button[data-reach-pin]",
  "[data-reach-pin] button",
].join(", ");

/** The controls that stay put while their screen scrolls */
const PINNED = [
  '[role="dialog"] .actions button',
  "nav.dots button",
  "footer.foot button",
  ".saved .actions button",
  ".toast-container button",
  "button[data-reach-pin]",
  "[data-reach-pin] button",
].join(", ");

/**
 * Body zones (plan, owner decision 2 a): the shortest zones are 44 units of
 * the 520-unit figure (ui.md §10), so 36 px tall is the figure at
 * 36/44 of its 1× size, today's 37 px at 375×667. The narrowest zones are 36
 * units wide: at that same scale, 29.5 px.
 */
const ZONE_MIN = 36;
const ZONE_MIN_W = ZONE_MIN * 36 / 44;

/**
 * Step 2's options fully on screen at rest when the step opens, measured
 * per configuration on the copy-5 layout (Phase 1, 2026-10-11): the phone
 * composition may not show fewer (plan, owner decision 2 b; 18 of 21 at
 * 390×844). The summary prints this run's counts.
 */
const STEP2_MIN: Record<string, number> = {
  "390x844@en": 18,
  "390x844@ru": 18,
  "390x844@uk": 18,
  "375x667@en": 12,
  "375x667@ru": 12,
  "375x667@uk": 12,
  "390x664@en": 12,
  "390x664@ru": 10,
  "390x664@uk": 10,
  "844x390@en": 2,
  "844x390@ru": 2,
  "844x390@uk": 2,
  "390x844+sb34@en": 16,
  "390x844+sb34@ru": 16,
  "390x844+sb34@uk": 16,
};

/** How far above the keyboard's top a focused field and its submit may end */
const KB_GAP = 120;

// ---------------------------------------------------------------- the probe

type Probe =
  | {
    mode: "inspect";
    kind: ReachState["kind"];
    step: number | null;
    bandTop: number;
    key: string;
    pinned: string;
    nulls: string[];
    zoneMin: number;
    zoneMinW: number;
    step2Min: number | null;
  }
  | { mode: "viewport" }
  | { mode: "fields" }
  | { mode: "save" }
  | { mode: "keyboard"; index: number; gap: number }
  | { mode: "restore" };

interface Inspected {
  problems: string[];
  /** Step 2/6/7/9: options fully on screen, of all */
  options: { shown: number; total: number } | null;
}

/**
 * Everything measured in the page, in one self-contained function (it is
 * serialised into the page): `inspect` the criteria (a)–(c); `viewport` the
 * visual viewport's height; `fields` marks the text fields on screen
 * (`data-reach-kb`); `save` / `restore` the focus and every scroll position
 * around a keyboard check; `keyboard` the check itself.
 */
function probe(p: Probe): unknown {
  const vvApi = globalThis.visualViewport;
  const region = {
    top: vvApi?.offsetTop ?? 0,
    bottom: (vvApi?.offsetTop ?? 0) + (vvApi?.height ?? innerHeight),
    left: vvApi?.offsetLeft ?? 0,
    right: (vvApi?.offsetLeft ?? 0) + (vvApi?.width ?? innerWidth),
  };
  if (p.mode === "viewport") return region.bottom - region.top;

  type Box = { top: number; bottom: number; left: number; right: number };
  const r0 = (n: number) => Math.round(n);
  const text = (s: string | null | undefined) =>
    (s ?? "").replace(/\s+/g, " ").trim();
  const tagOf = (el: Element) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    for (
      const c of [...el.classList].filter((c) => !c.startsWith("svelte-"))
        .slice(0, 2)
    ) s += `.${c}`;
    return s;
  };
  const who = (el: Element) => {
    const h = el as HTMLInputElement;
    const name = text(
      el.getAttribute("aria-label") || h.labels?.[0]?.textContent ||
        el.textContent || h.placeholder,
    ).slice(0, 40);
    return name ? `"${name}" (${tagOf(el)})` : tagOf(el);
  };
  const modal = [
    ...document.querySelectorAll(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog:modal',
    ),
  ].filter((d) => d.checkVisibility() && d.getBoundingClientRect().height > 0)
    .at(-1) ?? null;
  const shown = (el: Element) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    !el.closest('[inert], [aria-hidden="true"]') &&
    (!modal || modal.contains(el));
  /** Its box, or its label's for a visually hidden input */
  const boxOf = (el: Element): { r: DOMRect; via: Element | null } | null => {
    const r = el.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) return { r, via: null };
    const via = el.closest("label") ??
      (el.id
        ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        : null);
    if (!via) return null;
    const lr = via.getBoundingClientRect();
    return lr.width > 1 && lr.height > 1 ? { r: lr, via } : null;
  };
  /**
   * The part of `r` its scrollers and `area` leave visible; `page: false`
   * leaves out the page's own scroller (the body), so only the scrollers
   * inside the page clip it
   */
  const clip = (el: Element, r: Box, area: Box, page = true) => {
    let { top, bottom, left, right } = r;
    let by: Element | null = null;
    if (getComputedStyle(el).position !== "fixed") {
      for (
        let a = el.parentElement;
        a && a !== document.documentElement;
        a = a.parentElement
      ) {
        const cs = getComputedStyle(a);
        if (!page && a === document.body) break;
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
          const ar = a.getBoundingClientRect();
          const t = Math.max(top, ar.top), b = Math.min(bottom, ar.bottom);
          const l = Math.max(left, ar.left), rt = Math.min(right, ar.right);
          if (
            !by &&
            (t > top + 1 || b < bottom - 1 || l > left + 1 || rt < right - 1)
          ) by = a;
          top = t;
          bottom = b;
          left = l;
          right = rt;
        }
        if (cs.position === "fixed") break;
      }
    }
    return {
      v: {
        top: Math.max(top, area.top),
        bottom: Math.min(bottom, area.bottom),
        left: Math.max(left, area.left),
        right: Math.min(right, area.right),
      },
      by,
    };
  };
  /** Whole inside `area`, unclipped, and reached by a tap at its centre */
  const onScreen = (
    el: Element,
    area: Box = region,
  ): { ok: true; r: DOMRect } | { ok: false; why: string } => {
    const b = boxOf(el);
    if (!b) return { ok: false, why: "has no box" };
    const { v, by } = clip(el, b.r, area);
    const whole = v.top <= b.r.top + 1 && v.bottom >= b.r.bottom - 1 &&
      v.left <= b.r.left + 1 && v.right >= b.r.right - 1;
    if (!whole) {
      const gone = v.bottom - v.top < 0.5 || v.right - v.left < 0.5;
      const scroller = by && by !== document.body ? ` by ${tagOf(by)}` : "";
      return {
        ok: false,
        why: `${gone ? "off screen" : "cut off"}${scroller} at ${r0(b.r.top)}–${
          r0(b.r.bottom)
        }`,
      };
    }
    const x = (b.r.left + b.r.right) / 2, y = (b.r.top + b.r.bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    const reached = !!hit &&
      (hit === el || el.contains(hit) || !!b.via?.contains(hit));
    if (!reached) {
      return { ok: false, why: `covered by ${hit ? tagOf(hit) : "nothing"}` };
    }
    return { ok: true, r: b.r };
  };
  const g = globalThis as unknown as {
    emoReachKb?: { active: Element | null; scroll: [Element, number][] };
  };

  if (p.mode === "fields") {
    const TEXT = /^(text|email|password|search|tel|url|number)$/;
    const fields = [
      ...document.querySelectorAll<HTMLElement>(
        'input, textarea, [contenteditable="true"]',
      ),
    ].filter((el) => {
      if (el instanceof HTMLInputElement && !TEXT.test(el.type)) return false;
      const f = el as HTMLInputElement;
      if (f.disabled || f.readOnly || !shown(el)) return false;
      const b = boxOf(el);
      if (!b) return false;
      const { v } = clip(el, b.r, region);
      return v.bottom - v.top > 0.5 && v.right - v.left > 0.5;
    }).slice(0, 4);
    fields.forEach((el, i) => el.setAttribute("data-reach-kb", String(i)));
    return fields.length;
  }
  if (p.mode === "save") {
    const scrollers = [
      document.scrollingElement,
      ...document.querySelectorAll("*"),
    ]
      .filter((el): el is Element =>
        !!el && (el.scrollTop !== 0 || el.scrollHeight > el.clientHeight + 1)
      );
    g.emoReachKb = {
      active: document.activeElement,
      scroll: scrollers.map((el) => [el, el.scrollTop]),
    };
    return null;
  }
  if (p.mode === "restore") {
    (document.activeElement as HTMLElement | null)?.blur();
    const saved = g.emoReachKb;
    if (saved?.active && saved.active !== document.body) {
      (saved.active as HTMLElement).focus?.({ preventScroll: true });
    }
    for (const [el, top] of saved?.scroll ?? []) el.scrollTop = top;
    return null;
  }
  if (p.mode === "keyboard") {
    const problems: string[] = [];
    const field = document.querySelector(`[data-reach-kb="${p.index}"]`);
    if (!field) return ["the field went away"];
    if (document.activeElement !== field) {
      problems.push(`${who(field)} lost the focus`);
    }
    // Its submit: the form's, a sheet's confirm, or the check-in's Next
    const submitOf = (el: Element): Element | null => {
      const form = (el as HTMLInputElement).form ?? el.closest("form");
      const own = form
        ? [
          ...form.querySelectorAll(
            'button[type="submit"], button:not([type]), input[type="submit"]',
          ),
        ].find((b) => shown(b) && boxOf(b))
        : null;
      if (own) return own;
      const sheet = el.closest('[role="dialog"]');
      if (sheet) {
        return sheet.querySelector(
          ".actions .btn-primary, .actions .btn.danger",
        ) ??
          [...sheet.querySelectorAll(".actions button")].at(-1) ?? null;
      }
      return el.closest(".flow")?.querySelector("button.next") ?? null;
    };
    const submit = submitOf(field);
    for (const [what, el] of [["field", field], ["submit", submit]] as const) {
      if (!el) continue;
      const s = onScreen(el, region);
      if (!s.ok) {
        problems.push(
          `${what} ${who(el)} ${s.why} (keyboard from ${r0(region.bottom)})`,
        );
      } else if (s.r.bottom < region.bottom - p.gap) {
        problems.push(
          `${what} ${who(el)} ends ${
            r0(region.bottom - s.r.bottom)
          } px above the keyboard`,
        );
      }
    }
    return problems;
  }

  // inspect: the criteria (a)–(c)
  const problems: string[] = [];
  const CONTROL = [
    "button",
    "a[href]",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    "summary",
    ...[
      "button",
      "tab",
      "radio",
      "switch",
      "slider",
      "checkbox",
      "link",
    ].map((r) => `[role="${r}"]`),
  ].join(", ");
  /** Focusable only so a keyboard can scroll it */
  const scrollRegion = (el: Element) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY + cs.overflowX) &&
      (el.scrollHeight > el.clientHeight + 1 ||
        el.scrollWidth > el.clientWidth + 1);
  };
  const controls = new Set<Element>([
    ...document.querySelectorAll(CONTROL),
    ...[...document.querySelectorAll<HTMLElement>("[tabindex]")].filter((el) =>
      el.tabIndex >= 0 && !scrollRegion(el)
    ),
  ]);
  const gridStep = p.step !== null && [2, 6, 7, 9].includes(p.step);
  const exempt = (el: Element) =>
    (p.step === 1 && el.matches(".bodymap .hit")) ||
    (gridStep && el.matches("main .answer"));

  // (a)
  const anywhere = { top: -1e9, bottom: 1e9, left: -1e9, right: 1e9 };
  for (const el of controls) {
    if (!shown(el) || exempt(el)) continue;
    if (p.kind === "scrolled" && !el.matches(p.pinned)) continue;
    const b = boxOf(el);
    if (!b || b.r.right <= 0 || b.r.left >= innerWidth) continue;
    const { v } = clip(el, b.r, anywhere, false);
    if (v.bottom - v.top < 0.5 || v.right - v.left < 0.5) continue;
    if (v.top < p.bandTop - 1) {
      problems.push(
        `${v.bottom <= region.top ? "above the screen" : "above the band"}: ${
          who(el)
        } at ${r0(v.top)} (band from ${r0(p.bandTop)})`,
      );
    } else if (v.bottom > region.bottom + 1) {
      problems.push(
        `below the screen: ${who(el)} at ${r0(v.top)}–${
          r0(v.bottom)
        } (screen to ${r0(region.bottom)})`,
      );
    }
  }

  // (b)
  for (
    const el of new Set(
      document.querySelectorAll(p.kind === "rest" ? p.key : p.pinned),
    )
  ) {
    if (!shown(el) || !boxOf(el)) continue;
    const s = onScreen(el);
    if (!s.ok) problems.push(`not on screen: ${who(el)} ${s.why}`);
  }

  // (c)
  let options: Inspected["options"] = null;
  if (p.kind === "rest" && !modal && p.step === 1) {
    const figure = [...document.querySelectorAll(".bodymap .figure")].find(
      shown,
    );
    if (!figure) problems.push("figure: none on screen");
    else {
      const r = figure.getBoundingClientRect();
      const { v } = clip(figure, r, region);
      if (v.top > r.top + 1 || v.bottom < r.bottom - 1) {
        problems.push(
          `figure not whole: ${r0(r.top)}–${r0(r.bottom)}, on screen ${
            r0(v.top)
          }–${r0(v.bottom)}`,
        );
      }
    }
    for (
      const hit of document.querySelectorAll(
        '.bodymap .hit:not([aria-hidden="true"])',
      )
    ) {
      if (!shown(hit)) continue;
      const r = hit.getBoundingClientRect();
      if (r.height < p.zoneMin - 0.05 || r.width < p.zoneMinW - 0.05) {
        problems.push(
          `zone ${who(hit)} ${r.width.toFixed(1)}×${
            r.height.toFixed(1)
          } px, under ${p.zoneMinW.toFixed(1)}×${p.zoneMin}`,
        );
      }
      const s = onScreen(hit);
      if (!s.ok) problems.push(`zone ${who(hit)} ${s.why}`);
    }
  }
  if (p.kind === "rest" && !modal && gridStep) {
    const all = [...document.querySelectorAll("main .answer")].filter((el) =>
      shown(el) && boxOf(el)
    );
    const missing = all.filter((el) => !onScreen(el).ok);
    options = { shown: all.length - missing.length, total: all.length };
    const nulls = new Set([
      ...all.filter((el) => p.nulls.includes(text(el.textContent))),
      ...[...document.querySelectorAll("[data-null]")].filter(shown),
    ]);
    for (const el of nulls) {
      const s = onScreen(el);
      if (!s.ok) problems.push(`null answer ${who(el)} ${s.why}`);
    }
    if (p.step === 2) {
      if (p.step2Min !== null && options.shown < p.step2Min) {
        problems.push(
          `grid: ${options.shown} of ${options.total} options on screen, under copy 5's ${p.step2Min}`,
        );
      }
    } else if (missing.length) {
      problems.push(
        `grid: ${options.shown} of ${options.total} options on screen; not ${
          missing.slice(0, 4).map(who).join(", ")
        }${missing.length > 4 ? ", …" : ""}`,
      );
    }
  }
  return { problems: [...new Set(problems)], options } satisfies Inspected;
}

/** `probe` in the page */
function run<T>(page: Page, p: Probe): Promise<T> {
  return page.evaluate<unknown, Probe>(probe, p) as Promise<T>;
}

// ---------------------------------------------------------------- one state

interface Result {
  /** "checkin-s2-rest@390x844@en", "auth-passphrase+kb@375x667@ru" */
  key: string;
  state: string;
  config: string;
  kind: ReachState["kind"] | "keyboard";
  problems: string[];
}

/** Each text field on screen focused under a `px` keyboard; null: none */
async function keyboardCheck(page: Page, px: number): Promise<string[] | null> {
  const fields = await run<number>(page, { mode: "fields" });
  const problems: string[] = [];
  for (let i = 0; i < fields; i++) {
    await run(page, { mode: "save" });
    await page.locator(`[data-reach-kb="${i}"]`).focus();
    await showKeyboard(page, px);
    // The app's answer (aboveKeyboard, --kb): instant under reduced motion
    await page.waitForTimeout(250);
    problems.push(
      ...await run<string[]>(page, { mode: "keyboard", index: i, gap: KB_GAP }),
    );
    await hideKeyboard(page);
    await run(page, { mode: "restore" });
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-reach-kb]")) {
      el.removeAttribute("data-reach-kb");
    }
  });
  return fields ? [...new Set(problems)] : null;
}

async function auditState(
  state: ReachState,
  cfg: ReachConfig,
  step2: Map<string, number>,
): Promise<Result[]> {
  const { page } = state;
  const height = await run<number>(page, { mode: "viewport" });
  const inspected = await run<Inspected>(page, {
    mode: "inspect",
    kind: state.kind,
    step: state.step ?? null,
    bandTop: bandTop(height),
    key: KEY,
    pinned: PINNED,
    nulls: nullLabels(cfg.locale),
    zoneMin: ZONE_MIN,
    zoneMinW: ZONE_MIN_W,
    step2Min: STEP2_MIN[cfg.id] ?? null,
  });
  if (state.name === "checkin-s2-rest" && inspected.options) {
    step2.set(cfg.id, inspected.options.shown);
  }
  const results: Result[] = [{
    key: `${state.name}@${cfg.id}`,
    state: state.name,
    config: cfg.id,
    kind: state.kind,
    problems: inspected.problems,
  }];
  if (state.kind === "rest" && state.keyboard !== false) {
    const problems = await keyboardCheck(page, cfg.size.keyboard);
    if (problems) {
      results.push({
        key: `${state.name}+kb@${cfg.id}`,
        state: `${state.name}+kb`,
        config: cfg.id,
        kind: "keyboard",
        problems,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------- PENDING

/** An entry of PENDING matches a key: "*" stands for any size or language */
function matches(entry: string, key: string): boolean {
  const e = entry.split("@"), k = key.split("@");
  return e.length === 3 && e.every((part, i) => part === "*" || part === k[i]);
}

const GROUPS: [Screen, string][] = [
  ["home", "Phase 2: Home and the chrome (the dock, the Undo line, notices)"],
  ["system", "Phase 2: the system screens"],
  ["checkin", "Phase 3: the check-in"],
  ["history", "Phase 4: History"],
  ["settings", "Phase 5: Settings"],
  ["auth", "Phase 6: auth, onboarding and unlock"],
];

/** Every key `entry` matches, `other` matches too */
function covers(entry: string, other: string): boolean {
  const e = entry.split("@"), o = other.split("@");
  return e.every((part, i) => part === "*" || part === o[i]);
}

/**
 * PENDING from this run's failures: a state failing in every configuration
 * that ran is `state@*@*`, at every language of a size `state@WxH@*`,
 * otherwise one key per configuration; with `kept`, added to those entries.
 */
function pendingFrom(
  failing: Result[],
  ran: ReachConfig[],
  kept: readonly string[] = [],
): string {
  const byState = new Map<string, Set<string>>();
  for (const r of failing) {
    byState.set(r.state, (byState.get(r.state) ?? new Set()).add(r.config));
  }
  const entries: string[] = [];
  for (const [state, cfgs] of byState) {
    if (ran.every((c) => cfgs.has(c.id))) {
      entries.push(`${state}@*@*`);
      continue;
    }
    const left = new Set(cfgs);
    for (const size of new Set(ran.map((c) => c.size.name))) {
      const at = ran.filter((c) => c.size.name === size);
      if (at.length > 1 && at.every((c) => left.has(c.id))) {
        entries.push(`${state}@${size}@*`);
        for (const c of at) left.delete(c.id);
      }
    }
    for (const id of left) entries.push(`${state}@${id}`);
  }
  for (const e of kept) {
    if (!entries.some((n) => covers(n, e))) entries.push(e);
  }
  const lines = [
    "// SPDX-License-Identifier: AGPL-3.0-or-later",
    "/**",
    " * The reach audit's known failures (e2e/audit.e2e.ts; ui.md",
    ' * ui.md §4.5 "Reach v2", migration status), keyed `state@WxH@locale`, where',
    " * `*` stands for any size or any language. A failure listed here is",
    " * reported, not failed; one not listed fails the audit; a listed state",
    " * that passes fails only under REACH_STRICT=1. The phase that migrates a",
    " * screen deletes its group, and Phase 7 leaves the list empty.",
    " * Regenerated by a full run (REACH_WRITE=add for more runs):",
    " * REACH_FULL=1 REACH_WRITE=1 deno test -A e2e/audit.e2e.ts",
    " */",
    "export const PENDING: readonly string[] = [",
  ];
  for (const [screen, comment] of GROUPS) {
    const group = entries.filter((e) => screenOf(e.split("@")[0]) === screen)
      .sort();
    if (!group.length) continue;
    lines.push(`  // ${comment}`);
    for (const e of group) lines.push(`  ${JSON.stringify(e)},`);
  }
  lines.push("];", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------- the run

async function pool<T>(
  items: T[],
  jobs: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await fn(item);
    }),
  );
}

const clock = () => new Date().toISOString().slice(11, 19);

async function auditConfig(
  browser: Browser,
  cfg: ReachConfig,
  out: { results: Result[]; errors: string[]; step2: Map<string, number> },
): Promise<void> {
  const started = Date.now();
  const server = await startServer();
  try {
    const session = await openConfig(browser, cfg);
    try {
      const walk = walkStates(session.page, {
        server,
        config: cfg,
        context: session.context,
        newPage: session.newPage,
        errors: out.errors,
        log: VERBOSE ? (line) => console.log(clock(), line) : undefined,
      });
      for await (const state of walk) {
        try {
          out.results.push(...await auditState(state, cfg, out.step2));
        } catch (err) {
          out.errors.push(
            `${cfg.id} ${state.name}: probe failed: ${
              String(err).split("\n")[0]
            }`,
          );
        }
      }
    } finally {
      await session.context.close().catch(() => {});
    }
  } finally {
    await server.stop().catch(() => -1);
  }
  console.log(
    clock(),
    `${cfg.id}: ${
      out.results.filter((r) => r.config === cfg.id).length
    } states in ${Math.round((Date.now() - started) / 1000)} s`,
  );
}

/** REACH_ONLY=390x844@en,375x667@ru: just these configurations */
const ONLY = Deno.env.get("REACH_ONLY")?.split(",").map((s) => s.trim());
const CONFIGS = reachConfigs(FULL || !!ONLY).filter((c) =>
  !ONLY || ONLY.includes(c.id)
);

Deno.test({
  name: `e2e - reach: controls rest in the thumb band at ${
    FULL && !ONLY
      ? "every size and language"
      : CONFIGS.map((c) => c.id).join(", ")
  }`,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const started = Date.now();
    const out = {
      results: [] as Result[],
      errors: [] as string[],
      step2: new Map<string, number>(),
    };
    const browser = await launchBrowser();
    try {
      await pool(CONFIGS, JOBS, (cfg) => auditConfig(browser, cfg, out));
    } finally {
      await browser.close();
    }
    const seconds = Math.round((Date.now() - started) / 1000);

    const pending = (key: string) => PENDING.some((e) => matches(e, key));
    const failing = out.results.filter((r) => r.problems.length);
    const regressions = failing.filter((r) => !pending(r.key));
    const pendingFailing = failing.filter((r) => pending(r.key));
    const pendingPassing = out.results.filter((r) =>
      !r.problems.length && pending(r.key)
    );
    const unused = PENDING.filter((e) =>
      CONFIGS.some((c) => matches(e, `${e.split("@")[0]}@${c.id}`)) &&
      !out.results.some((r) => matches(e, r.key))
    );

    await Deno.mkdir(`${ROOT}/e2e/report`, { recursive: true });
    await Deno.writeTextFile(
      REPORT,
      JSON.stringify(
        {
          generated: new Date().toISOString(),
          seconds,
          configs: CONFIGS.map((c) => c.id),
          strict: STRICT,
          errors: out.errors,
          step2Shown: Object.fromEntries(out.step2),
          regressions: regressions.map((r) => r.key),
          pendingPassing: pendingPassing.map((r) => r.key),
          unusedPending: unused,
          results: out.results.map((r) => ({
            key: r.key,
            kind: r.kind,
            pending: pending(r.key),
            problems: r.problems,
          })),
        },
        null,
        1,
      ),
    );
    if (WRITE) {
      await Deno.writeTextFile(
        PENDING_FILE,
        pendingFrom(failing, CONFIGS, WRITE === "add" ? PENDING : []),
      );
    }

    const byScreen = GROUPS.map(([screen]) =>
      `${screen} ${
        pendingFailing.filter((r) => screenOf(r.state) === screen).length
      }`
    ).join(", ");
    console.log(
      [
        `reach audit: ${CONFIGS.length} configurations, ${out.results.length} states in ${seconds} s (${JOBS} at a time):`,
        `  ${
          out.results.length - failing.length
        } pass, ${pendingFailing.length} pending (${byScreen}), ${regressions.length} not pending, ${pendingPassing.length} pending but passing`,
        `  step 2 options on screen at rest: ${
          [...out.step2].map(([id, n]) => `${id} ${n}`).join(", ")
        }`,
        `  report: ${REPORT}${
          WRITE ? `; PENDING written: ${PENDING_FILE}` : ""
        }`,
        ...regressions.map((r) =>
          `  NOT PENDING ${r.key}:\n${
            r.problems.map((p) => `    ${p}`).join("\n")
          }`
        ),
        ...pendingPassing.map((r) => `  pending but passing: ${r.key}`),
        ...unused.map((e) => `  PENDING entry nothing ran matched: ${e}`),
        ...out.errors.map((e) => `  WALK FAILED ${e}`),
      ].join("\n"),
    );

    assertEquals(out.errors, [], "the walk did not finish");
    if (!WRITE) {
      assertEquals(
        regressions.map((r) => r.key),
        [],
        "states out of reach that PENDING does not list",
      );
    }
    if (STRICT) {
      assertEquals(
        [...pendingPassing.map((r) => r.key), ...unused],
        [],
        "PENDING lists states that pass or never ran (REACH_STRICT)",
      );
    }
  },
});
