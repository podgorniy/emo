// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What `make e2e` tests share: the compiled binary (`bin/emo`, or `EMO_BIN`)
 * on a free port with a temporary `DATA_DIR` and `DEV_MODE=true` (plain http,
 * mail printed to stderr: the stubbed mail sink of development.md §7), and headless
 * Chromium through playwright-core. The cached browser must match the pinned
 * playwright-core version; `make e2e` installs it on first run.
 * Specification: development.md §5.3, ops.md §1, development.md §7.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import axe from "axe-core";
import { encodeHex } from "../shared/crypto/encoding.ts";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const BIN = Deno.env.get("EMO_BIN") ?? path.join(ROOT, "bin/emo");

export interface E2eServer {
  url: string;
  /** A fresh invite code from `emo invite`. */
  invite(): Promise<string>;
  /** The code of the next mail to `email` not handed out yet (waits 10 s). */
  mailCode(email: string): Promise<string>;
  /** SIGTERM, then the exit code once the process is gone. */
  stop(): Promise<number>;
}

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

/** `env`: settings over the defaults below (`REGISTRATION: "invite"`, …). */
export async function startServer(
  env: Record<string, string> = {},
): Promise<E2eServer> {
  try {
    await Deno.stat(BIN);
  } catch {
    throw new Error(`${BIN} is missing: run \`make build\` first`);
  }
  const dataDir = await Deno.makeTempDir({ prefix: "emo-e2e-" });
  const port = freePort();
  const url = `http://localhost:${port}`;
  const fullEnv = {
    PATH: Deno.env.get("PATH") ?? "",
    HOME: Deno.env.get("HOME") ?? "",
    DATA_DIR: dataDir,
    PORT: String(port),
    BASE_URL: url,
    DEV_MODE: "true",
    SERVER_SECRET: encodeHex(crypto.getRandomValues(new Uint8Array(32))),
    LOG_LEVEL: "warn",
    // The built-in notice, so every About sheet shows its link
    PRIVACY_NOTICE_URL: "/privacy.html",
    ...env,
  };

  const child = new Deno.Command(BIN, {
    args: ["serve"],
    env: fullEnv,
    clearEnv: true,
    cwd: dataDir,
    stdout: "null",
    stderr: "piped",
  }).spawn();

  let stderr = "";
  const mailsTaken = new Map<string, number>();
  const reading = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) {
      stderr += decoder.decode(chunk, { stream: true });
    }
  })();

  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const res = await fetch(`${url}/healthz`);
      await res.body?.cancel();
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill();
        throw new Error(`emo did not start:\n${stderr}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return {
    url,
    async invite() {
      const out = await new Deno.Command(BIN, {
        args: ["invite"],
        env: fullEnv,
        clearEnv: true,
        cwd: dataDir,
      }).output();
      const text = new TextDecoder().decode(out.stdout);
      const code = /Invite code: (\S+)/.exec(text)?.[1];
      if (!code) {
        throw new Error(
          `emo invite printed no code:\n${text}${
            new TextDecoder().decode(out.stderr)
          }`,
        );
      }
      return code;
    },
    async mailCode(email: string) {
      // Each mail is handed out once: a second sign-in waits for its own
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        const mails = stderr.split("[emo dev mail").filter((m) =>
          m.includes(`To: ${email}`)
        );
        const taken = mailsTaken.get(email) ?? 0;
        const code = /\b(\d{6})\b/.exec(mails[taken] ?? "")?.[1];
        if (code) {
          mailsTaken.set(email, taken + 1);
          return code;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`no new sign-in mail to ${email}:\n${stderr}`);
    },
    async stop() {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone
      }
      const { code } = await child.status;
      await reading.catch(() => {});
      await Deno.remove(dataDir, { recursive: true });
      return code;
    },
  };
}

/**
 * Headless Chromium. Its contexts ask for reduced motion unless a test says
 * otherwise (`reducedMotion: "no-preference"`): Playwright's "stable" check
 * waits for moving elements, and the app's arrivals (ui.md §5.1) would make
 * every click wait for them. e2e/fx.e2e.ts runs with
 * motion on, to show it never holds input.
 */
export async function launchBrowser(): Promise<Browser> {
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    throw new Error(
      `Chromium for playwright-core is missing; \`make e2e\` installs it:\n${err}`,
    );
  }
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (options = {}) =>
    newContext({ reducedMotion: "reduce", ...options });
  return browser;
}

/**
 * The safe-area insets `env(safe-area-inset-*)` reports on this page, as on
 * an iPhone with a home indicator (`bottom: 34`): Chromium's
 * `Emulation.setSafeAreaInsetsOverride`, which every `env()` use follows
 * (the app's `--safe-bottom` and the CSS that reads `env()` itself). It
 * holds across navigations while its CDP session stays attached (it is
 * never detached here); another page needs its own call.
 */
export async function emulateSafeArea(
  page: Page,
  { top = 0, bottom = 0, left = 0, right = 0 }: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  },
): Promise<void> {
  // Not in playwright-core's protocol types yet
  const cdp = await page.context().newCDPSession(page) as unknown as {
    send(method: string, params: unknown): Promise<unknown>;
  };
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: {
      top,
      topMax: top,
      bottom,
      bottomMax: bottom,
      left,
      leftMax: left,
      right,
      rightMax: right,
    },
  });
}

/** A CSP violation as the page saw it. */
export interface Violation {
  directive: string;
  blocked: string;
  sample: string;
  source: string;
}

/**
 * Records `securitypolicyviolation` events (and CSP console errors, which
 * also cover workers) on every page of the context from the first script on,
 * plus any API response the client refused as off-schema.
 */
export async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __csp: unknown[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__csp.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
        sample: e.sample,
        source: `${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`,
      });
    });
  });
  const console: string[] = [];
  page.on("console", (m) => {
    // CSP errors, and a response that failed its protocol.ts schema
    if (
      (m.type() === "error" && /Content.Security.Policy/i.test(m.text())) ||
      /Unexpected response/.test(m.text())
    ) {
      console.push(m.text());
    }
  });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  /** What happened since the last call, as readable lines; empty = clean. */
  return async () => {
    const events = await page.evaluate(() => {
      const w = globalThis as unknown as { __csp?: Violation[] };
      const out = w.__csp ?? [];
      w.__csp = [];
      return out;
    });
    const lines = [
      ...events.map((v) =>
        `CSP ${v.directive}: ${v.blocked} ${v.sample} at ${v.source}`
      ),
      ...console.splice(0).map((t) => `console: ${t}`),
      ...errors.splice(0).map((t) => `page error: ${t}`),
    ];
    return lines;
  };
}

export const EMAIL = "e2e@example.com";
export const PASSPHRASE = "correct horse battery staple";
/** The Now circle's accessible name: its visible label (`home.now`). */
export const NOW = "Now";

/**
 * A new account from the sign-in screen to Home (English UI): invite, mailed
 * code, passphrase, recovery key ("I'll write it down"), install and
 * reminders. `onScreen` runs on each screen once it is shown.
 */
export async function signUp(
  page: Page,
  server: E2eServer,
  onScreen: (name: string) => Promise<void> = async () => {},
  email = EMAIL,
): Promise<void> {
  const button = (name: string | RegExp) =>
    page.getByRole("button", { name, exact: typeof name === "string" });

  await page.goto(server.url);
  await page.getByLabel("Email").waitFor();
  await onScreen("sign-in");
  await button("About and privacy").click();
  await page.getByRole("dialog").waitFor();
  await onScreen("sign-in: about");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await button("I have an invite code").click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Invite code").fill(await server.invite());
  await button("Send code").click();
  await page.getByLabel("Six-digit code").waitFor();
  await onScreen("sign-in: code");
  await page.getByLabel("Six-digit code").fill(await server.mailCode(email));
  // Six digits send themselves (ui.md §12.3)

  await page.getByLabel(/^Passphrase/).waitFor();
  await onScreen("passphrase");
  await page.getByLabel(/^Passphrase/).fill(PASSPHRASE);
  await page.getByLabel("Repeat").fill(PASSPHRASE);
  await button("Next").click();
  await button(/I'll write it down/).waitFor({ timeout: 30_000 });
  await onScreen("recovery key");
  await button(/I'll write it down/).click();
  await button("Next").click();
  await button("Done").waitFor();
  await onScreen("install and reminders");
  await button("Done").click();
  await button(NOW).waitFor();
}

/** Settings is on screen (its h1) */
export function settingsTitle(page: Page) {
  return page.getByRole("heading", { level: 1, name: "Settings", exact: true });
}

/**
 * Settings → Appearance opened (it is one row until then,
 * ui.md §13): resolves with its theme radio group.
 */
export async function openAppearance(page: Page) {
  const row = page.locator("#appearance button[aria-expanded]");
  await row.waitFor();
  if (await row.getAttribute("aria-expanded") === "false") await row.click();
  const group = page.getByRole("radiogroup", { name: /theme/i });
  await group.waitFor();
  return group;
}

/**
 * A still click on the untouched slider on screen, where the thumb is (the
 * midpoint): Next waits for it (ui.md §6.2, lib/press.ts).
 * Nothing without one.
 */
export async function pressSlider(page: Page): Promise<void> {
  const slider = page.locator("main .slider.untouched input[type=range]");
  if (await slider.count()) await slider.click();
}

/**
 * Next in the check-in, pressing an untouched slider first. A tap within
 * 350 ms of a step change is ignored on purpose (ui.md §5.1), so
 * this waits that long first.
 */
export async function nextStep(page: Page): Promise<void> {
  await page.waitForTimeout(360);
  await pressSlider(page);
  await page.locator("button.next").click();
}

/**
 * ui.md §10, development.md §5.3: axe-core (WCAG 2.x A/AA rules)
 * on the current screen, plus the handoff's stricter rule that every target
 * is at least 44×44 px. Returns readable problem lines; empty = clean.
 */
export async function auditA11y(page: Page): Promise<string[]> {
  const loaded = await page.evaluate(() => "axe" in globalThis);
  if (!loaded) await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    // deno-lint-ignore no-explicit-any
    const result = await (globalThis as any).axe.run({
      include: [document],
      // The 50 % preview is hidden from assistive technology (see above)
      exclude: [[".phone"]],
    }, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    // deno-lint-ignore no-explicit-any
    return result.violations.map((v: any) =>
      `${v.id} (${v.impact}): ${
        // deno-lint-ignore no-explicit-any
        v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`
    );
  });
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const sel =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="radio"], [role="tab"], [role="switch"]';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Not rendered, or a visually hidden helper
      if (r.width <= 1 || r.height <= 1 || style.visibility === "hidden") {
        continue;
      }
      // A checkbox or colour input inside its label: the label is the target
      const label = el.matches(
          'input[type="checkbox"], input[type="radio"], input[type="color"]',
        )
        ? el.closest("label")
        : null;
      if (label && label.getBoundingClientRect().height >= 43.5) continue;
      // Not exposed: the 50 % preview of Settings → Appearance
      if (el.closest('[aria-hidden="true"]')) continue;
      // Body zones are ≥ 44 px tall at 1× and scale with the figure, which
      // never drops below 85 % of 520 px (ui.md §10)
      const figure = el.classList.contains("hit")
        ? el.closest(".figure")
        : null;
      if (figure) {
        const h = figure.getBoundingClientRect().height;
        if (h >= 0.85 * 520 - 1 && r.height / (h / 520) >= 43.5) continue;
      }
      if (r.width < 43.5 || r.height < 43.5) {
        const name = el.getAttribute("aria-label") ??
          el.textContent?.trim().slice(0, 30) ?? "";
        out.push(
          `target ${Math.round(r.width)}×${
            Math.round(r.height)
          }: <${el.tagName.toLowerCase()}${
            el.className ? `.${String(el.className).split(" ")[0]}` : ""
          }> "${name}"`,
        );
      }
    }
    return out;
  });
  return [...violations, ...small];
}

/** One check-in to seed: a day and local time, and any fields to replace. */
export interface CheckInSpec {
  /** 0 = today on the browser's clock */
  daysAgo: number;
  /** Local time, "14:10" */
  at: string;
  [field: string]: unknown;
}

/**
 * Check-ins written straight into this browser's local store in the app's
 * own format (architecture.md §5.5): canonical JSON padded to 2 048 bytes,
 * AES-256-GCM under the device's DEK with the entry AAD. `queued` puts them in
 * the outbox, as if just saved (the next sync uploads them); otherwise they
 * count as synced (seq 1…n, already checked), for screens and timings.
 * Returns their ids, in the order given.
 */
export async function seedCheckIns(
  page: Page,
  specs: CheckInSpec[],
  { queued = false }: { queued?: boolean } = {},
): Promise<string[]> {
  return await page.evaluate(async ({ specs, queued }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("emo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const get = <T>(store: string, key: string) =>
      new Promise<T>((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const dek = (await get<{ key: CryptoKey }>("keys", "dek")).key;
    const account = (await get<
      { value: { id: string; current_key_version: number } }
    >("meta", "account")).value;
    const keyVersion = account.current_key_version || 1;
    const canon = (v: unknown): string =>
      v === null || typeof v !== "object"
        ? JSON.stringify(v)
        : Array.isArray(v)
        ? `[${v.map(canon).join(",")}]`
        : `{${
          Object.keys(v).sort().map((k) =>
            `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`
          ).join(",")
        }}`;
    const b64 = (bytes: Uint8Array) => {
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    const rows: Array<{ id: string; nonce_b64: string; ct_b64: string }> = [];
    for (const { daysAgo, at, ...over } of specs) {
      const when = new Date();
      when.setDate(when.getDate() - daysAgo);
      const [h, m] = at.split(":").map(Number);
      when.setHours(h, m, 0, 0);
      const entry = {
        schema_v: 2,
        id: crypto.randomUUID(),
        ts: when.toISOString(),
        tz_offset_min: -when.getTimezoneOffset(),
        trigger: "random",
        reminder_id: null,
        latency_sec: 41,
        hidden_sec: 0,
        skipped: false,
        abandoned: false,
        untouched: [],
        ui: null,
        body: {
          locations: ["throat", "chest"],
          qualities: ["squeeze", "lump"],
          intensity: 7,
        },
        affect: {
          valence: -2,
          arousal: 8,
          word: "fear.anxiety",
          word_confidence: "guess",
        },
        urge: "shrink",
        head_mode: 3,
        context_tag: "work",
        context_other: null,
        note: null,
        ...over,
      };
      const json = new TextEncoder().encode(canon(entry));
      const padded = new Uint8Array(Math.ceil(json.length / 2048) * 2048)
        .fill(0x20);
      padded.set(json);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = new TextEncoder().encode(
        ["emo-entry/v1", account.id, entry.id, keyVersion].join("\0"),
      );
      const ct = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: aad },
          dek,
          padded,
        ),
      );
      rows.push({ id: entry.id, nonce_b64: b64(iv), ct_b64: b64(ct) });
    }
    const tx = db.transaction(["entries", "outbox"], "readwrite");
    const now = new Date().toISOString();
    rows.forEach((row, i) => {
      tx.objectStore("entries").put({
        ...row,
        seq: queued ? 0 : i + 1,
        key_version: keyVersion,
        deleted: false,
        received_at: now,
        ...(queued ? {} : { check: "ok" }),
      });
      if (queued) {
        tx.objectStore("outbox").put({
          ...row,
          op: "put",
          key_version: keyVersion,
          attempt_count: 0,
          created_at: now,
        });
      }
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return rows.map((r) => r.id);
  }, { specs, queued });
}
