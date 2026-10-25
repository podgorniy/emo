// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Preferences router: get and put E2E-encrypted user preferences blob.
 * Specification: architecture.md §5.5, api.md §2.7.
 */

import { Hono } from "@hono/hono";
import { readJson } from "../http.ts";
import type { DatabaseSync } from "node:sqlite";
import {
  type AppEnv,
  type AuthAccount,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import {
  decodeBase64Url,
  encodeBase64Url,
} from "../../shared/crypto/encoding.ts";
import {
  type PrefsGetRes,
  PrefsPutReqSchema,
  type PrefsPutRes,
} from "../../shared/protocol.ts";
import type { ApiError } from "../../shared/protocol.ts";

export function createPrefsRoutes(db: DatabaseSync) {
  const router = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(db);

  router.use("*", authMiddleware);

  // GET /api/prefs
  router.get("/", (c) => {
    const account = c.get("account") as AuthAccount;

    const row = db.prepare(`
      SELECT key_version, nonce, ciphertext, updated_at
      FROM prefs
      WHERE account_id = ?
    `).get(account.id) as {
      key_version: number;
      nonce: Uint8Array;
      ciphertext: Uint8Array;
      updated_at: string;
    } | undefined;

    if (!row) {
      return c.json(
        {
          error: { code: "not_found", message: "Prefs not found" },
        } satisfies ApiError,
        404,
      );
    }

    const res: PrefsGetRes = {
      key_version: row.key_version,
      nonce_b64: encodeBase64Url(row.nonce),
      ct_b64: encodeBase64Url(row.ciphertext),
      updated_at: row.updated_at,
    };

    return c.json(res, 200);
  });

  // PUT /api/prefs
  router.put("/", async (c) => {
    const body = await readJson(c, PrefsPutReqSchema);
    if (body instanceof Response) return body;

    if (
      typeof body.key_version !== "number" || !body.nonce_b64 || !body.ct_b64
    ) {
      return c.json(
        {
          error: { code: "invalid_field", message: "Missing required fields" },
        } satisfies ApiError,
        400,
      );
    }

    let nonceBytes: Uint8Array;
    let ctBytes: Uint8Array;
    try {
      nonceBytes = decodeBase64Url(body.nonce_b64);
      ctBytes = decodeBase64Url(body.ct_b64);
    } catch {
      return c.json(
        {
          error: { code: "invalid_field", message: "Invalid base64url data" },
        } satisfies ApiError,
        400,
      );
    }

    if (ctBytes.byteLength > 32 * 1024) {
      return c.json(
        {
          error: {
            code: "payload_too_large",
            message: "Ciphertext exceeds 32 KiB limit",
          },
        } satisfies ApiError,
        413,
      );
    }

    const account = c.get("account") as AuthAccount;

    const keyring = db.prepare(`
      SELECT key_version FROM keyrings
      WHERE account_id = ? AND key_version = ?
    `).get(account.id, body.key_version);

    if (!keyring) {
      return c.json(
        {
          error: {
            code: "key_version_unknown",
            message:
              `Key version ${body.key_version} is not known for this account`,
          },
        } satisfies ApiError,
        422,
      );
    }

    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO prefs (account_id, key_version, nonce, ciphertext, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(account.id, body.key_version, nonceBytes, ctBytes, nowIso);

    const res: PrefsPutRes = { updated_at: nowIso };
    return c.json(res, 200);
  });

  return router;
}
