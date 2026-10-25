// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Request bodies through their `shared/protocol.ts` schema (api.md §4):
 * malformed JSON is `400 invalid_json`, a body of the wrong shape `400
 * invalid_field` naming the first wrong field. Routes then check meaning
 * (lengths, ranges, base64) themselves.
 */
import type { Context } from "@hono/hono";
import type { ApiError } from "../shared/protocol.ts";
import type { Schema } from "../shared/schema.ts";

export async function readJson<T>(
  c: Context,
  schema: Schema<T>,
): Promise<T | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: { code: "invalid_json", message: "Malformed JSON" },
      } satisfies ApiError,
      400,
    );
  }
  const problem = schema.check(body);
  if (problem) {
    return c.json(
      { error: { code: "invalid_field", message: problem } } satisfies ApiError,
      400,
    );
  }
  return body as T;
}
