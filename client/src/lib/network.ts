// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Whether Emo can be reached, for the offline band and the sync dot. The
 * browser's `offline` event says so at once; after that, API requests decide
 * (api.ts): one that got no answer is offline, any answer from Emo — an error
 * too — is online. A 5xx without X-Emo-Server is not Emo: it is a reverse
 * proxy answering for a stopped server, so it counts as no answer.
 * `navigator.onLine` alone is not trusted: it stays true on a network without
 * internet and while the server is down; it only tells "this device is
 * offline" from "the server can't be reached" (`deviceOnline`). While
 * offline, a `GET /api/instance` asks again on `online`, when the app becomes
 * visible, and every 10 s → 60 s while visible, so the band clears without
 * waiting for the next sync. A leaf module: api.ts imports it, never the
 * reverse. Specification: ui.md §3–§3.6, reliability.md §1.5.
 */

const PROBE_FIRST_MS = 10_000;
const PROBE_MAX_MS = 60_000;

let offline = false;
let watching = false;
let probeDelay = PROBE_FIRST_MS;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(offline: boolean) => void>();

let device = typeof navigator === "undefined" || navigator.onLine !== false;
let deviceWatching = false;
const deviceListeners = new Set<(online: boolean) => void>();

export function isOffline(): boolean {
  return offline;
}

export function onOfflineChange(fn: (offline: boolean) => void): () => void {
  listeners.add(fn);
  fn(offline);
  return () => listeners.delete(fn);
}

/**
 * Emo answered: anything below 500, or a 5xx that carries X-Emo-Server (on
 * every Emo response, errors included — api.md §1). A 5xx without it
 * is a reverse proxy answering for a stopped server: no answer
 * (ui.md §3.6).
 */
export function isEmoAnswer(r: Response): boolean {
  return r.status < 500 || r.headers.has("X-Emo-Server");
}

/**
 * What the browser says about its own network (`navigator.onLine` and its
 * events), apart from whether Emo answers: it tells "offline" from
 * "unreachable" (ui.md §3).
 */
export function deviceOnline(): boolean {
  return device;
}

function setDevice(online: boolean) {
  if (device === online) return;
  device = online;
  for (const fn of deviceListeners) fn(online);
}

/**
 * The window's `online` / `offline` events, registered once. Once App
 * watches, `online` asks Emo first and only then says the device is online,
 * so the band goes from "Offline" straight to gone rather than through
 * "Can't reach the server" (at most 3 s while the probe hangs).
 */
function watchDevice() {
  if (deviceWatching || typeof globalThis.addEventListener !== "function") {
    return;
  }
  deviceWatching = true;
  globalThis.addEventListener("offline", () => setDevice(false));
  globalThis.addEventListener("online", () => {
    if (!watching) return setDevice(true);
    const late = setTimeout(() => setDevice(true), 3_000);
    void checkReachable().finally(() => {
      clearTimeout(late);
      setDevice(true);
    });
  });
}

/** Calls `fn` with the current value at once, then on each change. */
export function onDeviceOnlineChange(
  fn: (online: boolean) => void,
): () => void {
  watchDevice();
  deviceListeners.add(fn);
  fn(device);
  return () => deviceListeners.delete(fn);
}

/** What a request just saw: an answer (`true`) or none at all (`false`). */
export function noteReachable(reachable: boolean): void {
  if (offline === !reachable) return;
  offline = !reachable;
  if (offline) {
    probeDelay = PROBE_FIRST_MS;
    scheduleProbe();
  } else if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  for (const fn of listeners) fn(offline);
}

/** One cheap request, outside api.ts: no compat or epoch side effects. */
export async function checkReachable(): Promise<void> {
  try {
    const r = await fetch("/api/instance", {
      cache: "no-store",
      credentials: "same-origin",
    });
    await r.body?.cancel();
    noteReachable(isEmoAnswer(r));
  } catch {
    noteReachable(false);
  }
}

function visible(): boolean {
  return typeof document === "undefined" ||
    document.visibilityState === "visible";
}

function scheduleProbe() {
  if (!watching || probeTimer) return;
  probeTimer = setTimeout(() => {
    probeTimer = null;
    if (!offline) return;
    probeDelay = Math.min(probeDelay * 2, PROBE_MAX_MS);
    // A browser that knows it is offline says so with `online` later
    if (visible() && navigator.onLine) void checkReachable();
    scheduleProbe();
  }, probeDelay);
}

/** Once, from App: the browser's own signals and the probe while offline. */
export function startNetworkWatch(): void {
  if (watching) return;
  watching = true;
  if (!navigator.onLine) noteReachable(false);
  // `online` probes in watchDevice; its `offline` runs before this one, so
  // the dot never sees "no answer" with the device still online
  watchDevice();
  globalThis.addEventListener("offline", () => noteReachable(false));
  document.addEventListener("visibilitychange", () => {
    if (offline && visible()) void checkReachable();
  });
}
