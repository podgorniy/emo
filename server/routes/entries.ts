// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Entries router: upsert, delete (tombstone with DEK proof), and pull stream.
 * Specification: architecture.md §5.5, §6.1, §8, api.md §2.6, §3.
 */

import { Hono } from "@hono/hono";
import { readJson } from "../http.ts";
import type { DatabaseSync } from "node:sqlite";
import {
  type AppEnv,
  type AuthAccount,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import { createProofMiddleware } from "../middleware/proof.ts";
import { tx } from "../db/index.ts";
import { tombstoneEntry } from "../services/accounts.ts";
import {
  decodeBase64Url,
  encodeBase64Url,
  timingSafeEqual,
} from "../../shared/crypto/encoding.ts";
import {
  type EntriesPullRes,
  type EntryDeleteRes,
  type EntryItem,
  EntryPutReqSchema,
  type EntryPutRes,
} from "../../shared/protocol.ts";
import type { ApiError } from "../../shared/protocol.ts";

/** Lower case only: the id is part of the entry's AAD, byte for byte */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** api.md §2.6 */
const MAX_LIVE_ENTRIES = 100_000;

export function createEntriesRoutes(db: DatabaseSync) {
  const router = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(db);
  const proofMiddleware = createProofMiddleware(db);

  router.use("*", authMiddleware);

  // PUT /api/entries/:id
  router.put("/:id", async (c) => {
    const entryId = c.req.param("id") ?? "";
    if (!UUID_V4_REGEX.test(entryId)) {
      return c.json(
        {
          error: {
            code: "invalid_field",
            message: "Entry id must be a valid UUID v4",
          },
        } satisfies ApiError,
        400,
      );
    }

    const body = await readJson(c, EntryPutReqSchema);
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

    if (nonceBytes.byteLength !== 12) {
      return c.json(
        {
          error: { code: "invalid_field", message: "nonce must be 12 bytes" },
        } satisfies ApiError,
        400,
      );
    }

    if (ctBytes.byteLength > 16 * 1024) {
      return c.json(
        {
          error: {
            code: "payload_too_large",
            message: "Ciphertext exceeds 16 KiB limit",
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

    type UpsertOutcome =
      | { kind: "existing"; seq: number; received_at: string }
      | { kind: "deleted" }
      | { kind: "mismatch" }
      | { kind: "full" }
      | { kind: "created"; seq: number; received_at: string };

    const outcome = tx(db, (): UpsertOutcome => {
      const existing = db.prepare(`
        SELECT seq, key_version, nonce, ciphertext, deleted, received_at
        FROM entries
        WHERE account_id = ? AND id = ?
      `).get(account.id, entryId) as {
        seq: number;
        key_version: number;
        nonce: Uint8Array | null;
        ciphertext: Uint8Array | null;
        deleted: number;
        received_at: string;
      } | undefined;

      if (existing) {
        if (existing.deleted === 1) {
          return { kind: "deleted" };
        }

        const sameKeyVersion = existing.key_version === body.key_version;
        const sameNonce = existing.nonce &&
          timingSafeEqual(existing.nonce, nonceBytes);
        const sameCt = existing.ciphertext &&
          timingSafeEqual(existing.ciphertext, ctBytes);

        if (sameKeyVersion && sameNonce && sameCt) {
          return {
            kind: "existing",
            seq: existing.seq,
            received_at: existing.received_at,
          };
        } else {
          return { kind: "mismatch" };
        }
      }

      const { max_seq } = db.prepare(`
        SELECT COALESCE(MAX(seq), 0) as max_seq
        FROM entries
        WHERE account_id = ?
      `).get(account.id) as { max_seq: number };
      if (max_seq >= MAX_LIVE_ENTRIES) {
        const { n } = db.prepare(
          "SELECT COUNT(*) AS n FROM entries WHERE account_id = ? AND deleted = 0",
        ).get(account.id) as { n: number };
        if (n >= MAX_LIVE_ENTRIES) return { kind: "full" };
      }
      db.prepare(`
        INSERT INTO entries (id, account_id, seq, key_version, nonce, ciphertext, deleted, received_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        entryId,
        account.id,
        max_seq + 1,
        body.key_version,
        nonceBytes,
        ctBytes,
        nowIso,
      );
      return {
        kind: "created",
        seq: max_seq + 1,
        received_at: nowIso,
      };
    });

    if (outcome.kind === "deleted") {
      return c.json(
        {
          error: {
            code: "entry_deleted",
            message: "Entry has already been deleted",
          },
        } satisfies ApiError,
        410,
      );
    }
    if (outcome.kind === "mismatch") {
      return c.json(
        {
          error: {
            code: "entry_blob_mismatch",
            message: "Entry exists with different ciphertext bytes",
          },
        } satisfies ApiError,
        409,
      );
    }
    if (outcome.kind === "full") {
      return c.json(
        {
          error: {
            code: "account_full",
            message: "Account reached maximum capacity of 100,000 entries",
          },
        } satisfies ApiError,
        413,
      );
    }
    if (outcome.kind === "existing") {
      const res: EntryPutRes = {
        seq: outcome.seq,
        received_at: outcome.received_at,
      };
      return c.json(res, 200);
    }

    const res: EntryPutRes = {
      seq: outcome.seq,
      received_at: outcome.received_at,
    };
    return c.json(res, 201);
  });

  // DELETE /api/entries/:id (Emergency Undo, requires DEK proof)
  router.delete("/:id", proofMiddleware, (c) => {
    const entryId = c.req.param("id") ?? "";
    if (!UUID_V4_REGEX.test(entryId)) {
      return c.json(
        {
          error: {
            code: "invalid_field",
            message: "Entry id must be a valid UUID v4",
          },
        } satisfies ApiError,
        400,
      );
    }

    const account = c.get("account") as AuthAccount;
    const assignedSeq = tombstoneEntry(db, account.id, entryId);

    const res: EntryDeleteRes = { seq: assignedSeq };
    return c.json(res, 200);
  });

  // GET /api/entries?since=<seq>&limit=<n>
  router.get("/", (c) => {
    const account = c.get("account") as AuthAccount;
    const sinceParam = parseInt(c.req.query("since") || "0", 10);
    const since = isNaN(sinceParam) || sinceParam < 0 ? 0 : sinceParam;

    const limitParam = parseInt(c.req.query("limit") || "500", 10);
    const limit = isNaN(limitParam) || limitParam <= 0
      ? 500
      : Math.min(limitParam, 500);

    const rows = db.prepare(`
      SELECT id, seq, key_version, nonce, ciphertext, deleted, received_at
      FROM entries
      WHERE account_id = ? AND seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `).all(account.id, since, limit + 1) as Array<{
      id: string;
      seq: number;
      key_version: number;
      nonce: Uint8Array | null;
      ciphertext: Uint8Array | null;
      deleted: number;
      received_at: string;
    }>;

    const hasMore = rows.length > limit;
    if (hasMore) {
      rows.pop();
    }

    const items: EntryItem[] = rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      key_version: r.key_version,
      nonce_b64: r.nonce ? encodeBase64Url(r.nonce) : null,
      ct_b64: r.ciphertext ? encodeBase64Url(r.ciphertext) : null,
      deleted: r.deleted === 1,
      received_at: r.received_at,
    }));

    const maxRow = db.prepare(`
      SELECT COALESCE(MAX(seq), 0) as max_seq
      FROM entries
      WHERE account_id = ?
    `).get(account.id) as { max_seq: number };

    const nextSeq = items.length > 0 ? items[items.length - 1].seq : since;

    const res: EntriesPullRes = {
      items,
      next_seq: nextSeq,
      max_seq: maxRow.max_seq,
      has_more: hasMore,
    };

    return c.json(res, 200);
  });

  return router;
}
