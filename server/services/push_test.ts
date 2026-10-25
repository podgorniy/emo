// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals, assertThrows } from "@std/assert";
import { importVapidKeys } from "@negrel/webpush";
import type { Config } from "../config.ts";
import { setLogSink } from "../log.ts";
import {
  generateVapidKeyPairB64,
  PUSH_TTL_SEC,
  PushService,
  vapidKeysToJwk,
} from "./push.ts";
import { encodeBase64Url } from "../../shared/crypto/encoding.ts";

const configWith = (vapidPublicKey: string, vapidPrivateKey: string) =>
  ({
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject: "mailto:admin@example.org",
  }) as Config;

Deno.test("push - the server announces the configured VAPID key, across restarts", async () => {
  const keys = await generateVapidKeyPairB64();
  for (let i = 0; i < 2; i++) {
    const push = new PushService(configWith(keys.publicKey, keys.privateKey));
    assertEquals(await push.getPublicKeyB64(), keys.publicKey);
  }
});

Deno.test("push - a generated pair imports as matching signing and verifying keys", async () => {
  const keys = await generateVapidKeyPairB64();
  const pair = await importVapidKeys(
    vapidKeysToJwk(keys.publicKey, keys.privateKey),
  );
  const algo = { name: "ECDSA", hash: "SHA-256" };
  const data = new TextEncoder().encode("emo");
  const sig = await crypto.subtle.sign(algo, pair.privateKey, data);
  assertEquals(
    await crypto.subtle.verify(algo, pair.publicKey, sig, data),
    true,
  );
});

Deno.test("push - a malformed public key is refused", async () => {
  const keys = await generateVapidKeyPairB64();
  assertThrows(() => vapidKeysToJwk(keys.privateKey, keys.privateKey));
});

Deno.test("push - without keys (DEV_MODE) a temporary pair is used", async () => {
  const lines: string[] = [];
  const restore = setLogSink((l) => lines.push(l));
  try {
    const push = new PushService(configWith("", ""));
    assertEquals((await push.getPublicKeyB64()).length, 87);
    assertEquals(
      lines.filter((l) => l.includes("vapid_keys_temporary")).length,
      1,
    );
  } finally {
    restore();
  }
});

Deno.test("push - one message: TTL 30 min, Urgency high, Topic emo; gone vs retry", async () => {
  const keys = await generateVapidKeyPairB64();
  const push = new PushService(configWith(keys.publicKey, keys.privateKey));
  const { publicKey } = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const sub = {
    endpoint: "https://push.example.org/send/abc",
    p256dh: encodeBase64Url(
      new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)),
    ),
    auth: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };

  const original = globalThis.fetch;
  const seen: Request[] = [];
  let status = 201;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return Promise.resolve(new Response(null, { status }));
  }) as typeof fetch;
  try {
    const payload = {
      title: "Emo",
      url: "/now?reminder=r1",
      tag: "emo",
      renotify: true,
    } as const;
    assertEquals((await push.sendNotification(sub, payload)).ok, true);
    const req = seen[0];
    assertEquals(req.url, sub.endpoint);
    assertEquals(req.method, "POST");
    assertEquals(req.headers.get("TTL"), String(PUSH_TTL_SEC));
    assertEquals(PUSH_TTL_SEC, 1800);
    assertEquals(req.headers.get("Urgency"), "high");
    assertEquals(req.headers.get("Topic"), "emo");
    assertEquals(req.headers.get("Content-Encoding"), "aes128gcm");
    assertEquals(req.headers.get("Authorization")?.startsWith("vapid "), true);

    for (
      const [code, remove] of [[404, true], [410, true], [429, false], [
        500,
        false,
      ]] as const
    ) {
      status = code;
      const res = await push.sendNotification(sub, payload);
      assertEquals([res.ok, res.shouldRemove, res.isTransientFailure], [
        false,
        remove,
        !remove,
      ], String(code));
    }
  } finally {
    globalThis.fetch = original;
  }
});
