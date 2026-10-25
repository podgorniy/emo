// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Web Push service using @negrel/webpush.
 * Specification: architecture.md §9.2, api.md §2.9.
 */

import {
  ApplicationServer,
  type ExportedVapidKeys,
  generateVapidKeys,
  importVapidKeys,
  PushMessageError,
  Urgency,
} from "@negrel/webpush";
import type { Config } from "../config.ts";
import { logger } from "../log.ts";
import {
  decodeBase64Url,
  encodeBase64Url,
} from "../../shared/crypto/encoding.ts";

/**
 * A new VAPID key pair in the usual web-push `.env` form: base64url of the
 * 65-byte uncompressed P-256 point and of the 32-byte private scalar `d`.
 * Printed by `emo vapid-keys` (`make init`, `make vapid-keys`).
 */
export async function generateVapidKeyPairB64(): Promise<
  { publicKey: string; privateKey: string }
> {
  const keys = await generateVapidKeys({ extractable: true });
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keys.publicKey),
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  return { publicKey: encodeBase64Url(raw), privateKey: jwk.d! };
}

/** `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` → the JWKs `importVapidKeys` takes. */
export function vapidKeysToJwk(
  publicKeyB64: string,
  privateKeyB64: string,
): ExportedVapidKeys {
  const raw = decodeBase64Url(publicKeyB64);
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY is not an uncompressed P-256 point");
  }
  const publicKey: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(raw.slice(1, 33)),
    y: encodeBase64Url(raw.slice(33, 65)),
  };
  return { publicKey, privateKey: { ...publicKey, d: privateKeyB64 } };
}

/** The push payload of architecture.md §9.2; the title is the only text. */
export interface PushNotificationPayload {
  title: string;
  url: string;
  tag: "emo";
  renotify: true;
}

/** architecture.md §9.1: an undelivered reminder is replaced, never late. */
export const PUSH_TTL_SEC = 1800;
export const PUSH_TOPIC = "emo";
export const PUSH_SEND_TIMEOUT_MS = 10_000;

export interface PushResult {
  ok: boolean;
  statusCode?: number;
  /** 404/410 (gone), or 401/403 (VAPID keys changed): drop the subscription. */
  shouldRemove: boolean;
  /** 429, 5xx, timeout or network error: retry on the next tick. */
  isTransientFailure: boolean;
  error?: string;
}

const REMOVE_STATUSES = new Set([401, 403, 404, 410]);

export class PushService {
  private config: Config;
  private appServerPromise: Promise<ApplicationServer> | null = null;
  private publicKeyB64: string = "";

  constructor(config: Config) {
    this.config = config;
  }

  private async getAppServer(): Promise<ApplicationServer> {
    if (!this.appServerPromise) {
      this.appServerPromise = (async () => {
        const { vapidPublicKey, vapidPrivateKey } = this.config;
        let vapidKeys: CryptoKeyPair;
        if (vapidPublicKey && vapidPrivateKey) {
          vapidKeys = await importVapidKeys(
            vapidKeysToJwk(vapidPublicKey, vapidPrivateKey),
          );
        } else {
          // Only reachable in DEV_MODE: `validateEnv` requires the keys otherwise.
          logger.warn("vapid_keys_temporary", {
            hint:
              "VAPID keys not set; push subscriptions end at restart (run `make vapid-keys`)",
          });
          vapidKeys = await generateVapidKeys();
        }
        const appServer = await ApplicationServer.new({
          contactInformation: this.config.vapidSubject,
          vapidKeys,
        });
        const rawPublicKey = await appServer.getVapidPublicKeyRaw();
        this.publicKeyB64 = encodeBase64Url(rawPublicKey);
        return appServer;
      })();
    }
    return await this.appServerPromise;
  }

  async getPublicKeyB64(): Promise<string> {
    await this.getAppServer();
    return this.publicKeyB64;
  }

  async sendNotification(
    sub: { endpoint: string; p256dh: string; auth: string },
    payload: PushNotificationPayload,
  ): Promise<PushResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const appServer = await this.getAppServer();
      const subscriber = appServer.subscribe({
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      });

      const send = subscriber.pushTextMessage(JSON.stringify(payload), {
        urgency: Urgency.High,
        ttl: PUSH_TTL_SEC,
        topic: PUSH_TOPIC,
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("push send timed out")),
          PUSH_SEND_TIMEOUT_MS,
        );
      });
      await Promise.race([send, timeout]);

      return { ok: true, shouldRemove: false, isTransientFailure: false };
    } catch (err: unknown) {
      if (err instanceof PushMessageError) {
        const status = err.response.status;
        await err.response.body?.cancel().catch(() => {});
        const remove = REMOVE_STATUSES.has(status);
        return {
          ok: false,
          statusCode: status,
          shouldRemove: remove,
          isTransientFailure: !remove,
          error: err.toString(),
        };
      }

      return {
        ok: false,
        shouldRemove: false,
        isTransientFailure: true,
        error: String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
