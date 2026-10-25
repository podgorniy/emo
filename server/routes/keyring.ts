// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Keyring router: get and put append-only keyring revisions.
 * Specification: architecture.md §5.2, api.md §2.3.
 */

import { Hono } from "@hono/hono";
import type { DatabaseSync } from "node:sqlite";
import { sha256Bytes, verifyAuthProof } from "../crypto.ts";
import {
  type AppEnv,
  type AuthAccount,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import { rateLimiter } from "../services/rate_limit.ts";
import {
  decodeBase64Url,
  encodeBase64Url,
} from "../../shared/crypto/encoding.ts";
import type {
  KeyringGetRes,
  KeyringItem,
  KeyringPutReq,
  KeyringPutRes,
} from "../../shared/protocol.ts";
import { KeyringPutReqSchema } from "../../shared/protocol.ts";
import {
  keyringProblem,
  WRAP_NONCE_BYTES,
  WRAPPED_DEK_BYTES,
} from "../../shared/crypto/keyring.ts";
import { tx } from "../db/index.ts";
import type { ApiError } from "../../shared/protocol.ts";

/** api.md §1.4, §2.3 */
const MAX_KEYRING_BYTES = 4096;
const WRITES_PER_HOUR = 10;

/**
 * The stored form of a PUT body, or why it is refused (`keyringProblem`, the
 * rules the client also checks before its KDF). Only the known `kdf` fields
 * are kept, so nothing unknown is stored or echoed back; a nonce of another
 * length would split wrongly on every later read, so it never gets in.
 */
export function parseKeyringPut(
  body: unknown,
): { kdfJson: string; passBlob: Uint8Array; recBlob: Uint8Array } | string {
  const b = body as KeyringPutReq;
  const problem = keyringProblem(b);
  if (problem) return problem;
  const blob = (w: { nonce_b64: string; ct_b64: string }) => {
    const out = new Uint8Array(WRAP_NONCE_BYTES + WRAPPED_DEK_BYTES);
    out.set(decodeBase64Url(w.nonce_b64), 0);
    out.set(decodeBase64Url(w.ct_b64), WRAP_NONCE_BYTES);
    return out;
  };
  const { alg, m_kib, t, p, salt_b64 } = b.kdf;
  return {
    kdfJson: JSON.stringify({ alg, m_kib, t, p, salt_b64 }),
    passBlob: blob(b.dek_wrapped_pass),
    recBlob: blob(b.dek_wrapped_recovery),
  };
}

export function createKeyringRoutes(db: DatabaseSync) {
  const router = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(db);

  router.use("*", authMiddleware);

  // GET /api/keyring
  router.get("/", (c) => {
    const account = c.get("account") as AuthAccount;
    const allRevisions = c.req.query("all_revisions") === "1";

    let rows: Array<{
      key_version: number;
      rev: number;
      kdf_json: string;
      dek_wrapped_pass: Uint8Array;
      dek_wrapped_recovery: Uint8Array;
      created_at: string;
    }>;

    if (allRevisions) {
      rows = db.prepare(`
        SELECT key_version, rev, kdf_json, dek_wrapped_pass, dek_wrapped_recovery, created_at
        FROM keyrings
        WHERE account_id = ?
        ORDER BY rev DESC
      `).all(account.id) as typeof rows;
    } else {
      rows = db.prepare(`
        SELECT key_version, rev, kdf_json, dek_wrapped_pass, dek_wrapped_recovery, created_at
        FROM keyrings
        WHERE account_id = ?
        ORDER BY rev DESC
        LIMIT 1
      `).all(account.id) as typeof rows;
    }

    if (rows.length === 0) {
      return c.json(
        {
          error: {
            code: "not_found",
            message: "Keyring not found for this account",
          },
        } satisfies ApiError,
        404,
      );
    }

    const items: KeyringItem[] = rows.map((r) => {
      const passNonce = r.dek_wrapped_pass.subarray(0, 12);
      const passCt = r.dek_wrapped_pass.subarray(12);
      const recNonce = r.dek_wrapped_recovery.subarray(0, 12);
      const recCt = r.dek_wrapped_recovery.subarray(12);

      return {
        key_version: r.key_version,
        rev: r.rev,
        kdf: JSON.parse(r.kdf_json),
        dek_wrapped_pass: {
          nonce_b64: encodeBase64Url(passNonce),
          ct_b64: encodeBase64Url(passCt),
        },
        dek_wrapped_recovery: {
          nonce_b64: encodeBase64Url(recNonce),
          ct_b64: encodeBase64Url(recCt),
        },
        created_at: r.created_at,
      };
    });

    const latestRev = rows[0].rev;
    c.header("ETag", `"${latestRev}"`);

    const res: KeyringGetRes = {
      current_key_version: rows[0].key_version,
      items,
    };

    return c.json(res, 200);
  });

  // PUT /api/keyring/:key_version
  //
  // Everything async (reading the body, hashing, checking the proof) happens
  // first; the revision is then re-read and the row inserted in one
  // synchronous transaction, so two writers at once get 200 and 409, never a
  // UNIQUE violation. Only a stored revision counts against the rate limit.
  router.put("/:key_version", async (c) => {
    const keyVersionParam = parseInt(c.req.param("key_version"), 10);
    if (isNaN(keyVersionParam) || keyVersionParam !== 1) {
      return c.json(
        {
          error: {
            code: "key_version_unknown",
            message: "Only key_version 1 is supported in this version",
          },
        } satisfies ApiError,
        422,
      );
    }

    const account = c.get("account") as AuthAccount;
    const rateKey = `keyring_write:${account.id}`;
    const rateCheck = rateLimiter.check(rateKey, WRITES_PER_HOUR, 3600);
    if (!rateCheck.allowed) {
      c.header("Retry-After", String(rateCheck.retryAfterSec ?? 3600));
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many keyring writes for this account",
            retry_after_sec: rateCheck.retryAfterSec ?? 3600,
          },
        } satisfies ApiError,
        429,
      );
    }

    const authHeader = c.req.header("X-Emo-Auth");
    let authKeyBytes: Uint8Array | null = null;
    try {
      authKeyBytes = authHeader ? decodeBase64Url(authHeader) : null;
    } catch {
      // Answered below
    }
    if (!authHeader || authKeyBytes?.byteLength !== 32) {
      return c.json(
        {
          error: {
            code: "auth_proof_invalid",
            message: "Missing or malformed X-Emo-Auth header",
          },
        } satisfies ApiError,
        403,
      );
    }

    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_KEYRING_BYTES) {
      return c.json(
        {
          error: {
            code: "payload_too_large",
            message: `Keyring JSON over ${MAX_KEYRING_BYTES} bytes`,
          },
        } satisfies ApiError,
        413,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json(
        {
          error: { code: "invalid_json", message: "Malformed JSON" },
        } satisfies ApiError,
        400,
      );
    }
    const parsed = KeyringPutReqSchema.check(body) ?? parseKeyringPut(body);
    if (typeof parsed === "string") {
      return c.json(
        {
          error: { code: "invalid_field", message: parsed },
        } satisfies ApiError,
        400,
      );
    }
    const { kdfJson, passBlob, recBlob } = parsed;

    const readCurrent = () =>
      db.prepare(`
        SELECT rev, auth_hash
        FROM keyrings
        WHERE account_id = ? AND key_version = 1
        ORDER BY rev DESC
        LIMIT 1
      `).get(account.id) as { rev: number; auth_hash: Uint8Array } | undefined;
    const current = readCurrent();

    let authHash: Uint8Array;
    if (current) {
      const ifMatch = c.req.header("If-Match");
      if (ifMatch !== `"${current.rev}"` && ifMatch !== String(current.rev)) {
        return conflict(current.rev);
      }
      if (!await verifyAuthProof(current.auth_hash, authHeader)) {
        return c.json(
          {
            error: {
              code: "auth_proof_invalid",
              message: "X-Emo-Auth proof does not match stored keyring",
            },
          } satisfies ApiError,
          403,
        );
      }
      authHash = current.auth_hash;
    } else {
      authHash = await sha256Bytes(authKeyBytes);
    }

    const nextRev = (current?.rev ?? 0) + 1;
    const stored = tx(db, () => {
      // Another device may have written since the reads above
      if ((readCurrent()?.rev ?? 0) !== nextRev - 1) return false;
      db.prepare(`
        INSERT INTO keyrings (account_id, key_version, rev, kdf_json, dek_wrapped_pass, dek_wrapped_recovery, auth_hash, created_at)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?)
      `).run(
        account.id,
        nextRev,
        kdfJson,
        passBlob,
        recBlob,
        authHash,
        new Date().toISOString(),
      );
      return true;
    });
    if (!stored) return conflict(readCurrent()?.rev ?? 0);
    rateLimiter.consume(rateKey, WRITES_PER_HOUR, 3600);

    const res: KeyringPutRes = { key_version: 1, rev: nextRev };
    return c.json(res, current ? 200 : 201);

    function conflict(rev: number) {
      return c.json(
        {
          error: {
            code: "keyring_conflict",
            message: `Current keyring revision is ${rev}`,
          },
        } satisfies ApiError,
        409,
      );
    }
  });

  return router;
}
