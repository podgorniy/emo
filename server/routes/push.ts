// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Push router: VAPID public key and device push subscriptions.
 * Specification: architecture.md §9.2, api.md §2.9.
 */

import { Hono } from "@hono/hono";
import { readJson } from "../http.ts";
import type { DatabaseSync } from "node:sqlite";
import { generateUuidV4 } from "../crypto.ts";
import { isIpAddress } from "../client_ip.ts";
import { decodeBase64Url } from "../../shared/crypto/encoding.ts";
import {
  type AppEnv,
  type AuthAccount,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import type { PushService } from "../services/push.ts";
import {
  type PushSubscribeReq,
  PushSubscribeReqSchema,
  type PushSubscribeRes,
  type PushSubscriptionsRes,
  type VapidRes,
} from "../../shared/protocol.ts";
import type { ApiError } from "../../shared/protocol.ts";

/**
 * Why a subscription is refused, or null (api.md §1.4, §2.9). The
 * server POSTs to `endpoint` later, so only what a push service looks like
 * gets in: `https:` on the default port, no credentials, and a public DNS
 * name. IP literals, `localhost` and local-only names are refused, which
 * keeps the scheduler from reaching internal services (SSRF). A public name
 * that resolves to a private address is not caught here; the request body is
 * encrypted and the response is never read back, so that is blind at most.
 */
export function pushSubscriptionProblem(body: unknown): string | null {
  const b = body as Partial<PushSubscribeReq> | null;
  if (typeof b?.endpoint !== "string") return "endpoint is missing";
  if (b.endpoint.length > 2048) return "Push endpoint URL exceeds 2 KiB";
  let url: URL;
  try {
    url = new URL(b.endpoint);
  } catch {
    return "endpoint is not a URL";
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:") return "endpoint must be https";
  if (url.port !== "" || url.username || url.password) {
    return "endpoint must use the default port and no credentials";
  }
  if (
    isIpAddress(host) || !host.includes(".") || host === "localhost" ||
    /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)
  ) {
    return "endpoint must be a public host name";
  }

  // PushSubscription.toJSON(): an uncompressed P-256 point and 16 bytes
  const bytes = (v: unknown) => {
    try {
      return typeof v === "string"
        ? decodeBase64Url(v.replace(/=+$/, ""))
        : null;
    } catch {
      return null;
    }
  };
  const p256dh = bytes(b.keys?.p256dh);
  if (p256dh?.length !== 65 || p256dh[0] !== 0x04) {
    return "keys.p256dh must be an uncompressed P-256 point";
  }
  if (bytes(b.keys?.auth)?.length !== 16) return "keys.auth must be 16 bytes";
  if (b.replaces !== undefined && b.replaces !== null) {
    if (typeof b.replaces !== "string" || b.replaces.length > 2048) {
      return "replaces must be an endpoint URL";
    }
  }
  return null;
}

export function createPushRoutes(db: DatabaseSync, pushService: PushService) {
  const router = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(db);

  // GET /api/push/vapid (no auth)
  router.get("/vapid", async (c) => {
    const pubKey = await pushService.getPublicKeyB64();
    const res: VapidRes = { public_key_b64: pubKey };
    return c.json(res, 200);
  });

  // GET /api/push/subscriptions (auth)
  router.get("/subscriptions", authMiddleware, (c) => {
    const account = c.get("account") as AuthAccount;

    const rows = db.prepare(`
      SELECT id, endpoint, created_at
      FROM push_subscriptions
      WHERE account_id = ?
      ORDER BY created_at DESC
    `).all(account.id) as Array<
      { id: string; endpoint: string; created_at: string }
    >;

    const res: PushSubscriptionsRes = { items: rows };
    return c.json(res, 200);
  });

  // POST /api/push/subscriptions (auth)
  router.post("/subscriptions", authMiddleware, async (c) => {
    const body = await readJson(c, PushSubscribeReqSchema);
    if (body instanceof Response) return body;

    const problem = pushSubscriptionProblem(body);
    if (problem) {
      return c.json(
        {
          error: { code: "invalid_field", message: problem },
        } satisfies ApiError,
        400,
      );
    }

    const account = c.get("account") as AuthAccount;
    const userAgent = (c.req.header("user-agent") || "").slice(0, 256);
    const nowIso = new Date().toISOString();

    if (typeof body.replaces === "string") {
      db.prepare(
        "DELETE FROM push_subscriptions WHERE account_id = ? AND endpoint = ?",
      ).run(
        account.id,
        body.replaces,
      );
    }

    const existing = db.prepare(
      "SELECT id, account_id FROM push_subscriptions WHERE endpoint = ?",
    ).get(
      body.endpoint,
    ) as { id: string; account_id: string } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE push_subscriptions
        SET account_id = ?, p256dh = ?, auth = ?, user_agent = ?, failed_count = 0
        WHERE id = ?
      `).run(
        account.id,
        body.keys.p256dh,
        body.keys.auth,
        userAgent,
        existing.id,
      );

      const res: PushSubscribeRes = { id: existing.id };
      return c.json(res, 200);
    }

    const subId = generateUuidV4();
    db.prepare(`
      INSERT INTO push_subscriptions (id, account_id, endpoint, p256dh, auth, user_agent, created_at, failed_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      subId,
      account.id,
      body.endpoint,
      body.keys.p256dh,
      body.keys.auth,
      userAgent,
      nowIso,
    );

    const countRow = db.prepare(
      "SELECT COUNT(*) as count FROM push_subscriptions WHERE account_id = ?",
    ).get(
      account.id,
    ) as { count: number };

    if (countRow.count > 10) {
      const oldest = db.prepare(`
        SELECT id FROM push_subscriptions
        WHERE account_id = ?
        ORDER BY created_at ASC
        LIMIT 1
      `).get(account.id) as { id: string } | undefined;

      if (oldest) {
        db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(
          oldest.id,
        );
      }
    }

    const res: PushSubscribeRes = { id: subId };
    return c.json(res, 201);
  });

  // DELETE /api/push/subscriptions/:id (auth)
  router.delete("/subscriptions/:id", authMiddleware, (c) => {
    const account = c.get("account") as AuthAccount;
    const subId = c.req.param("id") ?? "";

    const target = db.prepare(
      "SELECT id FROM push_subscriptions WHERE id = ? AND account_id = ?",
    ).get(
      subId,
      account.id,
    );

    if (!target) {
      return c.json(
        {
          error: { code: "not_found", message: "Push subscription not found" },
        } satisfies ApiError,
        404,
      );
    }

    db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(subId);
    return c.body(null, 204);
  });

  return router;
}
