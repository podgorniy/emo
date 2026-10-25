// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals } from "@std/assert";
import { loadConfig, validateEnv } from "./config.ts";
import { generateVapidKeyPairB64 } from "./services/push.ts";

const VAPID = await generateVapidKeyPairB64();

const GOOD = {
  SERVER_SECRET: "a3f1".repeat(16),
  BASE_URL: "https://emo.example.org",
  SMTP_HOST: "smtp.example.org",
  SMTP_FROM: "Emo <emo@example.org>",
  SOURCE_URL: "https://git.example.org/emo/tree/v0.1.0",
  VAPID_PUBLIC_KEY: VAPID.publicKey,
  VAPID_PRIVATE_KEY: VAPID.privateKey,
};

Deno.test("config - a complete production .env passes", () => {
  assertEquals(validateEnv(GOOD), []);
});

Deno.test("config - every missing variable is listed at once", () => {
  const problems = validateEnv({});
  for (
    const name of [
      "SERVER_SECRET",
      "BASE_URL",
      "SMTP_HOST",
      "SMTP_FROM",
      "VAPID_PUBLIC_KEY",
    ]
  ) {
    assert(problems.some((p) => p.startsWith(name)), `${name} not reported`);
  }
});

Deno.test("config - SERVER_SECRET must be 256-bit hex and not the published value", () => {
  const bad = (secret: string) =>
    validateEnv({ ...GOOD, SERVER_SECRET: secret }).length > 0;
  assertEquals(bad("short"), true);
  assertEquals(bad("z".repeat(64)), true);
  assertEquals(
    bad("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
    true,
  );
  assertEquals(bad("A3F1".repeat(16)), false);
});

Deno.test("config - SOURCE_URL is optional: unset, it is this server's own archive", () => {
  const { SOURCE_URL: _, ...withoutSource } = GOOD;
  assertEquals(validateEnv(withoutSource), []);
  assertEquals(
    loadConfig({ ...withoutSource, BASE_URL: "https://emo.example.org" })
      .sourceUrl,
    "https://emo.example.org/source.tar.gz",
  );
  assertEquals(loadConfig(GOOD).sourceUrl, GOOD.SOURCE_URL);
  assert(
    validateEnv({ ...GOOD, SOURCE_URL: "ftp://x" }).some((p) =>
      p.startsWith("SOURCE_URL")
    ),
  );
});

Deno.test("config - DEV_MODE relaxes mail, never the secret", () => {
  assertEquals(
    validateEnv({ DEV_MODE: "true", SERVER_SECRET: GOOD.SERVER_SECRET }),
    [],
  );
  assertEquals(validateEnv({ DEV_MODE: "true" }).length, 1);
});

Deno.test("config - malformed values are reported", () => {
  const problems = validateEnv({
    ...GOOD,
    BASE_URL: "emo.example.org",
    PORT: "eighty",
    DEFAULT_LOCALE: "ua",
  });
  assertEquals(problems.length, 3);
});

Deno.test("config - VAPID keys are required outside DEV_MODE, together and well-formed", () => {
  const problems = (env: Record<string, string>) =>
    validateEnv({ ...GOOD, ...env });
  assertEquals(
    problems({ VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" }).length,
    1,
  );
  assertEquals(
    validateEnv({
      DEV_MODE: "true",
      SERVER_SECRET: GOOD.SERVER_SECRET,
      VAPID_PUBLIC_KEY: "",
      VAPID_PRIVATE_KEY: "",
    }),
    [],
  );
  assertEquals(problems({ VAPID_PRIVATE_KEY: "" }).length, 1);
  assertEquals(
    validateEnv({
      DEV_MODE: "true",
      SERVER_SECRET: GOOD.SERVER_SECRET,
      VAPID_PUBLIC_KEY: VAPID.publicKey,
    })
      .length,
    1,
  );
  // Swapped keys, a compressed point, and non-base64url text are all refused
  assertEquals(
    problems({
      VAPID_PUBLIC_KEY: VAPID.privateKey,
      VAPID_PRIVATE_KEY: VAPID.publicKey,
    }).length,
    2,
  );
  assertEquals(problems({ VAPID_PUBLIC_KEY: "A".repeat(87) }).length, 1);
  assertEquals(problems({ VAPID_PRIVATE_KEY: "not base64url!" }).length, 1);
});

Deno.test("config - SMTP port and TLS mode must agree", () => {
  const problems = (env: Record<string, string>) =>
    validateEnv({ ...GOOD, ...env });
  assertEquals(problems({ SMTP_PORT: "465", SMTP_SECURE: "true" }), []);
  assertEquals(problems({ SMTP_PORT: "587", SMTP_SECURE: "false" }), []);
  assertEquals(problems({ SMTP_PORT: "2525", SMTP_SECURE: "true" }), []);
  assertEquals(problems({ SMTP_PORT: "465" }).length, 1);
  assertEquals(problems({ SMTP_PORT: "587", SMTP_SECURE: "true" }).length, 1);
  assertEquals(problems({ SMTP_PORT: "", SMTP_SECURE: "true" }).length, 1);
  assertEquals(problems({ SMTP_SECURE: "true" }).length, 1);
});

Deno.test("config - an empty SMTP_PORT means the default 587", () => {
  assertEquals(loadConfig({ SMTP_PORT: "" }).smtpPort, 587);
});

Deno.test("config - loadConfig never invents a secret; the source is this server's", () => {
  const config = loadConfig({});
  assertEquals(config.serverSecret, "");
  assertEquals(config.sourceUrl, "http://localhost:8080/source.tar.gz");
});

Deno.test("config - REGISTRATION: open unless invite; anything else is refused", () => {
  assertEquals(loadConfig({}).registration, "open");
  assertEquals(loadConfig({ REGISTRATION: "invite" }).registration, "invite");
  assertEquals(validateEnv({ ...GOOD, REGISTRATION: "open" }), []);
  assertEquals(validateEnv({ ...GOOD, REGISTRATION: "invite" }), []);
  assertEquals(validateEnv({ ...GOOD, REGISTRATION: "closed" }), [
    "REGISTRATION must be open or invite",
  ]);
});
