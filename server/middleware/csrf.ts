// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CSRF origin validation middleware.
 * Specification: api.md §1.
 */

import type { Context, Next } from "@hono/hono";
import type { Config } from "../config.ts";
import type { ApiError } from "../../shared/protocol.ts";

export function createCsrfMiddleware(config: Config) {
  const allowedOrigin = new URL(config.baseUrl).origin;

  return async (c: Context, next: Next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return await next();
    }

    // The full origin, scheme included (`Origin: null` is simply a mismatch)
    const origin = c.req.header("Origin");
    if (origin !== allowedOrigin) {
      return c.json(
        {
          error: {
            code: "origin_mismatch",
            message: "Origin missing or not this server",
          },
        } satisfies ApiError,
        403,
      );
    }

    return await next();
  };
}
