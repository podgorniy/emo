// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The service worker from the page's side: register after the first paint,
 * look for a new version on open and when the app becomes visible (at most
 * every 10 minutes), and switch to it only when the person taps "Restart" —
 * never by itself, never inside a check-in. "Later" snoozes the card for
 * this waiting version for 24 h on this device; a restart that did not take
 * is noticed after the reload. Specification: reliability.md §3,
 * ui.md §3 (the update card).
 */

export type UpdateState = "none" | "checking" | "ready";

const CHECK_EVERY_MS = 10 * 60 * 1000;
let registration: ServiceWorkerRegistration | null = null;
let state: UpdateState = "none";
let lastCheck = 0;
let restarting = false;
const listeners = new Set<(s: UpdateState) => void>();

function set(next: UpdateState) {
  if (state === next) return;
  state = next;
  for (const fn of listeners) fn(next);
}

export function onUpdateState(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

/** A worker is waiting while this page is controlled by the old one. */
function track(reg: ServiceWorkerRegistration) {
  if (reg.waiting && navigator.serviceWorker.controller) set("ready");
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        set("ready");
      }
    });
  });
}

export async function checkForUpdate(force = false): Promise<void> {
  if (!registration || (!force && Date.now() - lastCheck < CHECK_EVERY_MS)) {
    return;
  }
  lastCheck = Date.now();
  if (force && state !== "ready") set("checking");
  try {
    await registration.update();
  } catch {
    // Offline: next time
  }
  if (registration.waiting && navigator.serviceWorker.controller) set("ready");
  else if (state === "checking") set("none");
}

/** The waiting version's script URL, which names it for "Later". */
export function waitingVersion(): string | null {
  return registration?.waiting?.scriptURL ?? null;
}

const RESTART_KEY = "emo.restart";
const LATER_KEY = "emo.updateLater";
const LATER_MS = 24 * 60 * 60 * 1000;
/** Set after a reload when the same version is still waiting */
let restartFailed = false;

export function didRestartFail(): boolean {
  return restartFailed;
}

/**
 * "Restart": wait for pending local writes (a sync pass), then the waiting
 * worker takes over and the page reloads once on `controllerchange`; if
 * nothing happens within 8 s, it reloads anyway.
 */
export async function applyUpdate(
  whenIdle: () => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  const waiting = registration?.waiting;
  if (!waiting) return;
  restarting = true;
  try {
    sessionStorage.setItem(RESTART_KEY, waiting.scriptURL);
  } catch {
    // Private mode: the failure line just cannot show
  }
  await whenIdle();
  waiting.postMessage({ type: "SKIP_WAITING" });
  setTimeout(() => location.reload(), 8000);
}

/** "Later": this waiting version's card stays away for 24 h on this device. */
export function snoozeUpdate(now = Date.now()): void {
  const version = waitingVersion();
  if (!version) return;
  try {
    localStorage.setItem(LATER_KEY, JSON.stringify({ version, at: now }));
  } catch {
    // Storage blocked: the card simply shows again next time
  }
}

/** Whether "Later" was chosen for this waiting version within 24 h. */
export function isSnoozed(now = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(LATER_KEY);
    if (!raw) return false;
    const { version, at } = JSON.parse(raw) as { version: string; at: number };
    return version === waitingVersion() && now - at < LATER_MS;
  } catch {
    return false;
  }
}

export function initServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (restarting) location.reload();
  });
  const register = async () => {
    try {
      registration = await navigator.serviceWorker.register("/sw.js");
      track(registration);
      await checkForUpdate(true);
      // After "Restart", the same version still waiting: it did not take
      try {
        const tried = sessionStorage.getItem(RESTART_KEY);
        sessionStorage.removeItem(RESTART_KEY);
        restartFailed = tried !== null && tried === waitingVersion();
      } catch {
        restartFailed = false;
      }
      const next = registration.waiting && navigator.serviceWorker.controller
        ? "ready"
        : "none";
      // Listeners re-read the failure flag with the state
      if (restartFailed && state === next) {
        for (const fn of listeners) fn(next);
      }
      set(next);
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  };
  // The app script may run after `load` already fired
  if (document.readyState === "complete") void register();
  else {globalThis.addEventListener("load", () => void register(), {
      once: true,
    });}
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
}
