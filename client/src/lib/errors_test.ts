// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { ApiErrorResponse } from "./api.ts";
import { maskEmail, userError } from "./errors.ts";

Deno.test("errors - server codes map to keys; messages are never shown", () => {
  const err = (status: number, code: string, retry?: number) =>
    new ApiErrorResponse(status, {
      code: code as never,
      message: "server text",
      retry_after_sec: retry,
    });
  assertEquals(userError(err(400, "code_invalid")).key, "auth.code.invalid");
  assertEquals(userError(err(500, "internal")).key, "errors.generic");
  assertEquals(userError(err(503, "mail_unavailable", 300)), {
    key: "errors.codeSendFailed",
    retryAfterSec: 300,
  });
  assertEquals(userError(err(429, "rate_limited", 540)), {
    key: "errors.tooManyRequests",
    params: { min: 9 },
    retryAfterSec: 540,
  });
  assertEquals(
    userError(new TypeError("Failed to fetch")).key,
    "errors.offline",
  );
});

Deno.test("errors - masked email", () => {
  assertEquals(maskEmail("person@example.com"), "p•••••son@example.com");
  assertEquals(maskEmail("ab@x.org"), "a•••••@x.org");
});
