// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shared API protocol types, requests, responses, and error codes, each with
 * a runtime schema (end of file): the server checks input with them, the
 * client checks responses before use. Single source of truth:
 * api.md §4.
 */
import {
  array,
  bool,
  both,
  int,
  lit,
  nullable,
  num,
  object,
  optional,
  type Schema,
  str,
} from "./schema.ts";

export type Iso = string;
export type Uuid = string;
export type B64 = string;
export type Locale = "ru" | "uk" | "en";

export const ERROR_CODES = [
  "invalid_json",
  "invalid_field",
  "code_invalid",
  "unauthenticated",
  "account_gone",
  "origin_mismatch",
  "auth_proof_invalid",
  "invites_disabled",
  "recovery_mail_disabled",
  "not_found",
  "entry_blob_mismatch",
  "keyring_conflict",
  "invite_already_used",
  "invite_limit",
  "entry_deleted",
  "invite_expired",
  "payload_too_large",
  "account_full",
  "window_too_short",
  "tz_unknown",
  "locale_unsupported",
  "key_version_unknown",
  "upgrade_required",
  "rate_limited",
  "internal",
  "mail_unavailable",
  "db_busy",
  "unhealthy",
  "insufficient_storage",
] as const;

export type ErrorCode = typeof ERROR_CODES[number];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    retry_after_sec?: number;
    min_client?: string;
  };
}

export interface Blob {
  key_version: number;
  nonce_b64: B64;
  ct_b64: B64;
}

// -------------------------------------------------------------
// Auth
// -------------------------------------------------------------

export interface AuthRequestCodeReq {
  email: string;
  invite_code?: string;
  locale?: Locale;
}

export interface AuthRequestCodeRes {
  ok: true;
  ttl_sec: number;
}

export interface AuthVerifyReq {
  email: string;
  code: string;
  tz: string;
  locale: Locale;
}

export interface AccountInfo {
  id: Uuid;
  locale: Locale;
  tz: string;
  has_keyring: boolean;
  current_key_version: number | null;
}

export interface AuthVerifyRes {
  account: AccountInfo & { created: boolean };
}

export interface SessionRes {
  account: AccountInfo;
}

// -------------------------------------------------------------
// Invites
// -------------------------------------------------------------

export type InviteStatus = "unused" | "used" | "expired";

export interface InviteItem {
  code: string | null;
  created_at: Iso;
  expires_at: Iso;
  max_uses: number;
  uses: number;
  status: InviteStatus;
  joined_at: Iso | null;
}

export interface InvitesListRes {
  limit: number;
  items: InviteItem[];
  joined_total: number;
}

export interface InviteCreateRes {
  code: string;
  expires_at: Iso;
  max_uses: 1;
}

// -------------------------------------------------------------
// Keyring
// -------------------------------------------------------------

export interface Kdf {
  alg: "argon2id";
  m_kib: number;
  t: number;
  p: number;
  salt_b64: B64;
}

export interface Wrapped {
  nonce_b64: B64;
  ct_b64: B64;
}

export interface KeyringItem {
  key_version: number;
  rev: number;
  kdf: Kdf;
  dek_wrapped_pass: Wrapped;
  dek_wrapped_recovery: Wrapped;
  created_at: Iso;
}

export interface KeyringGetRes {
  current_key_version: number;
  items: KeyringItem[];
}

export type KeyringPutReq = Omit<KeyringItem, "rev" | "created_at">;

export interface KeyringPutRes {
  key_version: number;
  rev: number;
}

// -------------------------------------------------------------
// Sessions
// -------------------------------------------------------------

export interface SessionItem {
  id: string;
  user_agent: string;
  created_at: Iso;
  last_seen_at: Iso;
  current: boolean;
}

export interface SessionsListRes {
  items: SessionItem[];
}

// -------------------------------------------------------------
// Account and settings
// -------------------------------------------------------------

export interface Settings {
  tz: string;
  locale: Locale;
  wake_start: string;
  wake_end: string;
  reminders_per_day: number;
  min_gap_min: number;
}

export type SettingsPutReq = Settings;

export interface SettingsGetRes extends Settings {
  receiving_reminders: boolean;
  /**
   * ISO instant until which reminders are paused, or null; a pause that
   * has ended reads as null. Missing from servers before 2026-10-09.
   */
  reminders_paused_until?: string | null;
}

/** `PUT /api/settings/pause`: 1, 3 or 7 days from now (api.md §2.5) */
export interface PauseReq {
  days: 1 | 3 | 7;
}

export interface RecoveryMailReq {
  recovery_key: string;
}

// -------------------------------------------------------------
// Entries
// -------------------------------------------------------------

export type EntryPutReq = Blob;

export interface EntryPutRes {
  seq: number;
  received_at: Iso;
}

export interface EntryDeleteRes {
  seq: number;
}

export interface EntryItem {
  id: Uuid;
  seq: number;
  key_version: number;
  nonce_b64: B64 | null;
  ct_b64: B64 | null;
  deleted: boolean;
  received_at: Iso;
}

export interface EntriesPullRes {
  items: EntryItem[];
  next_seq: number;
  max_seq: number;
  has_more: boolean;
}

// -------------------------------------------------------------
// Prefs
// -------------------------------------------------------------

export type PrefsPutReq = Blob;

export interface PrefsPutRes {
  updated_at: Iso;
}

export interface PrefsGetRes extends Blob {
  updated_at: Iso;
}

// -------------------------------------------------------------
// Reminders
// -------------------------------------------------------------

/** `paused`: planned while reminders were paused, never sent (2026-10-09) */
export type ReminderStatus =
  | "planned"
  | "sent"
  | "failed"
  | "cancelled"
  | "paused";

/**
 * Why a `cancelled` reminder was never sent (2026-10-10): a mid-day settings
 * change, not sent within its 30 minutes (the server was down), no device to
 * send to, or a move to another time zone. Typed as a string so a newer
 * server may add one.
 */
export type ReminderReason = "settings" | "overdue" | "no_device" | "tz_change";

/**
 * Minutes after a reminder's notification appears during which tapping it,
 * or opening Emo while it still shows, answers that reminder (`random`);
 * later the check-in is `manual` (methodology.md §1.1).
 * `client/src/sw.js` keeps its own copy: it imports nothing.
 */
export const REMINDER_RESPONSE_WINDOW_MIN = 15;

export interface ReminderItem {
  id: Uuid;
  local_date: string;
  /** The time zone the day was planned in; missing from servers before 2026-10-10 */
  tz?: string;
  scheduled_for: Iso;
  sent_at: Iso | null;
  status: ReminderStatus;
  /** On `cancelled` rows since 2026-10-10 (`ReminderReason`), else null */
  reason?: string | null;
  updated_at: Iso;
}

export interface RemindersPullRes {
  items: ReminderItem[];
  next_since: Iso;
  has_more: boolean;
}

// -------------------------------------------------------------
// Push
// -------------------------------------------------------------

export interface VapidRes {
  public_key_b64: B64;
}

export interface PushSubscribeReq {
  endpoint: string;
  keys: { p256dh: B64; auth: B64 };
  expiration_time: number | null;
  replaces?: string;
}

export interface PushSubscribeRes {
  id: string;
}

export interface PushSubscriptionsRes {
  items: { id: string; endpoint: string; created_at: Iso }[];
}

// -------------------------------------------------------------
// Instance (no auth)
// -------------------------------------------------------------

export interface InstanceRes {
  version: string;
  source_url: string;
  crisis_url: string;
  privacy_notice_url: string | null;
  operator_contact: string | null;
  recovery_mail_enabled: boolean;
  invites_by_users: boolean;
  /** `open`: anyone may create an account; `invite`: only with an invite
   * code. Absent from a server before 2026-10-12 (it was invite only). */
  registration?: "open" | "invite";
}

// -------------------------------------------------------------
// Health
// -------------------------------------------------------------

export interface HealthRes {
  ok: boolean;
  db: "ok" | "error";
  scheduler_last_tick_at: Iso | null;
  scheduler_lag_sec?: number;
  mail?: "ok" | "circuit_open" | "unconfigured";
  version: string;
  epoch: string;
  error?: ApiError["error"];
}

// -------------------------------------------------------------
// Runtime schemas (api.md §4)
// -------------------------------------------------------------

const locale = lit("ru", "uk", "en");
const blob = object({ key_version: int, nonce_b64: str, ct_b64: str });
const wrapped = object({ nonce_b64: str, ct_b64: str });

/** `code` stays a string: a newer server may send one this client lacks. */
export const ApiErrorSchema: Schema<{
  error: Omit<ApiError["error"], "code"> & { code: string };
}> = object({
  error: object({
    code: str,
    message: str,
    retry_after_sec: optional(num),
    min_client: optional(str),
  }),
});

export const AuthRequestCodeReqSchema: Schema<AuthRequestCodeReq> = object({
  email: str,
  invite_code: optional(str),
  locale: optional(locale),
});
export const AuthRequestCodeResSchema: Schema<AuthRequestCodeRes> = object({
  ok: lit(true),
  ttl_sec: int,
});
export const AuthVerifyReqSchema: Schema<AuthVerifyReq> = object({
  email: str,
  code: str,
  tz: str,
  locale,
});

const accountInfo = object({
  id: str,
  locale,
  tz: str,
  has_keyring: bool,
  current_key_version: nullable(int),
});
export const AuthVerifyResSchema: Schema<AuthVerifyRes> = object({
  account: both(accountInfo, object({ created: bool })),
});
export const SessionResSchema: Schema<SessionRes> = object({
  account: accountInfo,
});

export const InvitesListResSchema: Schema<InvitesListRes> = object({
  limit: int,
  items: array(object({
    code: nullable(str),
    created_at: str,
    expires_at: str,
    max_uses: int,
    uses: int,
    status: lit("unused", "used", "expired"),
    joined_at: nullable(str),
  })),
  joined_total: int,
});
export const InviteCreateResSchema: Schema<InviteCreateRes> = object({
  code: str,
  expires_at: str,
  max_uses: lit(1),
});

const kdf = object({
  alg: lit("argon2id"),
  m_kib: int,
  t: int,
  p: int,
  salt_b64: str,
});
export const KeyringGetResSchema: Schema<KeyringGetRes> = object({
  current_key_version: int,
  items: array(object({
    key_version: int,
    rev: int,
    kdf,
    dek_wrapped_pass: wrapped,
    dek_wrapped_recovery: wrapped,
    created_at: str,
  })),
});
export const KeyringPutReqSchema: Schema<KeyringPutReq> = object({
  key_version: int,
  kdf,
  dek_wrapped_pass: wrapped,
  dek_wrapped_recovery: wrapped,
});
export const KeyringPutResSchema: Schema<KeyringPutRes> = object({
  key_version: int,
  rev: int,
});

export const SessionsListResSchema: Schema<SessionsListRes> = object({
  items: array(object({
    id: str,
    user_agent: str,
    created_at: str,
    last_seen_at: str,
    current: bool,
  })),
});

const settings = object({
  tz: str,
  locale,
  wake_start: str,
  wake_end: str,
  reminders_per_day: int,
  min_gap_min: int,
});
export const SettingsPutReqSchema: Schema<SettingsPutReq> = settings;
export const SettingsGetResSchema: Schema<SettingsGetRes> = both(
  settings,
  object({
    receiving_reminders: bool,
    reminders_paused_until: optional(nullable(str)),
  }),
);
export const PauseReqSchema: Schema<PauseReq> = object({
  days: lit(1, 3, 7),
});
export const RecoveryMailReqSchema: Schema<RecoveryMailReq> = object({
  recovery_key: str,
});

export const EntryPutReqSchema: Schema<EntryPutReq> = blob;
export const EntryPutResSchema: Schema<EntryPutRes> = object({
  seq: int,
  received_at: str,
});
export const EntryDeleteResSchema: Schema<EntryDeleteRes> = object({
  seq: int,
});
export const EntriesPullResSchema: Schema<EntriesPullRes> = object({
  items: array(object({
    id: str,
    seq: int,
    key_version: int,
    nonce_b64: nullable(str),
    ct_b64: nullable(str),
    deleted: bool,
    received_at: str,
  })),
  next_seq: int,
  max_seq: int,
  has_more: bool,
});

export const PrefsPutReqSchema: Schema<PrefsPutReq> = blob;
export const PrefsPutResSchema: Schema<PrefsPutRes> = object({
  updated_at: str,
});
export const PrefsGetResSchema: Schema<PrefsGetRes> = both(
  blob,
  object({ updated_at: str }),
);

export const RemindersPullResSchema: Schema<RemindersPullRes> = object({
  items: array(object({
    id: str,
    local_date: str,
    tz: optional(str),
    scheduled_for: str,
    sent_at: nullable(str),
    status: lit("planned", "sent", "failed", "cancelled", "paused"),
    reason: optional(nullable(str)),
    updated_at: str,
  })),
  next_since: str,
  has_more: bool,
});

export const VapidResSchema: Schema<VapidRes> = object({
  public_key_b64: str,
});
export const PushSubscribeReqSchema: Schema<PushSubscribeReq> = object({
  endpoint: str,
  keys: object({ p256dh: str, auth: str }),
  expiration_time: nullable(num),
  replaces: optional(str),
});
export const PushSubscribeResSchema: Schema<PushSubscribeRes> = object({
  id: str,
});
export const PushSubscriptionsResSchema: Schema<PushSubscriptionsRes> = object(
  { items: array(object({ id: str, endpoint: str, created_at: str })) },
);

export const InstanceResSchema: Schema<InstanceRes> = object({
  version: str,
  source_url: str,
  crisis_url: str,
  privacy_notice_url: nullable(str),
  operator_contact: nullable(str),
  recovery_mail_enabled: bool,
  invites_by_users: bool,
  registration: optional(lit("open", "invite")),
});

export const HealthResSchema: Schema<HealthRes> = object({
  ok: bool,
  db: lit("ok", "error"),
  scheduler_last_tick_at: nullable(str),
  scheduler_lag_sec: optional(num),
  mail: optional(lit("ok", "circuit_open", "unconfigured")),
  version: str,
  epoch: str,
  error: optional(object({
    code: lit(...ERROR_CODES),
    message: str,
    retry_after_sec: optional(num),
    min_client: optional(str),
  })),
});
