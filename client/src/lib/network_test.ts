// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The offline band's state (ui.md §3.6): a request with no
 * answer is offline, any answer from Emo — an error too — is online, and a
 * 5xx without X-Emo-Server (a proxy answering for a stopped server) is no
 * answer. The device's own network state is kept apart (ui.md §3).
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  checkReachable,
  deviceOnline,
  isEmoAnswer,
  isOffline,
  noteReachable,
  onDeviceOnlineChange,
  onOfflineChange,
} from "./network.ts";
import { apiGetInstance } from "./api.ts";

const realFetch = globalThis.fetch;

async function withFetch(
  fake: () => Promise<Response>,
  fn: () => Promise<void>,
) {
  globalThis.fetch = fake;
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    noteReachable(true);
  }
}

/** A reverse proxy's own error page: no X-Emo-Server */
const proxyPage = (status: number) =>
  new Response("<html><body>Bad Gateway</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });

/** Emo's own error envelope: always X-Emo-Server (api.md §1) */
const emoError = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: "" } }), {
    status,
    headers: { "Content-Type": "application/json", "X-Emo-Server": "0.1.0" },
  });

Deno.test("network - listeners hear each change once", () => {
  const seen: boolean[] = [];
  const stop = onOfflineChange((offline) => seen.push(offline));
  noteReachable(false);
  noteReachable(false);
  noteReachable(true);
  noteReachable(true);
  stop();
  noteReachable(false);
  noteReachable(true);
  // The current value first, then the two changes
  assertEquals(seen, [false, true, false]);
});

Deno.test("network - Emo's answer: below 500, or a 5xx with X-Emo-Server", () => {
  assert(isEmoAnswer(emoError(503, "db_busy")));
  assert(isEmoAnswer(emoError(500, "internal")));
  for (const status of [502, 503, 504]) {
    assertEquals(isEmoAnswer(proxyPage(status)), false, String(status));
  }
  // Any 4xx is an answer, with the header or without
  assert(isEmoAnswer(new Response(null, { status: 404 })));
  assert(isEmoAnswer(new Response(null, { status: 429 })));
  assert(isEmoAnswer(new Response(null, { status: 200 })));
});

Deno.test("network - the probe: no answer is offline, so is a proxy's 5xx", async () => {
  await withFetch(() => Promise.reject(new TypeError("offline")), async () => {
    await checkReachable();
    assertEquals(isOffline(), true);
  });
  // Emo itself, failing: online
  noteReachable(false);
  await withFetch(() => Promise.resolve(emoError(503, "db_busy")), async () => {
    await checkReachable();
    assertEquals(isOffline(), false);
  });
  // A proxy answering for a stopped server: still offline, never a flap
  for (const status of [502, 503, 504]) {
    noteReachable(false);
    await withFetch(() => Promise.resolve(proxyPage(status)), async () => {
      await checkReachable();
      assertEquals(isOffline(), true, String(status));
    });
  }
  // A 404 without the header is an answer
  noteReachable(false);
  await withFetch(
    () => Promise.resolve(new Response(null, { status: 404 })),
    async () => {
      await checkReachable();
      assertEquals(isOffline(), false);
    },
  );
});

Deno.test("network - every API request reports what it saw", async () => {
  await withFetch(() => Promise.reject(new TypeError("offline")), async () => {
    await assertRejects(() => apiGetInstance());
    assertEquals(isOffline(), true);
  });
  noteReachable(false);
  await withFetch(
    () => Promise.resolve(emoError(500, "internal")),
    async () => {
      await assertRejects(() => apiGetInstance());
      assertEquals(isOffline(), false);
    },
  );
  await withFetch(() => Promise.resolve(proxyPage(502)), async () => {
    await assertRejects(() => apiGetInstance());
    assertEquals(isOffline(), true);
  });
});

Deno.test("network - an aborted request says nothing", async () => {
  await withFetch(
    () => Promise.reject(new DOMException("aborted", "AbortError")),
    async () => {
      await assertRejects(() => apiGetInstance());
      assertEquals(isOffline(), false);
    },
  );
});

Deno.test("network - the device's own state follows its online / offline events", () => {
  assertEquals(deviceOnline(), true);
  const seen: boolean[] = [];
  const stop = onDeviceOnlineChange((online) => seen.push(online));
  globalThis.dispatchEvent(new Event("offline"));
  assertEquals(deviceOnline(), false);
  globalThis.dispatchEvent(new Event("offline"));
  globalThis.dispatchEvent(new Event("online"));
  assertEquals(deviceOnline(), true);
  stop();
  globalThis.dispatchEvent(new Event("offline"));
  globalThis.dispatchEvent(new Event("online"));
  // The current value first, then the two changes; nothing after stop()
  assertEquals(seen, [true, false, true]);
  // It never decides whether Emo answers
  assertEquals(isOffline(), false);
});
