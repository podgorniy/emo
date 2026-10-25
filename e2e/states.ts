// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The reach audit's state walker (ui.md §4.5 "Reach v2";
 * e2e/audit.e2e.ts, tools/capture_reach.ts). One browser context per
 * configuration (a phone size, a language, maybe a bottom safe-area inset)
 * signs up in that language and walks every screen, yielding each named
 * state once it is on screen and settled:
 *
 * - "rest": as the screen opens, or after taps that do not scroll (an
 *   answer is tapped where it is, never scrolled into view first);
 * - "scrolled": a scroller moved by hand, where only the pinned controls
 *   are held to the thumb band.
 *
 * Reuse: one context walks all of its states, starting with the sign-up (the
 * auth screens are states too), against a server of its own. A signed-up
 * `storageState` cannot be carried over: the device keys are non-extractable
 * CryptoKeys in IndexedDB, which Playwright cannot export. A server per
 * configuration also keeps the per-address limit on sign-in codes (10 an
 * hour, api.md §1.3) apart when configurations run side by side.
 *
 * Selectors come from the i18n keys and the dictionaries, so the walk runs
 * in every language. A phase that changes a screen the walker drives
 * rewrites its steps here (plan Phases 2–6).
 */
import type { Browser, BrowserContext, Locator, Page } from "playwright-core";
import {
  type CheckInSpec,
  type E2eServer,
  emulateSafeArea,
  PASSPHRASE,
  pressSlider,
  seedCheckIns,
} from "./harness.ts";
import { installKeyboardStub } from "./keyboard.ts";
import type { MessageKey } from "../shared/i18n/keys.ts";
import { t as translate } from "../shared/i18n/format.ts";
import {
  BODY_ZONES,
  CONTEXT_TAGS,
  type Locale,
  QUALITIES,
  URGES,
  WORD_CONFIDENCE,
  WORDS,
} from "../shared/dictionaries.ts";

// ---------------------------------------------------------------- configurations

/** A phone the audit runs on */
export interface Size {
  /** "390x844", or "390x844+sb34" with a 34 px bottom inset */
  name: string;
  width: number;
  height: number;
  /** The on-screen keyboard (with its suggestion bar) for the keyboard check, px */
  keyboard: number;
  /** A bottom safe-area inset, as an iPhone's home indicator, px */
  safeBottom?: number;
}

export const SIZES: readonly Size[] = [
  { name: "390x844", width: 390, height: 844, keyboard: 336 },
  { name: "375x667", width: 375, height: 667, keyboard: 260 },
  // A 390×844 iPhone under Safari's toolbars, where sign-up happens
  { name: "390x664", width: 390, height: 664, keyboard: 260 },
  // Landscape, under 500 px tall: the thumb band is the bottom half
  { name: "844x390", width: 844, height: 390, keyboard: 200 },
  {
    name: "390x844+sb34",
    width: 390,
    height: 844,
    keyboard: 336,
    safeBottom: 34,
  },
];

export const LOCALES: readonly Locale[] = ["en", "ru", "uk"];

/** The browser's language: a first visit speaks it (architecture.md §11.3) */
const BROWSER_LOCALE: Record<Locale, string> = {
  en: "en-GB",
  ru: "ru-RU",
  uk: "uk-UA",
};

export interface ReachConfig {
  size: Size;
  locale: Locale;
  /** "390x844@en": the configuration part of a PENDING key */
  id: string;
}

function config(size: Size, locale: Locale): ReachConfig {
  return { size, locale, id: `${size.name}@${locale}` };
}

/**
 * The default (CI) matrix: English at every size, Russian and Ukrainian
 * (the longest labels) at 375×667 and in landscape. `full`: every language
 * at every size (REACH_FULL=1).
 */
export function reachConfigs(full: boolean): ReachConfig[] {
  if (full) return SIZES.flatMap((s) => LOCALES.map((l) => config(s, l)));
  const at = (name: string) => SIZES.find((s) => s.name === name)!;
  return [
    ...SIZES.map((s) => config(s, "en")),
    ...(["ru", "uk"] as const).flatMap((l) =>
      ["375x667", "844x390"].map((n) => config(at(n), l))
    ),
  ];
}

/** localStorage flags the context's stubs read at start (see `openConfig`) */
const FLAGS = { idbBroken: "e2e.idbBroken", update: "e2e.updateWaiting" };

/**
 * Stubs every page of the context carries from its first script, each
 * asleep until its localStorage flag is set: storage that will not open
 * (as e2e/system.e2e.ts) and a new version waiting (as e2e/update.e2e.ts).
 */
function systemStubs(flags: typeof FLAGS) {
  const on = (flag: string) => {
    try {
      return localStorage.getItem(flag) === "1";
    } catch {
      return false; // an opaque origin (about:blank)
    }
  };
  if (on(flags.idbBroken)) {
    IDBFactory.prototype.open = function () {
      const req = {
        error: new DOMException("e2e: damaged", "UnknownError"),
        onerror: null as ((e: Event) => void) | null,
      };
      setTimeout(() => req.onerror?.(new Event("error")), 0);
      return req as unknown as IDBOpenDBRequest;
    };
  }
  if (on(flags.update) && "serviceWorker" in navigator) {
    const waiting = {
      scriptURL: `${location.origin}/sw.js?next`,
      state: "installed",
      postMessage() {},
      addEventListener() {},
    };
    const registration = {
      waiting,
      installing: null,
      active: {},
      update: () => Promise.resolve(),
      addEventListener() {},
    };
    Object.defineProperty(navigator.serviceWorker, "controller", {
      get: () => ({}),
      configurable: true,
    });
    navigator.serviceWorker.register = () =>
      Promise.resolve(registration as unknown as ServiceWorkerRegistration);
  }
}

export interface ConfigSession {
  context: BrowserContext;
  page: Page;
  /** Another page of the context, set up as the first */
  newPage(): Promise<Page>;
}

/**
 * The context a configuration walks in: its size as a touch phone (2×), its
 * language as the browser's, the keyboard stub (e2e/keyboard.ts), the
 * system stubs and, for "+sb" sizes, the bottom inset that
 * `env(safe-area-inset-bottom)` reports (harness `emulateSafeArea`).
 */
export async function openConfig(
  browser: Browser,
  cfg: ReachConfig,
): Promise<ConfigSession> {
  const context = await browser.newContext({
    locale: BROWSER_LOCALE[cfg.locale],
    viewport: { width: cfg.size.width, height: cfg.size.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await installKeyboardStub(context);
  await context.addInitScript(systemStubs, FLAGS);
  const newPage = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    if (cfg.size.safeBottom) {
      await emulateSafeArea(page, { bottom: cfg.size.safeBottom });
    }
    return page;
  };
  return { context, page: await newPage(), newPage };
}

// ---------------------------------------------------------------- states

/** The screen a state belongs to: the plan phase that migrates it */
export type Screen =
  | "home"
  | "system"
  | "checkin"
  | "history"
  | "settings"
  | "auth";

/** "unlock-…" is an auth screen; otherwise the name's first part */
export function screenOf(name: string): Screen {
  const head = name.split(/[-+]/)[0];
  if (head === "unlock") return "auth";
  const known: Screen[] = [
    "home",
    "system",
    "checkin",
    "history",
    "settings",
    "auth",
  ];
  if (!known.includes(head as Screen)) {
    throw new Error(`state ${name}: no screen "${head}"`);
  }
  return head as Screen;
}

export interface ReachState {
  /** "checkin-s2-rest": the state part of a PENDING key */
  name: string;
  screen: Screen;
  kind: "rest" | "scrolled";
  /** The page showing it (the `/now` other window is a second page) */
  page: Page;
  /** The check-in step on screen, 1–9 */
  step?: number;
  /** false: no keyboard check (the fields of the state before, again) */
  keyboard?: boolean;
  notes: string;
}

export interface WalkConfig {
  server: E2eServer;
  config: ReachConfig;
  context: BrowserContext;
  newPage(): Promise<Page>;
  /** Phases that failed; the states after the failure were not reached */
  errors: string[];
  log?: (line: string) => void;
}

/** Labels of the null answers in `locale` (ui.md §1.4) */
export function nullLabels(locale: Locale): string[] {
  const labels = [
    ...QUALITIES.filter((q) => q.group === "none"),
    ...WORDS.filter((w) => w.key === "empty" || w.key === "unknown"),
    ...WORDS.flatMap((w) => w.l2.filter((l) => l.key === "nothing")),
    ...WORD_CONFIDENCE.filter((c) => c.key === "unknown"),
    ...URGES.filter((u) => u.key === "nothing"),
    ...BODY_ZONES.filter((z) => z.key === "nowhere" || z.key === "whole_body"),
  ].map((item) => item.label[locale]);
  return [...new Set(labels)];
}

/** A note with a "why" in it: the stop phrase callout (note-stopwords.ts) */
const WHY_NOTE: Record<Locale, string> = {
  en: "call with boss, because I was late",
  ru: "звонок начальнику, потому что опоздал",
  uk: "дзвінок керівнику, тому що запізнився",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Locale-aware locators and the walk's small moves */
class Ui {
  constructor(readonly page: Page, readonly w: WalkConfig) {}

  get locale(): Locale {
    return this.w.config.locale;
  }

  t(key: MessageKey, params?: Record<string, string | number>): string {
    return translate(this.locale, key, params);
  }

  button(key: MessageKey, scope: Page | Locator = this.page): Locator {
    return scope.getByRole("button", { name: this.t(key), exact: true });
  }

  /** A button whose name starts with the text of `key` */
  buttonStarting(key: MessageKey): Locator {
    return this.page.getByRole("button", {
      name: new RegExp(`^${escape(this.t(key))}`),
    });
  }

  label(
    dict: readonly { key: string; label: Record<Locale, string> }[],
    key: string,
  ): string {
    return dict.find((d) => d.key === key)!.label[this.locale];
  }

  /** An answer or zone by its label */
  option(text: string): Locator {
    return this.page.getByRole("button", { name: text, exact: true }).first();
  }

  dialog(): Locator {
    return this.page.locator('[role="dialog"][aria-modal="true"]');
  }

  async closeDialog(): Promise<void> {
    await this.page.keyboard.press("Escape");
    await this.dialog().waitFor({ state: "detached" });
  }

  async step(n: number): Promise<void> {
    await this.page.getByText(this.t("checkin.stepLabel", { n }), {
      exact: true,
    }).waitFor();
  }

  /** A tap on what is on screen: no scroll into view first */
  async tap(target: Locator): Promise<void> {
    await target.evaluate((el) => (el as HTMLElement).click());
  }

  /** A tap within 350 ms of a step change is ignored (ui.md §5.1) */
  async afterStepChange(): Promise<void> {
    await this.page.waitForTimeout(360);
  }

  async next(): Promise<void> {
    await this.afterStepChange();
    await pressSlider(this.page);
    await this.page.locator("button.next").click();
  }

  async pane(name: "home" | "history" | "settings"): Promise<void> {
    const key = `home.pane.${name}` as MessageKey;
    await this.button(key, this.page.locator("nav.dots")).click();
    if (name === "home") await this.page.locator("button.now").waitFor();
    else if (name === "history") {
      await this.page.locator("#history-title").waitFor();
    } else await this.page.locator("h1.settings-title").waitFor();
  }

  async home(): Promise<void> {
    if (await this.page.locator("button.now").isVisible().catch(() => false)) {
      return;
    }
    await this.page.goto(this.w.server.url);
    await this.page.locator("button.now").waitFor({ timeout: 30_000 });
  }

  /** The page scrolled so `sel`'s top sits just under the pane bar */
  async scrollTo(sel: string): Promise<void> {
    await this.page.locator(sel).first().evaluate((el) => {
      const bar = document.querySelector(".panebar")?.getBoundingClientRect()
        .bottom ?? 0;
      document.body.scrollTop += el.getBoundingClientRect().top -
        Math.max(0, bar) - 8;
    });
  }

  /**
   * The state, once it has come to rest: its fonts loaded, finite
   * animations finished (the contexts ask for reduced motion, so most are
   * instant), then every scroll position and scroll size the same for six
   * frames running (a screen that rests low scrolls itself there once its
   * content is measured). At most 2.5 s.
   */
  async at(
    name: string,
    kind: ReachState["kind"],
    notes: string,
    extra: Pick<ReachState, "step" | "keyboard"> = {},
  ): Promise<ReachState> {
    // 600 ms: a toast takes a tap 350 ms after it rises in, which is 200 ms
    // after Home arrives from the check-in (Toast.svelte, Home.svelte)
    await this.page.waitForTimeout(600);
    await this.page.evaluate(async () => {
      const until = performance.now() + 2500;
      const timeout = new Promise((r) => setTimeout(r, 2500));
      await Promise.race([document.fonts.ready, timeout]);
      await Promise.race([
        Promise.all(
          document.getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        ),
        timeout,
      ]);
      const sample = () =>
        [document.body, ...document.querySelectorAll("*")]
          .filter((el) => el.scrollHeight > el.clientHeight + 1)
          .map((el) => `${el.scrollTop}/${el.scrollHeight}`).join(",");
      await new Promise<void>((resolve) => {
        let last = sample(), still = 0;
        const tick = () => {
          const now = sample();
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 6 || performance.now() > until) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    });
    this.w.log?.(`${this.w.config.id} ${name}`);
    return {
      name,
      screen: screenOf(name),
      kind,
      page: this.page,
      notes,
      ...extra,
    };
  }
}

/** Rows of a store of this browser's database */
function count(page: Page, store: string): Promise<number> {
  return page.evaluate((store) =>
    new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const c = db.transaction(store).objectStore(store).count();
        c.onsuccess = () => {
          db.close();
          resolve(c.result);
        };
      };
    }), store);
}

/** One `meta` row of this browser's database put (`value`) or removed */
function setMeta(page: Page, key: string, value?: unknown): Promise<void> {
  return page.evaluate(
    ({ key, value, remove }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("emo");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("meta", "readwrite");
          if (remove) tx.objectStore("meta").delete(key);
          else tx.objectStore("meta").put({ key, value });
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { key, value, remove: value === undefined },
  );
}

async function setFlag(page: Page, flag: string, on: boolean): Promise<void> {
  await page.evaluate(([flag, on]) => {
    if (on) localStorage.setItem(flag as string, "1");
    else localStorage.removeItem(flag as string);
  }, [flag, on] as const);
}

/**
 * Another account on the server, signed up over the API (no keyring): the
 * one "Sign in to sync" signs in as, for the account switch.
 */
async function createAccount(server: E2eServer, email: string): Promise<void> {
  const post = async (path: string, body: unknown) => {
    const res = await fetch(server.url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.url },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  };
  await post("/api/auth/request-code", {
    email,
    invite_code: await server.invite(),
  });
  await post("/api/auth/verify", {
    email,
    code: await server.mailCode(email),
    tz: "UTC",
    locale: "en",
  });
}

/** The seeded History: 15 check-ins over a week, two of them skipped */
function seedSpecs(): CheckInSpec[] {
  const out: CheckInSpec[] = [];
  const words = [
    "fear.anxiety",
    "joy.calm",
    "sadness.loneliness",
    "anger.irritation",
    "joy.relief",
    "shame.awkwardness",
    null,
  ];
  const zones = [
    ["throat", "chest"],
    ["shoulders"],
    ["belly", "lower_belly"],
    ["jaw", "forehead_eyes"],
    ["nowhere"],
    ["whole_body"],
    ["chest"],
  ];
  const quals = [
    ["squeeze", "lump"],
    ["tension"],
    ["warmth", "pulsing"],
    ["heaviness"],
    ["nothing"],
    ["tingling"],
    ["cant_tell"],
  ];
  const urges = ["shrink", "move", "talk", "leave", null, "cry", "eat"];
  const ctx = ["work", "people", "alone", "commute", "home", "screen", "food"];
  const notes = [
    "call with manager",
    null,
    "kitchen, 15 minutes",
    null,
    "standup",
    null,
    "bus stop",
  ];
  for (let i = 0; i < 15; i++) {
    const daysAgo = Math.floor(i / 2.5);
    const at = `${String(20 - (i % 3) * 5).padStart(2, "0")}:${
      String((i * 7) % 60).padStart(2, "0")
    }`;
    if (i === 4 || i === 11) {
      out.push({
        daysAgo,
        at,
        skipped: true,
        abandoned: i === 11,
        untouched: null,
        body: null,
        affect: null,
        urge: null,
        head_mode: null,
        context_tag: null,
        note: null,
      });
      continue;
    }
    const k = i % 7;
    const word = words[k];
    out.push({
      daysAgo,
      at,
      trigger: i % 4 === 0 ? "after_event" : i % 4 === 1 ? "manual" : "random",
      body: {
        locations: zones[k],
        qualities: quals[k],
        intensity: (i * 3) % 11,
      },
      affect: {
        valence: (i % 7) - 3,
        arousal: (i * 5) % 11,
        word,
        word_confidence: word ? (i % 2 ? "sure" : "guess") : null,
      },
      urge: urges[k],
      head_mode: (i * 2) % 11,
      context_tag: ctx[k],
      note: notes[k],
    });
  }
  return out;
}

// ---------------------------------------------------------------- phases

type Phase = AsyncGenerator<ReachState, void, undefined>;

/** Sign-up in the configuration's language, screen by screen */
async function* auth(ui: Ui): Phase {
  const { page } = ui;
  const email = `reach-${
    ui.w.config.id.replace(/[^a-z0-9]+/gi, "-")
  }@example.com`
    .toLowerCase();
  await page.goto(ui.w.server.url);
  await page.locator("#email-input").waitFor();
  yield await ui.at("auth-sign-in", "rest", "Sign-in landing.");
  await ui.button("auth.signin.about").click();
  await ui.dialog().waitFor();
  yield await ui.at("auth-about-dialog", "rest", "About and privacy sheet.");
  await ui.closeDialog();
  await ui.button("auth.signin.inviteToggle").click();
  await page.locator("#invite-input").waitFor();
  yield await ui.at(
    "auth-invite-form",
    "rest",
    "Create an account: email and invite code.",
  );
  await page.locator("#email-input").fill(email);
  await page.locator("#invite-input").fill(await ui.w.server.invite());
  await ui.button("auth.signin.sendCode").click();
  const code = page.locator("input[autocomplete=one-time-code]");
  await code.waitFor();
  yield await ui.at("auth-code-entry", "rest", "Six-digit code entry.");
  // Six digits send themselves (ui.md §12.3)
  await code.fill(await ui.w.server.mailCode(email));
  const pass = page.locator("#setup-passphrase");
  await pass.waitFor();
  yield await ui.at("auth-passphrase", "rest", "Passphrase setup.");
  await pass.fill(PASSPHRASE);
  await page.locator("#setup-repeat").fill(PASSPHRASE);
  await page.locator("#setup-repeat").blur();
  yield await ui.at(
    "auth-passphrase-filled",
    "rest",
    "Both fields filled; the meter shown.",
    { keyboard: false },
  );
  await ui.button("common.next").click();
  const write = ui.buttonStarting("auth.recovery.write.title");
  await write.waitFor({ timeout: 30_000 });
  yield await ui.at("auth-recovery-key", "rest", "Recovery key display.");
  await write.click();
  yield await ui.at(
    "auth-recovery-key-acknowledged",
    "rest",
    "After “I'll write it down”.",
  );
  await ui.button("common.next").click();
  await ui.button("auth.finish").waitFor();
  yield await ui.at(
    "auth-install-reminders",
    "rest",
    "Onboarding: install and reminders.",
  );
  await ui.button("auth.finish").click();
  await page.locator("button.now").waitFor();
}

async function* home(ui: Ui): Phase {
  const { page } = ui;
  yield await ui.at(
    "home-default",
    "rest",
    "Home after onboarding (headless: notifications denied, so the " +
      "“Reminders aren't reaching this device” line).",
  );
  await page.locator("button.sync").tap();
  await ui.dialog().waitFor();
  yield await ui.at("home-sync-sheet", "rest", "The sync dot's sheet.");
  await ui.closeDialog();
  await ui.pane("history");
  await page.getByText(ui.t("history.empty.title")).waitFor();
  yield await ui.at("history-empty", "rest", "History before any check-in.");
  await ui.pane("home");
}

async function* draft(ui: Ui): Phase {
  const { page } = ui;
  await page.locator("button.now").click();
  await ui.step(1);
  yield await ui.at(
    "checkin-s1-first-time",
    "rest",
    "Step 1 of the first check-in (the first-time hint).",
    { step: 1 },
  );
  await ui.afterStepChange();
  await ui.tap(page.locator('[data-null="whole_body"]'));
  await ui.next();
  await ui.step(2);
  await ui.afterStepChange();
  await page.locator(".foot .exits button.close").click();
  await ui.button("home.now.continue").waitFor();
  yield await ui.at("home-draft-open", "rest", "Home with an open check-in.");
  await ui.pane("history");
  await page.getByText(ui.t("history.draft"), { exact: true }).waitFor();
  yield await ui.at(
    "history-draft-banner",
    "rest",
    "History while a check-in is open.",
  );
  await ui.pane("home");
  await ui.button("home.draft.skip").click();
  await ui.button("home.now").waitFor();
  await ui.button("checkin.saved.undo").waitFor();
  yield await ui.at(
    "home-undo-toast-after-skip",
    "rest",
    "Skip it: the Undo toast.",
  );
}

async function* checkIn(ui: Ui): Phase {
  const { page } = ui;
  const main = page.locator("main.body");
  await page.locator("button.now").click();
  await ui.step(1);
  yield await ui.at("checkin-s1-rest", "rest", "Step 1, the body map.", {
    step: 1,
  });
  await ui.afterStepChange();
  for (const z of ["chest", "throat"]) {
    await ui.tap(ui.option(ui.label(BODY_ZONES, z)));
  }
  yield await ui.at(
    "checkin-s1-zones-selected",
    "rest",
    "Step 1 with chest and throat marked.",
    { step: 1 },
  );

  await ui.next();
  await ui.step(2);
  yield await ui.at("checkin-s2-rest", "rest", "Step 2, the sensations.", {
    step: 2,
  });
  const rest = await main.evaluate((m) => {
    const top = m.scrollTop;
    m.scrollTop = m.scrollHeight;
    return top;
  });
  yield await ui.at(
    "checkin-s2-scrolled-end",
    "scrolled",
    "Step 2 scrolled to its end.",
    { step: 2 },
  );
  await main.evaluate((m, top) => (m.scrollTop = top), rest);
  await ui.afterStepChange();
  for (const q of ["squeeze", "warmth"]) {
    await ui.tap(ui.option(ui.label(QUALITIES, q)));
  }
  yield await ui.at(
    "checkin-s2-selected",
    "rest",
    "Step 2 with two sensations chosen.",
    { step: 2 },
  );
  await ui.tap(page.locator("button.help-link"));
  await ui.dialog().waitFor();
  yield await ui.at(
    "checkin-s2-help-sheet",
    "rest",
    "Step 2: the “About these words” sheet.",
    { step: 2 },
  );
  await ui.button("common.close", ui.dialog()).click();
  await ui.dialog().waitFor({ state: "detached" });

  await ui.next();
  await ui.step(3);
  yield await ui.at(
    "checkin-s3-slider-untouched",
    "rest",
    "Step 3, the intensity slider untouched.",
    { step: 3 },
  );
  await ui.afterStepChange();
  await pressSlider(page);
  await page.locator("main .slider:not(.untouched)").waitFor();
  yield await ui.at(
    "checkin-s3-slider-touched",
    "rest",
    "Step 3, the slider pressed at its midpoint.",
    { step: 3 },
  );
  await ui.tap(page.locator("button.help-link"));
  await ui.dialog().waitFor();
  yield await ui.at(
    "checkin-s3-help-sheet",
    "rest",
    "Step 3: the “About this question” sheet.",
    { step: 3 },
  );
  await ui.button("common.close", ui.dialog()).click();
  await ui.dialog().waitFor({ state: "detached" });

  await ui.next();
  await ui.step(4);
  yield await ui.at("checkin-s4-valence", "rest", "Step 4 untouched.", {
    step: 4,
  });
  await ui.next();
  await ui.step(5);
  yield await ui.at("checkin-s5-arousal", "rest", "Step 5 untouched.", {
    step: 5,
  });
  await ui.next();
  await ui.step(6);
  yield await ui.at("checkin-s6-word-rest", "rest", "Step 6, the words.", {
    step: 6,
  });
  await ui.afterStepChange();
  await ui.tap(ui.option(ui.label(WORDS, "fear")));
  yield await ui.at(
    "checkin-s6-word-chosen",
    "rest",
    "Step 6 with “fear” chosen: the finer words and the certainty.",
    { step: 6 },
  );
  await ui.afterStepChange();
  await page.locator("button.next").click({ force: true });
  await page.getByText(ui.t("checkin.step.6.confidence.ask")).waitFor();
  yield await ui.at(
    "checkin-s6-certainty-asked",
    "rest",
    "Step 6: the greyed Next pressed, the certainty asked for.",
    { step: 6 },
  );
  await ui.tap(ui.option(ui.label(WORD_CONFIDENCE, "guess")));

  await ui.next();
  await ui.step(7);
  yield await ui.at("checkin-s7-urge", "rest", "Step 7, the urges.", {
    step: 7,
  });
  await ui.afterStepChange();
  await ui.tap(ui.option(ui.label(URGES, "move")));

  await ui.next();
  await ui.step(8);
  yield await ui.at("checkin-s8-attention", "rest", "Step 8 untouched.", {
    step: 8,
  });

  await ui.next();
  await ui.step(9);
  const note = page.getByLabel(ui.t("checkin.step.10.title"));
  await note.waitFor();
  yield await ui.at(
    "checkin-s9-rest",
    "rest",
    "Step 9, the situation and the note (Save greyed until a situation).",
    { step: 9 },
  );
  await ui.afterStepChange();
  await ui.tap(ui.option(ui.label(CONTEXT_TAGS, "work")));
  await note.fill(WHY_NOTE[ui.locale]);
  await page.locator("main button.remove").waitFor();
  await note.blur();
  yield await ui.at(
    "checkin-s9-note-why-warning",
    "rest",
    "A “why” in the note: Remove and Save without the note offered.",
    { step: 9, keyboard: false },
  );
  await note.fill("call");
  await note.blur();
  await ui.afterStepChange();
  await page.locator("button.next").click();
  await page.getByRole("status", { name: ui.t("checkin.saved.aria") })
    .waitFor();
  yield await ui.at("checkin-saved", "rest", "Saved.");
  await page.locator("button.done").click();
  await page.locator("button.now").waitFor();
  yield await ui.at(
    "home-after-save-toast",
    "rest",
    "Home after Done: Saved · Undo.",
  );
}

async function* history(ui: Ui): Phase {
  const { page } = ui;
  await seedCheckIns(page, seedSpecs(), { queued: true });
  await page.goto(ui.w.server.url);
  await page.locator("button.now").waitFor({ timeout: 30_000 });
  const end = Date.now() + 15_000;
  while ((await count(page, "outbox")) > 0 && Date.now() < end) {
    await page.waitForTimeout(200);
  }
  const rows = page.locator("main h3 button");
  await ui.pane("history");
  await rows.first().waitFor();
  yield await ui.at(
    "history-populated-rest",
    "rest",
    "History with 17 check-ins.",
  );
  await page.evaluate(() => (document.body.scrollTop = 1e6));
  yield await ui.at(
    "history-scrolled-end",
    "scrolled",
    "History scrolled to its end.",
  );
  // Back to its resting place: the pane opened again
  await ui.pane("home");
  await ui.pane("history");
  await rows.first().waitFor();
  await ui.tap(rows.first());
  const del = ui.button("history.item.delete").first();
  await del.waitFor();
  yield await ui.at(
    "history-row-expanded",
    "rest",
    "The newest row opened: its record and Delete.",
  );
  await del.click();
  await ui.dialog().getByText(ui.t("history.delete.title")).waitFor();
  yield await ui.at(
    "history-delete-confirm",
    "rest",
    "Delete this check-in? sheet.",
  );
  await ui.button("history.delete.confirm", ui.dialog()).click();
  await ui.dialog().waitFor({ state: "detached" });
  yield await ui.at(
    "history-after-delete",
    "rest",
    "After the delete: the row gone.",
  );
}

async function* settings(ui: Ui): Phase {
  const { page } = ui;
  await ui.home();
  await ui.pane("settings");
  yield await ui.at("settings-top-rest", "rest", "Settings as it opens.");

  await ui.scrollTo("#reminders");
  yield await ui.at("settings-reminders", "scrolled", "Reminders in view.");
  const how = ui.button("settings.reminders.howToAllow");
  if (await how.count()) {
    await how.click();
    await ui.dialog().waitFor();
    yield await ui.at(
      "settings-reminders-howto-sheet",
      "rest",
      "How to allow notifications.",
    );
    await ui.closeDialog();
  }

  await ui.scrollTo("section:has(#language-header)");
  yield await ui.at("settings-language", "scrolled", "Language in view.");

  const appearance = page.locator("#appearance button[aria-expanded]");
  if (await appearance.getAttribute("aria-expanded") === "false") {
    await appearance.click();
  }
  await page.locator("#appearance [role=radiogroup]").first().waitFor();
  await ui.scrollTo("#appearance");
  yield await ui.at(
    "settings-appearance-expanded",
    "scrolled",
    "Appearance open, its top in view.",
  );
  await page.locator("#appearance").evaluate((el) => {
    document.body.scrollTop += el.getBoundingClientRect().bottom -
      innerHeight + 16;
  });
  yield await ui.at(
    "settings-appearance-expanded-end",
    "scrolled",
    "Appearance open, scrolled to its end.",
  );
  await appearance.click();

  await ui.scrollTo("section.settings-section:has(.sign-out)");
  yield await ui.at("settings-devices", "scrolled", "Devices in view.");
  await page.locator(".sign-out").first().click();
  await ui.dialog().waitFor();
  yield await ui.at("settings-signout-sheet", "rest", "Sign out? sheet.");
  await ui.closeDialog();

  await ui.scrollTo("section.settings-section:has(button.delete)");
  yield await ui.at("settings-data", "scrolled", "Data and keys in view.");
  await ui.button("settings.data.export").click();
  await ui.dialog().waitFor();
  yield await ui.at("settings-export-sheet", "rest", "The export sheet.");
  await ui.closeDialog();
  await ui.button("settings.data.changePassphrase").click();
  await ui.dialog().waitFor();
  yield await ui.at(
    "settings-change-passphrase-sheet",
    "rest",
    "Change passphrase sheet.",
  );
  await ui.closeDialog();
  await page.locator("button.delete").first().click();
  await ui.dialog().waitFor();
  yield await ui.at(
    "settings-delete-account-sheet",
    "rest",
    "Delete account sheet (not confirmed).",
  );
  await ui.closeDialog();

  // Invites: the section just before Words, when the server lists codes
  const invites =
    "section.settings-section:has(+ section#words):not(:has(button.delete))";
  if (await page.locator(invites).count()) {
    await ui.scrollTo(invites);
    yield await ui.at("settings-invites", "scrolled", "Invites in view.");
  }

  const words = page.locator("#words button[aria-expanded]");
  if (await words.getAttribute("aria-expanded") === "false") {
    await words.click();
  }
  await page.locator("#words-body .group-heading").first().waitFor();
  await ui.scrollTo("#words");
  yield await ui.at(
    "settings-words-expanded",
    "scrolled",
    "Words open, its top in view.",
  );
  await ui.tap(page.locator("#words details summary").first());
  yield await ui.at(
    "settings-words-term-open",
    "scrolled",
    "A Words group open.",
  );
  await words.click();

  await ui.scrollTo("section.settings-section:has(.about-card)");
  yield await ui.at("settings-about", "scrolled", "About in view.");
  await page.evaluate(() => (document.body.scrollTop = 1e6));
  yield await ui.at("settings-bottom", "scrolled", "Settings at its end.");
}

/** Reminders paused for 3 days: Home's quiet line with Resume */
async function* paused(ui: Ui): Phase {
  const { page } = ui;
  await ui.home();
  await ui.pane("settings");
  const reminders = page.locator("#reminders");
  await ui.button("settings.reminders.pause.days", reminders).click();
  await ui.button("settings.reminders.resume", reminders).waitFor();
  await ui.pane("home");
  const resume = ui.button("home.reminders.resume");
  await resume.waitFor();
  yield await ui.at("home-paused", "rest", "Home with reminders paused.");
  await resume.click();
  await resume.waitFor({ state: "detached" });
}

/**
 * Settings → Reminders offline with no copy of the settings on this device:
 * the controls wait with a line (as e2e/forms.e2e.ts).
 */
async function* remindersOffline(ui: Ui): Phase {
  const { page } = ui;
  await ui.home();
  await ui.w.context.setOffline(true);
  try {
    await page.locator(".app-root.offline").waitFor();
    await setMeta(page, "settings");
    await ui.pane("settings");
    const line = page.getByText(ui.t("settings.reminders.offline"));
    await line.waitFor();
    yield await ui.at(
      "settings-reminders-offline",
      "rest",
      "Settings offline, before the first fetch: Reminders waits.",
    );
  } finally {
    await ui.w.context.setOffline(false);
  }
  await ui.pane("home");
}

/** A new version waiting, then a 426 from the server (as e2e/update.e2e.ts) */
async function* update(ui: Ui): Phase {
  const { page } = ui;
  await ui.home();
  await setFlag(page, FLAGS.update, true);
  try {
    await page.reload();
    const card = page.locator("section.card");
    await card.getByText(ui.t("common.update.ready.title")).waitFor();
    yield await ui.at("home-update-ready", "rest", "The update card: ready.");
    await page.route("**/api/entries**", (route) =>
      route.fulfill({
        status: 426,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "upgrade_required",
            message: "upgrade",
            min_client: "9.0.0",
          },
        }),
      }));
    // A sync pass hears the 426; the dot also opens its sheet
    await page.locator("button.sync").click();
    if (await ui.dialog().count()) await ui.closeDialog();
    await card.getByText(ui.t("common.update.required.title")).waitFor();
    yield await ui.at(
      "home-update-required",
      "rest",
      "The update card: needed to sync.",
    );
  } finally {
    await page.unroute("**/api/entries**");
    await setFlag(page, FLAGS.update, false);
  }
  await page.reload();
  await page.locator("button.now").waitFor({ timeout: 30_000 });
}

/** Storage that will not open (as e2e/system.e2e.ts) */
async function* storageDamaged(ui: Ui): Phase {
  const { page } = ui;
  await ui.home();
  await setFlag(page, FLAGS.idbBroken, true);
  try {
    await page.reload();
    await page.getByText(ui.t("errors.storageDamaged")).waitFor();
    yield await ui.at(
      "system-storage-damaged",
      "rest",
      "Local storage damaged: Try again, Reset this device.",
    );
    await ui.button("errors.storageDamaged.reset").click();
    await ui.dialog().waitFor();
    yield await ui.at(
      "system-storage-damaged-reset-sheet",
      "rest",
      "Reset this device? sheet.",
    );
    await ui.button("common.cancel", ui.dialog()).click();
    await ui.dialog().waitFor({ state: "detached" });
  } finally {
    await setFlag(page, FLAGS.idbBroken, false);
  }
  await page.reload();
  await page.locator("button.now").waitFor({ timeout: 30_000 });
}

/** The account deleted on another device (reliability.md §1.3) */
async function* accountGone(ui: Ui): Phase {
  const { page } = ui;
  await ui.home();
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "account_gone", message: "gone" },
      }),
    }));
  try {
    await page.reload();
    await page.getByText(ui.t("errors.accountGone")).waitFor();
    yield await ui.at(
      "system-account-gone",
      "rest",
      "The account was deleted elsewhere: OK.",
    );
  } finally {
    await page.unroute("**/api/session");
  }
  // Never "OK", which wipes this device: a reload asks the server again
  await page.reload();
  await page.locator("button.now").waitFor({ timeout: 30_000 });
}

/** `/now` in a second tab while the form is open in the first */
async function* otherWindow(ui: Ui): Phase {
  const { page } = ui;
  await ui.home();
  await page.locator("button.now").click();
  await ui.step(1);
  const tab = await ui.w.newPage();
  try {
    await tab.goto(`${ui.w.server.url}/now`);
    await tab.getByText(ui.t("checkin.otherWindow")).waitFor();
    yield await new Ui(tab, ui.w).at(
      "system-other-window",
      "rest",
      "/now in a second tab: Go to it, Close.",
    );
  } finally {
    await tab.close();
  }
  await page.bringToFront();
  await ui.afterStepChange();
  await page.locator(".foot .exits button.link").click();
  await page.getByRole("status", { name: ui.t("checkin.saved.aria") })
    .waitFor();
  await page.locator("button.done").click();
  await page.locator("button.now").waitFor();
}

/** A recovery key shown but never saved (architecture.md §4.1) */
async function* recoveryPending(ui: Ui): Phase {
  const { page } = ui;
  await ui.home();
  await setMeta(page, "recovery_pending", true);
  try {
    await page.reload();
    await page.locator("#pending-pass").waitFor({ timeout: 30_000 });
    yield await ui.at(
      "auth-recovery-pending",
      "rest",
      "The recovery key was not saved: the passphrase issues a new one.",
    );
  } finally {
    await setMeta(page, "recovery_pending");
  }
  await page.reload();
  await page.locator("button.now").waitFor({ timeout: 30_000 });
}

async function* unlock(ui: Ui): Phase {
  const { page } = ui;
  await ui.home();
  await ui.pane("settings");
  await ui.buttonStarting("settings.data.lock").click();
  const field = page.locator("#unlock-passphrase");
  await field.waitFor();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  yield await ui.at("unlock-passphrase", "rest", "Locked: the passphrase.");
  await ui.button("auth.unlock.useRecovery").click();
  await page.locator("#recovery-key").waitFor();
  yield await ui.at(
    "unlock-recovery-key",
    "rest",
    "Unlock with the recovery key (its field focused).",
  );
  await ui.button("common.cancel").click();
  await field.waitFor();
  await field.fill(PASSPHRASE);
  await page.keyboard.press("Enter");
  await page.locator("button.now").waitFor({ timeout: 30_000 });
}

/** The session ended, "Sign in to sync" and the account switch */
async function* signedOut(ui: Ui): Phase {
  const { page } = ui;
  const other = `other-${
    ui.w.config.id.replace(/[^a-z0-9]+/gi, "-")
  }@example.com`
    .toLowerCase();
  await createAccount(ui.w.server, other);
  await ui.home();
  await ui.w.context.clearCookies();
  await page.reload();
  await page.locator("button.sync .sync-text").waitFor({ timeout: 30_000 });
  yield await ui.at(
    "home-signed-out",
    "rest",
    "Home after the session ended: Not synced.",
  );
  await page.locator("button.sync").tap();
  await ui.dialog().waitFor();
  yield await ui.at(
    "home-signed-out-sync-sheet",
    "rest",
    "The sync sheet with Sign in to sync.",
  );
  await ui.button("home.sync.signedOut.action", ui.dialog()).click();
  const title = (key: MessageKey) =>
    page.getByRole("heading", { name: ui.t(key), exact: true });
  await title("auth.signin.again.title").waitFor();
  yield await ui.at("auth-sign-in-to-sync", "rest", "Sign in to sync.");
  await ui.button("auth.signin.again.switch").click();
  await title("auth.switch.confirmTitle").waitFor();
  yield await ui.at(
    "auth-use-different-account",
    "rest",
    "Use a different account?",
  );
  await ui.button("common.back").click();
  await title("auth.signin.again.title").waitFor();
  await page.locator("#email-input").fill(other);
  await ui.button("auth.signin.sendCode").click();
  await page.locator("input[autocomplete=one-time-code]").fill(
    await ui.w.server.mailCode(other),
  );
  await title("auth.switch.title").waitFor({ timeout: 30_000 });
  yield await ui.at(
    "auth-account-switch",
    "rest",
    "Another account is set up on this browser.",
  );
  await ui.button("common.back").click();
  await page.locator("button.now").waitFor();
}

/**
 * Every state of one configuration, in order: the sign-up, Home, the
 * check-in, History, Settings, the system screens, unlock and the session
 * screens. A phase that fails is recorded in `cfg.errors`; the walk goes on
 * from Home with the next phase (after the sign-up, nothing can).
 */
export async function* walkStates(
  page: Page,
  cfg: WalkConfig,
): AsyncGenerator<ReachState, void, undefined> {
  const ui = new Ui(page, cfg);
  const phases: [string, (ui: Ui) => Phase][] = [
    ["auth", auth],
    ["home", home],
    ["draft", draft],
    ["checkin", checkIn],
    ["history", history],
    ["settings", settings],
    ["paused", paused],
    ["reminders offline", remindersOffline],
    ["update", update],
    ["storage damaged", storageDamaged],
    ["account gone", accountGone],
    ["other window", otherWindow],
    ["recovery pending", recoveryPending],
    ["unlock", unlock],
    ["signed out", signedOut],
  ];
  for (const [name, phase] of phases) {
    try {
      if (name !== "auth") await ui.home();
      yield* phase(ui);
    } catch (err) {
      const line = String(err).split("\n").slice(0, 2).join(" | ");
      cfg.errors.push(`${cfg.config.id} ${name}: ${line}`);
      cfg.log?.(`${cfg.config.id} FAILED ${name}: ${line}`);
      if (name === "auth") return;
      await page.keyboard.press("Escape").catch(() => {});
      for (const other of cfg.context.pages()) {
        if (other !== page) await other.close().catch(() => {});
      }
      await page.goto(cfg.server.url).catch(() => {});
    }
  }
}
