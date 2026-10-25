// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Server configuration loaded from environment variables.
 * Specification: ops.md §2.4, §2.
 */

import { SERVER_VERSION } from "./version.ts";
import { decodeBase64Url } from "../shared/crypto/encoding.ts";
import { trustedProxiesProblems } from "./client_ip.ts";

export interface Config {
  version: string;
  baseUrl: string;
  port: number;
  dataDir: string;
  serverSecret: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  /** Empty = mail unconfigured (`/healthz` reports it; sign-in cannot work). */
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom: string;
  /**
   * `REGISTRATION`: `open` (default) lets anyone with an email create an
   * account, an invite optional; `invite` only with an invite code.
   */
  registration: "open" | "invite";
  invitesByUsers: boolean;
  /** `TRUSTED_PROXIES`: whose `X-Forwarded-For` counts (server/client_ip.ts). */
  trustedProxies: string;
  invitesPerUser: number;
  recoveryMailEnabled: boolean;
  defaultLocale: "en" | "ru" | "uk";
  logLevel: string;
  /**
   * `DEV_MODE=true` (`make dev`): CSP without `upgrade-insecure-requests` (dev
   * is plain http), mail printed to stderr, temporary VAPID keys.
   */
  devMode: boolean;
  /** `DEV_MAIL=smtp`: under DEV_MODE, send mail through SMTP after all. */
  devMailSmtp: boolean;
  smokeEmail: string;
  sourceUrl: string;
  crisisUrl: string;
  privacyNoticeUrl: string | null;
  operatorContact: string | null;
}

/** `/source.tar.gz` on this server (absolute when BASE_URL is a valid URL). */
function ownSourceUrl(baseUrl: string): string {
  try {
    return new URL("/source.tar.gz", baseUrl).href;
  } catch {
    return "/source.tar.gz";
  }
}

export function loadConfig(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): Config {
  const baseUrl = env.BASE_URL ?? "http://localhost:8080";
  const port = parseInt(env.PORT ?? "8080", 10);
  const dataDir = env.DATA_DIR ?? "./data";

  // Never a default secret: `validateEnv` refuses to serve without a real one.
  const serverSecret = env.SERVER_SECRET ?? "";

  return {
    version: SERVER_VERSION,
    baseUrl,
    port,
    dataDir,
    serverSecret,
    vapidPublicKey: env.VAPID_PUBLIC_KEY ?? "",
    vapidPrivateKey: env.VAPID_PRIVATE_KEY ?? "",
    vapidSubject: env.VAPID_SUBJECT ?? "mailto:admin@example.com",
    smtpHost: env.SMTP_HOST ?? "",
    smtpPort: parseInt(env.SMTP_PORT || "587", 10),
    smtpSecure: env.SMTP_SECURE === "true",
    smtpUser: env.SMTP_USER,
    smtpPass: env.SMTP_PASS,
    smtpFrom: env.SMTP_FROM ?? "Emo <noreply@example.com>",
    registration: env.REGISTRATION === "invite" ? "invite" : "open",
    invitesByUsers: env.INVITES_BY_USERS !== "false",
    trustedProxies: env.TRUSTED_PROXIES ?? "private",
    invitesPerUser: parseInt(env.INVITES_PER_USER ?? "5", 10),
    recoveryMailEnabled: env.RECOVERY_MAIL_ENABLED !== "false",
    defaultLocale: (env.DEFAULT_LOCALE === "ru" || env.DEFAULT_LOCALE === "uk")
      ? env.DEFAULT_LOCALE
      : "en",
    logLevel: env.LOG_LEVEL ?? "info",
    devMode: env.DEV_MODE === "true",
    devMailSmtp: env.DEV_MAIL === "smtp",
    smokeEmail: env.SMOKE_EMAIL ?? "smoke@example.com",
    // Unset: this build's own source archive (server/dist.ts, AGPL §13)
    sourceUrl: env.SOURCE_URL || ownSourceUrl(baseUrl),
    crisisUrl: env.CRISIS_URL ?? "https://findahelpline.com",
    privacyNoticeUrl: env.PRIVACY_NOTICE_URL || null,
    operatorContact: env.OPERATOR_CONTACT || null,
  };
}

/**
 * The value this file shipped as a fallback until 2026-10-08. It is public, so
 * it is refused even when set explicitly.
 */
const PUBLISHED_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** Byte length of a base64url value, or -1 when it is not base64url. */
function base64UrlLength(value: string): number {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return -1;
  try {
    return decodeBase64Url(value).length;
  } catch {
    return -1;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Boot validation for `emo serve` (reliability.md §1.5, ops.md §2.4): returns
 * every problem so the operator can fix them in one go; empty = ok.
 * `DEV_MODE=true` relaxes what local development can live without (mail is
 * printed to stderr, temporary VAPID keys); `SERVER_SECRET`
 * is required always.
 */
export function validateEnv(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): string[] {
  const problems: string[] = [];
  const dev = env.DEV_MODE === "true";
  const secret = env.SERVER_SECRET ?? "";

  if (!secret) {
    problems.push("SERVER_SECRET is missing (run `make init`)");
  } else if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    problems.push(
      "SERVER_SECRET must be 64 hex characters (256 bits, `openssl rand -hex 32`)",
    );
  } else if (secret.toLowerCase() === PUBLISHED_SECRET) {
    problems.push(
      "SERVER_SECRET is a published example value; generate your own",
    );
  }

  if (!dev) {
    if (!env.BASE_URL) problems.push("BASE_URL is missing");
    else if (!isHttpUrl(env.BASE_URL)) {
      problems.push("BASE_URL must be an http(s) URL");
    }
    if (!env.SMTP_HOST) {
      problems.push("SMTP_HOST is missing (without mail nobody can sign in)");
    }
    if (!env.SMTP_FROM) problems.push("SMTP_FROM is missing");
  }
  // Optional: unset, the server links its own source archive (main.ts checks
  // the build has one)
  if (env.SOURCE_URL && !isHttpUrl(env.SOURCE_URL)) {
    problems.push("SOURCE_URL must be an http(s) URL");
  }

  // Generated keys would change at every restart and end every push subscription.
  const vapidPublic = env.VAPID_PUBLIC_KEY ?? "";
  const vapidPrivate = env.VAPID_PRIVATE_KEY ?? "";
  if (!vapidPublic && !vapidPrivate) {
    if (!dev) {
      problems.push(
        "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are missing (run `make vapid-keys`)",
      );
    }
  } else if (!vapidPublic || !vapidPrivate) {
    problems.push(
      "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together",
    );
  } else {
    const raw = base64UrlLength(vapidPublic) === 65 &&
      decodeBase64Url(vapidPublic)[0] === 0x04;
    if (!raw) {
      problems.push(
        "VAPID_PUBLIC_KEY must be a base64url uncompressed P-256 point (65 bytes)",
      );
    }
    if (base64UrlLength(vapidPrivate) !== 32) {
      problems.push(
        "VAPID_PRIVATE_KEY must be a base64url P-256 key (32 bytes)",
      );
    }
  }

  const port = env.PORT;
  if (port !== undefined && !/^\d+$/.test(port)) {
    problems.push("PORT must be a number");
  }
  const smtpPort = env.SMTP_PORT;
  if (smtpPort !== undefined && smtpPort !== "" && !/^\d+$/.test(smtpPort)) {
    problems.push("SMTP_PORT must be a number");
  }
  const smtpSecure = env.SMTP_SECURE === "true";
  if (smtpPort === "465" && !smtpSecure) {
    problems.push("SMTP_PORT 465 is implicit TLS; set SMTP_SECURE=true");
  } else if ((smtpPort || "587") === "587" && smtpSecure) {
    problems.push("SMTP_PORT 587 is STARTTLS; set SMTP_SECURE=false");
  }
  if (
    env.REGISTRATION !== undefined &&
    !["open", "invite"].includes(env.REGISTRATION)
  ) {
    problems.push("REGISTRATION must be open or invite");
  }
  if (
    env.DEFAULT_LOCALE !== undefined &&
    !["en", "ru", "uk"].includes(env.DEFAULT_LOCALE)
  ) {
    problems.push("DEFAULT_LOCALE must be en, ru or uk");
  }
  problems.push(...trustedProxiesProblems(env.TRUSTED_PROXIES ?? ""));
  return problems;
}
