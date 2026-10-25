// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The service worker's notification tap (reliability.md §3, ui.md §15.2): an
 * open window is told the URL before it is focused, so it
 * switches to the check-in while still in the background; with no window, a
 * new one opens on the URL. A page's short address (`/methodology`) answers
 * with the precached page. sw.js is loaded as it ships, with a stub `self`.
 */
import { assert, assertEquals } from "@std/assert";
import { REMINDER_RESPONSE_WINDOW_MIN } from "../../../shared/protocol.ts";

type Handler = (event: unknown) => void;

const SW_SOURCE = new URL("../sw.js", import.meta.url);

/** Loads sw.js against a fake worker scope and returns its listeners */
async function loadWorker(
  windows: { url: string }[],
  calls: string[],
  shown: Array<{ title: string; options: Record<string, unknown> }> = [],
  /** What the caches hold, by path; `fetched` records what went out */
  cached: Record<string, string> = {},
  fetched: string[] = [],
) {
  const src = await Deno.readTextFile(SW_SOURCE);
  const handlers: Record<string, Handler> = {};
  const clients = windows.map((w) => ({
    url: w.url,
    focus: async () => {
      calls.push("focus");
      await Promise.resolve();
    },
    postMessage: (m: { url: string }) => calls.push("post:" + m.url),
  }));
  const fakeSelf = {
    addEventListener(type: string, fn: Handler) {
      handlers[type] = fn;
    },
    location: { origin: "https://emo.test" },
    clients: {
      matchAll: () => Promise.resolve(clients),
      openWindow: (u: string) => {
        calls.push("open:" + u);
        return Promise.resolve(null);
      },
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    skipWaiting() {},
  };
  const match = (key: string | { url: string }) => {
    const path = typeof key === "string" ? key : new URL(key.url).pathname;
    return Promise.resolve(
      path in cached ? new Response(cached[path]) : undefined,
    );
  };
  const fakeCaches = {
    match,
    open: () => Promise.resolve({ match, put() {} }),
  };
  const fakeFetch = (request: { url: string }) => {
    fetched.push(new URL(request.url).pathname);
    return Promise.resolve(new Response("from the server"));
  };
  new Function("self", "caches", "fetch", "__EMO_PRECACHE__", src)(
    fakeSelf,
    fakeCaches,
    fakeFetch,
    [],
  );
  return handlers;
}

/** Dispatches a page navigation and returns what the worker answered */
async function navigate(handlers: Record<string, Handler>, path: string) {
  let answer: Promise<Response> | undefined;
  handlers.fetch({
    request: {
      method: "GET",
      mode: "navigate",
      url: `https://emo.test${path}`,
    },
    respondWith(p: Promise<Response>) {
      answer = p;
    },
  });
  return await answer!;
}

/** Dispatches a notification tap and waits for the work it hands waitUntil */
async function tap(
  handlers: Record<string, Handler>,
  url: string,
  shownAt?: number,
) {
  let done: Promise<unknown> = Promise.resolve();
  handlers.notificationclick({
    notification: { close() {}, data: { url, shownAt } },
    waitUntil(p: Promise<unknown>) {
      done = p;
    },
  });
  await done;
}

const URL_WITH_REMINDER = `/now?reminder=${crypto.randomUUID()}`;

Deno.test("sw - a tap tells the open window the URL, then focuses it", async () => {
  const calls: string[] = [];
  const handlers = await loadWorker(
    [{ url: "https://emo.test/history" }],
    calls,
  );
  await tap(handlers, URL_WITH_REMINDER);
  assertEquals(calls, ["post:" + URL_WITH_REMINDER, "focus"]);
});

Deno.test("sw - a window of another origin is not used", async () => {
  const calls: string[] = [];
  const handlers = await loadWorker([{ url: "https://other.test/" }], calls);
  await tap(handlers, URL_WITH_REMINDER);
  assertEquals(calls, ["open:" + URL_WITH_REMINDER]);
});

Deno.test("sw - with no window, a tap opens one on the URL", async () => {
  const calls: string[] = [];
  const handlers = await loadWorker([], calls);
  await tap(handlers, URL_WITH_REMINDER);
  assertEquals(calls, ["open:" + URL_WITH_REMINDER]);
});

Deno.test("sw - a push shows one notification that sounds and knows when it appeared", async () => {
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const handlers = await loadWorker([], [], shown);
  let done: Promise<unknown> = Promise.resolve();
  const before = Date.now();
  handlers.push({
    data: { json: () => ({ title: "Що в тілі?", url: URL_WITH_REMINDER }) },
    waitUntil(p: Promise<unknown>) {
      done = p;
    },
  });
  await done;
  assertEquals(shown.length, 1);
  const { options } = shown[0];
  assertEquals([options.tag, options.renotify], ["emo", true]);
  const data = options.data as { url: string; shownAt: number };
  assertEquals(data.url, URL_WITH_REMINDER);
  assert(data.shownAt >= before && data.shownAt <= Date.now());
});

Deno.test("sw - a tap after the response window opens a manual check-in", async () => {
  const window = REMINDER_RESPONSE_WINDOW_MIN * 60_000;
  const calls: string[] = [];
  const handlers = await loadWorker([], calls);
  await tap(handlers, URL_WITH_REMINDER, Date.now() - window + 60_000);
  await tap(handlers, URL_WITH_REMINDER, Date.now() - window - 60_000);
  assertEquals(calls, ["open:" + URL_WITH_REMINDER, "open:/now"]);
});

Deno.test("sw - its response window is the one in shared/protocol.ts", async () => {
  // sw.js imports nothing, so it keeps its own copy of the number
  const src = await Deno.readTextFile(SW_SOURCE);
  const m = src.match(/const RESPONSE_WINDOW_MS = (\d+) \* 60 \* 1000;/);
  assertEquals(Number(m?.[1]), REMINDER_RESPONSE_WINDOW_MIN);
});

Deno.test("sw - /methodology is the precached page, so it opens offline", async () => {
  const fetched: string[] = [];
  const handlers = await loadWorker([], [], [], {
    "/methodology.html": "the methodology",
    "/index.html": "the app",
  }, fetched);
  assertEquals(
    await (await navigate(handlers, "/methodology")).text(),
    "the methodology",
  );
  // Any other route without an extension is still the app
  assertEquals(await (await navigate(handlers, "/history")).text(), "the app");
  assertEquals(fetched, []);
});

Deno.test("sw - /methodology before the precache is filled: the server's page", async () => {
  const fetched: string[] = [];
  const handlers = await loadWorker([], [], [], {}, fetched);
  assertEquals(
    await (await navigate(handlers, "/methodology")).text(),
    "from the server",
  );
  assertEquals(fetched, ["/methodology"]);
});
