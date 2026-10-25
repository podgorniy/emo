// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `POST /api/push/subscriptions` (api.md §1.4, §2.9): only what
 * looks like a push service is stored, so the scheduler never POSTs to
 * internal addresses.
 */
import { assertEquals } from "@std/assert";
import { encodeBase64Url } from "../../shared/crypto/encoding.ts";
import { startTestServer, TEST_ORIGIN } from "../testing/harness.ts";
import { pushSubscriptionProblem } from "./push.ts";

const { publicKey } = await crypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" },
  true,
  ["deriveBits"],
);
const keys = {
  p256dh: encodeBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)),
  ),
  auth: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
};
const sub = (endpoint: string, over: Record<string, unknown> = {}) => ({
  endpoint,
  keys,
  expiration_time: null,
  ...over,
});

Deno.test("push - real push services are accepted", () => {
  for (
    const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGuQyavXutnMH2",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]
  ) {
    assertEquals(pushSubscriptionProblem(sub(endpoint)), null, endpoint);
  }
});

Deno.test("push - internal, plain-http and odd endpoints are refused", () => {
  for (
    const endpoint of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://127.0.0.1/x",
      "https://2130706433/x", // 127.0.0.1 in disguise
      "https://10.0.0.5/x",
      "https://[::1]/x",
      "https://[fd00::1]/x",
      "https://localhost/x",
      "https://emo.localhost/x",
      "https://metadata.google.internal/computeMetadata",
      "https://printer.local/x",
      "https://intranet/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pass@fcm.googleapis.com/x",
      "file:///etc/passwd",
      "not a url",
      `https://fcm.googleapis.com/${"x".repeat(2048)}`,
    ]
  ) {
    assertEquals(
      typeof pushSubscriptionProblem(sub(endpoint)),
      "string",
      endpoint,
    );
  }
});

Deno.test("push - keys must be a P-256 point and a 16-byte secret", () => {
  const ok = "https://fcm.googleapis.com/fcm/send/x";
  const short = encodeBase64Url(new Uint8Array(33));
  for (
    const bad of [
      { keys: { ...keys, p256dh: short } },
      { keys: { ...keys, auth: encodeBase64Url(new Uint8Array(8)) } },
      { keys: { ...keys, auth: "***" } },
      { keys: undefined },
      { replaces: 42 },
    ]
  ) {
    assertEquals(
      typeof pushSubscriptionProblem(sub(ok, bad)),
      "string",
      JSON.stringify(bad),
    );
  }
  // Padding, as some browsers send it, is fine
  assertEquals(
    pushSubscriptionProblem(
      sub(ok, { keys: { ...keys, auth: keys.auth + "==" } }),
    ),
    null,
  );
});

Deno.test("push - a refused subscription is not stored", async () => {
  const server = startTestServer();
  const restore = server.installFetch();
  try {
    await server.signUp("push@example.org");
    const post = (body: unknown) =>
      fetch(`${TEST_ORIGIN}/api/push/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assertEquals(
      (await post(sub("https://169.254.169.254/latest"))).status,
      400,
    );
    const count = () =>
      (server.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions")
        .get() as { n: number }).n;
    assertEquals(count(), 0);
    assertEquals(
      (await post(sub("https://fcm.googleapis.com/fcm/send/x"))).status,
      201,
    );
    assertEquals(count(), 1);
  } finally {
    restore();
  }
});

Deno.test("push - a rotated subscription replaces this device's old row", async () => {
  const server = startTestServer();
  const restore = server.installFetch();
  try {
    await server.signUp("rotate@example.org");
    const post = (body: unknown) =>
      fetch(`${TEST_ORIGIN}/api/push/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const oldEndpoint = "https://fcm.googleapis.com/fcm/send/old";
    const newEndpoint = "https://fcm.googleapis.com/fcm/send/new";
    assertEquals((await post(sub(oldEndpoint))).status, 201);
    assertEquals(
      (await post(sub(newEndpoint, { replaces: oldEndpoint }))).status,
      201,
    );
    const endpoints = server.db.prepare(
      "SELECT endpoint FROM push_subscriptions",
    ).all().map((r) => (r as { endpoint: string }).endpoint);
    assertEquals(endpoints, [newEndpoint]);
  } finally {
    restore();
  }
});
