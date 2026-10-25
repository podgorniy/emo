// SPDX-License-Identifier: AGPL-3.0-or-later
/// <reference lib="webworker" />
/**
 * The service worker. The build (vite.config.ts) replaces the two
 * placeholders below with the content hash of the build and its file list,
 * so identical builds give an identical worker and no spurious update.
 * Self-contained: never imports app code (reliability.md §3).
 *
 * - install: precache the shell into `emo-shell-<hash>`; never skipWaiting
 *   on its own — the page asks after the person taps "Restart".
 * - activate: claim clients, delete every cache not in use.
 * - fetch: `/api/*` network only; navigations to the app's routes (no file
 *   extension) get the cached shell first, so the app opens offline; a page
 *   such as `/privacy.html`, or `/source.tar.gz`, is fetched as itself, and
 *   a page's short address (`/methodology`) gets that page from the cache;
 *   shell files cache-first; other same-origin files
 *   are cached on first use (`emo-runtime`, fonts in `emo-fonts`). Only a
 *   response whose type matches the request is cached (never HTML under a
 *   script URL).
 * Specification: reliability.md §3, architecture.md §7.2, §9.2.
 */

const BUILD = "__EMO_BUILD__";
const PRECACHE = __EMO_PRECACHE__;

const SHELL = `emo-shell-${BUILD}`;
const RUNTIME = "emo-runtime";
// Named after the font files of this build: a changed font gets a fresh
// cache, and the old one is deleted on activation (performance.md §2)
const FONTS = "__EMO_FONTS__";
const KEEP = [SHELL, RUNTIME, FONTS];
/** A built-in page under a short address of its own (server/app.ts PAGES) */
const PAGES = new Map([["/methodology", "/methodology.html"]]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)),
        )
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/** A cacheable answer for this request: ok, and HTML only for a page. */
function fits(request, response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  const html = (response.headers.get("Content-Type") || "").includes(
    "text/html",
  );
  return request.mode === "navigate" ? html : !html;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;

  if (request.mode === "navigate" && PAGES.has(url.pathname)) {
    event.respondWith(
      caches.match(PAGES.get(url.pathname)).then((hit) =>
        hit || fetch(request)
      ),
    );
    return;
  }

  if (request.mode === "navigate" && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const shell = await cache.match("/index.html");
        if (shell) return shell;
        const response = await fetch(request);
        if (fits(request, response)) cache.put("/index.html", response.clone());
        return response;
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return caches.open(url.pathname.startsWith("/fonts/") ? FONTS : RUNTIME)
        .then(
          async (cache) => {
            const response = await fetch(request);
            if (fits(request, response)) cache.put(request, response.clone());
            return response;
          },
        );
    }),
  );
});

// Push notification listener. Self-contained (reliability.md §3): the
// payload is {title, url, tag, renotify} (architecture.md §9.2); anything else
// shows the fixed English title and opens /now as a manual check-in.
const REMINDER_URL = /^\/now(\?reminder=[0-9a-f-]{36})?$/;
// A tap answers the reminder only this soon after the notification appeared;
// later it opens a manual check-in (shared/protocol.ts
// REMINDER_RESPONSE_WINDOW_MIN, methodology.md §1.1)
const RESPONSE_WINDOW_MS = 15 * 60 * 1000;

self.addEventListener("push", (event) => {
  let title = "What's in the body?";
  let url = "/now";
  if (event.data) {
    try {
      const data = event.data.json();
      if (typeof data.title === "string" && data.title) title = data.title;
      if (typeof data.url === "string" && REMINDER_URL.test(data.url)) {
        url = data.url;
      }
    } catch {
      // keep the fallback
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body: "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      // One notification at a time: a new reminder replaces the old one, and
      // still sounds, so one left unanswered never silences the next
      tag: "emo",
      renotify: true,
      // When it appeared: the response window counts from here
      data: { url, shownAt: Date.now() },
    }),
  );
});

// A tap opens the check-in: an open window is told the URL first, so it
// switches to the check-in while still in the background, then comes to the
// front (it keeps its state: an unlocked key, a draft); otherwise a new
// window opens on it (reliability.md §3). After the response window the tap
// no longer answers the reminder: it opens /now, a manual check-in.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss" || event.action === "close") {
    return;
  }
  const shownAt = event.notification.data?.shownAt;
  const late = typeof shownAt === "number" &&
    Date.now() - shownAt > RESPONSE_WINDOW_MS;
  const url = late ? "/now" : event.notification.data?.url || "/now";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      async (clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin) {
            client.postMessage({
              type: "open-url",
              url,
              action: event.action || undefined,
            });
            await client.focus();
            return;
          }
        }
        if (self.clients.openWindow) await self.clients.openWindow(url);
      },
    ),
  );
});
