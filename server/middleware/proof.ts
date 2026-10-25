// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Proof of DEK possession verification middleware / helper.
 * Header: X-Emo-Auth: <base64url of 32 bytes>.
 * Specification: architecture.md §5.1, api.md §1.
 */

import type { Context, Next } from "@hono/hono";
import type { DatabaseSync } from "node:sqlite";
import { verifyAuthProof } from "../crypto.ts";
import type { AppEnv, AuthAccount } from "./auth.ts";
import type { ApiError } from "../../shared/protocol.ts";

export function createProofMiddleware(db: DatabaseSync) {
  return async (c: Context<AppEnv>, next: Next) => {
    const authProofHeader = c.req.header("X-Emo-Auth");
    if (!authProofHeader) {
      return c.json(
        {
          error: {
            code: "auth_proof_invalid",
            message: "Missing X-Emo-Auth proof header",
          },
        } satisfies ApiError,
        403,
      );
    }

    const account = c.get("account") as AuthAccount | undefined;
    if (!account) {
      return c.json(
        {
          error: {
            code: "unauthenticated",
            message: "Unauthenticated",
          },
        } satisfies ApiError,
        401,
      );
    }

    // Fetch the latest keyring row for this account
    const keyring = db.prepare(`
      SELECT auth_hash
      FROM keyrings
      WHERE account_id = ?
      ORDER BY rev DESC
      LIMIT 1
    `).get(account.id) as { auth_hash: Uint8Array } | undefined;

    if (!keyring) {
      return c.json(
        {
          error: {
            code: "auth_proof_invalid",
            message: "Account has no keyring",
          },
        } satisfies ApiError,
        403,
      );
    }

    const isValid = await verifyAuthProof(keyring.auth_hash, authProofHeader);
    if (!isValid) {
      return c.json(
        {
          error: {
            code: "auth_proof_invalid",
            message: "Invalid X-Emo-Auth proof",
          },
        } satisfies ApiError,
        403,
      );
    }

    c.set("authProof", authProofHeader);
    return await next();
  };
}
