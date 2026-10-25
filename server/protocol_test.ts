// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * api.md §4: every response the server sends matches the schema in
 * `shared/protocol.ts` that the client checks it with, so a server change
 * that drifts from the contract fails here, not on a phone.
 */
import { assertEquals } from "@std/assert";
import { hashInviteCode } from "./crypto.ts";
import { startTestServer, TEST_ORIGIN } from "./testing/harness.ts";
import { encodeBase64Url } from "../shared/crypto/encoding.ts";
import type { Schema } from "../shared/schema.ts";
import {
  ApiErrorSchema,
  AuthRequestCodeResSchema,
  AuthVerifyResSchema,
  EntriesPullResSchema,
  EntryDeleteResSchema,
  EntryPutResSchema,
  HealthResSchema,
  InstanceResSchema,
  InviteCreateResSchema,
  InvitesListResSchema,
  KeyringGetResSchema,
  KeyringPutResSchema,
  PrefsGetResSchema,
  PrefsPutResSchema,
  PushSubscribeResSchema,
  PushSubscriptionsResSchema,
  RemindersPullResSchema,
  SessionResSchema,
  SessionsListResSchema,
  SettingsGetResSchema,
  VapidResSchema,
} from "../shared/protocol.ts";

const b64 = (n: number) =>
  encodeBase64Url(crypto.getRandomValues(new Uint8Array(n)));

Deno.test("protocol - every response matches its shared schema", async () => {
  const server = startTestServer();
  const restore = server.installFetch();
  const checked: string[] = [];
  /** Calls the API and checks the body against `schema`. */
  const call = async (
    schema: Schema<unknown>,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(`${TEST_ORIGIN}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    assertEquals(
      schema.check(json),
      null,
      `${method} ${path} → ${res.status} ${JSON.stringify(json)}`,
    );
    checked.push(`${method} ${path}`);
    return json;
  };

  try {
    await call(InstanceResSchema, "GET", "/api/instance");
    await call(HealthResSchema, "GET", "/healthz");

    // Sign-up
    server.db.prepare(`
      INSERT INTO invites (code_hash, code_enc, created_by, created_at, expires_at, max_uses, uses)
      VALUES (?, NULL, NULL, ?, ?, 1, 0)
    `).run(
      await hashInviteCode("PROTOCOL0001"),
      new Date().toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
    );
    const email = "protocol@example.org";
    await call(AuthRequestCodeResSchema, "POST", "/api/auth/request-code", {
      email,
      invite_code: "PROTOCOL0001",
      locale: "en",
    });
    for (let i = 0; i < 50 && !server.mail.length; i++) {
      await new Promise((r) => setTimeout(r, 2));
    }
    const code = server.mail.at(-1)!.text.match(/\b\d{6}\b/)![0];
    await call(AuthVerifyResSchema, "POST", "/api/auth/verify", {
      email,
      code,
      tz: "Europe/Kyiv",
      locale: "en",
    });
    await call(SessionResSchema, "GET", "/api/session");

    // Keyring, entries, prefs
    const proof = b64(32);
    await call(KeyringPutResSchema, "PUT", "/api/keyring/1", {
      key_version: 1,
      kdf: { alg: "argon2id", m_kib: 65536, t: 3, p: 1, salt_b64: b64(16) },
      dek_wrapped_pass: { nonce_b64: b64(12), ct_b64: b64(48) },
      dek_wrapped_recovery: { nonce_b64: b64(12), ct_b64: b64(48) },
    }, { "X-Emo-Auth": proof });
    await call(KeyringGetResSchema, "GET", "/api/keyring");
    const entryId = crypto.randomUUID();
    const blob = { key_version: 1, nonce_b64: b64(12), ct_b64: b64(2064) };
    await call(EntryPutResSchema, "PUT", `/api/entries/${entryId}`, blob);
    await call(EntriesPullResSchema, "GET", "/api/entries?since=0");
    await call(
      EntryDeleteResSchema,
      "DELETE",
      `/api/entries/${entryId}`,
      undefined,
      { "X-Emo-Auth": proof },
    );
    await call(PrefsPutResSchema, "PUT", "/api/prefs", {
      key_version: 1,
      nonce_b64: b64(12),
      ct_b64: b64(200),
    });
    await call(PrefsGetResSchema, "GET", "/api/prefs");

    // Settings, reminders, invites, sessions, push
    const settings = await call(SettingsGetResSchema, "GET", "/api/settings");
    await call(SettingsGetResSchema, "PUT", "/api/settings", {
      tz: settings.tz,
      locale: settings.locale,
      wake_start: "08:00",
      wake_end: "22:00",
      reminders_per_day: 3,
      min_gap_min: 120,
    });
    await call(RemindersPullResSchema, "GET", "/api/reminders");
    await call(InviteCreateResSchema, "POST", "/api/invites", {});
    await call(InvitesListResSchema, "GET", "/api/invites");
    await call(SessionsListResSchema, "GET", "/api/sessions");
    await call(VapidResSchema, "GET", "/api/push/vapid");
    const { publicKey } = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    await call(PushSubscribeResSchema, "POST", "/api/push/subscriptions", {
      endpoint: "https://fcm.googleapis.com/fcm/send/protocol",
      keys: {
        p256dh: encodeBase64Url(
          new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)),
        ),
        auth: b64(16),
      },
      expiration_time: null,
    });
    await call(PushSubscriptionsResSchema, "GET", "/api/push/subscriptions");

    // The error envelope, from a route and from the body check
    await call(ApiErrorSchema, "GET", "/api/nowhere");
    const bad = await call(ApiErrorSchema, "PUT", "/api/settings", {
      tz: "Europe/Kyiv",
    });
    assertEquals(bad.error.code, "invalid_field");
    assertEquals(bad.error.message, 'body.locale: expected "ru" | "uk" | "en"');
  } finally {
    restore();
  }
  assertEquals(checked.length, 23);
});
