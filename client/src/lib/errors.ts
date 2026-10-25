// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a failed request tells the person (copy.md §3): the server's
 * `message` is for logs and never shown; the `code` picks a key. A request
 * that never reached the server reads as offline.
 * Specification: api.md §1.1–§1.2, architecture.md §11.3.
 */

import type { MessageKey } from "../../../shared/i18n/keys.ts";
import { ApiErrorResponse } from "./api.ts";

export interface UserError {
  key: MessageKey;
  params?: Record<string, string | number>;
  /** Seconds before trying again makes sense (429, 503 mail). */
  retryAfterSec?: number;
}

const BY_CODE: Record<string, MessageKey> = {
  code_invalid: "auth.code.invalid",
  unauthenticated: "errors.sessionExpired",
  account_gone: "errors.accountGone",
  auth_proof_invalid: "errors.forbidden",
  keyring_conflict: "auth.unlock.keysChanged",
  invite_already_used: "errors.inviteInvalid",
  invite_expired: "errors.inviteInvalid",
  invite_limit: "errors.inviteLimit",
  window_too_short: "settings.reminders.windowTooShort",
  upgrade_required: "errors.updateRequired",
  mail_unavailable: "errors.codeSendFailed",
};

export function userError(err: unknown): UserError {
  if (!(err instanceof ApiErrorResponse)) return { key: "errors.offline" };
  if (err.code === "rate_limited") {
    const sec = err.retryAfterSec ?? 60;
    return {
      key: "errors.tooManyRequests",
      params: { min: Math.max(1, Math.ceil(sec / 60)) },
      retryAfterSec: sec,
    };
  }
  return {
    key: BY_CODE[err.code] ?? "errors.generic",
    retryAfterSec: err.retryAfterSec,
  };
}

/** `p•••••son@example.com`: enough to recognise, the same length for every address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  const local = email.slice(0, at);
  const tail = local.length > 4 ? local.slice(-3) : "";
  return `${local[0]}•••••${tail}${email.slice(at)}`;
}
