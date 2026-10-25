// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Frontend HTTP client for Emo server API.
 * Handles protocol headers, CSRF, epoch tracking, and error normalization.
 * Specification: api.md.
 */

import {
  type ApiError,
  ApiErrorSchema,
  type AuthRequestCodeReq,
  type AuthRequestCodeRes,
  AuthRequestCodeResSchema,
  type AuthVerifyReq,
  type AuthVerifyRes,
  AuthVerifyResSchema,
  type EntriesPullRes,
  EntriesPullResSchema,
  type EntryDeleteRes,
  EntryDeleteResSchema,
  type EntryPutReq,
  type EntryPutRes,
  EntryPutResSchema,
  type InstanceRes,
  InstanceResSchema,
  type InviteCreateRes,
  InviteCreateResSchema,
  type InvitesListRes,
  InvitesListResSchema,
  type KeyringGetRes,
  KeyringGetResSchema,
  type KeyringPutReq,
  type KeyringPutRes,
  KeyringPutResSchema,
  type Locale,
  type PrefsGetRes,
  PrefsGetResSchema,
  type PrefsPutReq,
  type PrefsPutRes,
  PrefsPutResSchema,
  type PushSubscribeReq,
  type PushSubscribeRes,
  PushSubscribeResSchema,
  type PushSubscriptionsRes,
  PushSubscriptionsResSchema,
  type RemindersPullRes,
  RemindersPullResSchema,
  type SessionRes,
  SessionResSchema,
  type SessionsListRes,
  SessionsListResSchema,
  type SettingsGetRes,
  SettingsGetResSchema,
  type SettingsPutReq,
  type VapidRes,
  VapidResSchema,
} from "../../../shared/protocol.ts";
import { is, type Schema } from "../../../shared/schema.ts";
import { parseSemver, serverTooOld } from "../../../shared/version.ts";
import { CLIENT_VERSION } from "./version.ts";
import { isEmoAnswer, noteReachable } from "./network.ts";

export class ApiErrorResponse extends Error {
  public code: string;
  public retryAfterSec?: number;
  public status: number;

  constructor(status: number, error: ApiError["error"]) {
    super(error.message);
    this.name = "ApiErrorResponse";
    this.status = status;
    this.code = error.code;
    this.retryAfterSec = error.retry_after_sec;
  }
}

let onEpochMismatchCallback: ((newEpoch: string) => void) | null = null;
let onAccountGoneCallback: (() => void) | null = null;

/**
 * The epoch (`X-Emo-Epoch`) of the latest response, and the one this device
 * last synced against (`meta.server_epoch`, set by `sync.ts`). A difference
 * means the server was restored; the sync pass handles it under its lock and
 * stores the new epoch only after re-uploading (api.md §3).
 */
let observedEpoch: string | null = null;
let knownEpoch: string | null = null;

export function getObservedEpoch(): string | null {
  return observedEpoch;
}

export function setKnownEpoch(epoch: string | null) {
  knownEpoch = epoch;
}

/** Called once per differing epoch seen outside a sync pass. */
export function setEpochMismatchHandler(fn: (newEpoch: string) => void) {
  onEpochMismatchCallback = fn;
}

export function setAccountGoneHandler(fn: () => void) {
  onAccountGoneCallback = fn;
}

let onSignedOutCallback: (() => void) | null = null;

/** `401 unauthenticated` on any request: the session ended (reliability.md §1.3). */
export function setSignedOutHandler(fn: () => void) {
  onSignedOutCallback = fn;
}

/**
 * Compatibility with the server (reliability.md §3): `update_required` after
 * a 426, `server_older` when `X-Emo-Server` is more than one minor behind.
 * Either pauses sync; saving on the device keeps working.
 */
export type CompatState = "ok" | "update_required" | "server_older";

const CLIENT_SEMVER = parseSemver(CLIENT_VERSION);
let compat: CompatState = "ok";
const compatListeners = new Set<(state: CompatState) => void>();

export function getCompat(): CompatState {
  return compat;
}

export function onCompatChange(fn: (state: CompatState) => void): () => void {
  compatListeners.add(fn);
  return () => compatListeners.delete(fn);
}

function setCompat(next: CompatState) {
  if (compat === next) return;
  compat = next;
  for (const fn of compatListeners) fn(next);
}

/**
 * Server clock minus this device's (reliability.md §1.1 "Device clock
 * wrong"), from the `Date` header of the last API response; null before the
 * first. Second resolution is plenty against the 5-minute threshold, and,
 * unlike `received_at`, it is never an old value echoed by an idempotent
 * upload.
 */
let clockSkewSec: number | null = null;

export function lastClockSkewSec(): number | null {
  return clockSkewSec;
}

/**
 * The account whose data this device holds (`session.ts` keeps it), sent as
 * `X-Emo-Account`: the server refuses a session of another account with 401
 * (api.md §1), so no sync, tab or race can mix two accounts' data.
 */
let deviceAccountId: string | null = null;

export function setDeviceAccount(id: string | null) {
  deviceAccountId = id;
}

function observeServerClock(response: Response) {
  const server = Date.parse(response.headers.get("Date") ?? "");
  if (!Number.isNaN(server)) {
    clockSkewSec = Math.round((server - Date.now()) / 1000);
  }
}

function checkCompat(response: Response) {
  if (response.status === 426) {
    setCompat("update_required");
    return;
  }
  const server = parseSemver(response.headers.get("X-Emo-Server") ?? "");
  if (server && CLIENT_SEMVER) {
    setCompat(serverTooOld(server, CLIENT_SEMVER) ? "server_older" : "ok");
  }
}

/**
 * One API call. A response body is checked against `schema` before anyone
 * uses it (api.md §4); a body of another shape is an `internal`
 * error, never data. `null` = the body is not used.
 */
async function request<T>(
  path: string,
  schema: Schema<T> | null,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  // The browser sets `Origin` itself (the server's CSRF check reads it)
  headers.set("X-Emo-Client", CLIENT_VERSION);
  if (deviceAccountId) headers.set("X-Emo-Account", deviceAccountId);

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
    });
  } catch (err) {
    // No answer at all: offline, or the server is down (network.ts)
    if ((err as Error)?.name !== "AbortError") noteReachable(false);
    throw err;
  }
  // A 5xx without X-Emo-Server is a proxy answering for a stopped server
  noteReachable(isEmoAnswer(response));
  checkCompat(response);
  observeServerClock(response);

  const serverEpoch = response.headers.get("X-Emo-Epoch");
  if (serverEpoch && serverEpoch !== observedEpoch) {
    observedEpoch = serverEpoch;
    if (knownEpoch && serverEpoch !== knownEpoch) {
      onEpochMismatchCallback?.(serverEpoch);
    }
  }

  if (response.status === 204) {
    return null as unknown as T;
  }

  if (!response.ok) {
    let raw: unknown = null;
    try {
      raw = await response.json();
    } catch {
      // Non-JSON response
    }
    const errPayload = is(ApiErrorSchema, raw) ? raw : null;

    const code = errPayload?.error.code || "internal";
    const message = errPayload?.error.message || response.statusText;

    if (code === "account_gone" && onAccountGoneCallback) {
      onAccountGoneCallback();
    } else if (response.status === 401 && code === "unauthenticated") {
      onSignedOutCallback?.();
    }

    throw new ApiErrorResponse(response.status, {
      code: code as ApiError["error"]["code"],
      message,
      retry_after_sec: errPayload?.error.retry_after_sec,
    });
  }

  const body: unknown = await response.json();
  const problem = schema?.check(body) ?? null;
  if (problem) {
    throw new ApiErrorResponse(response.status, {
      code: "internal",
      message: `Unexpected response: ${problem}`,
    });
  }
  return body as T;
}

// -------------------------------------------------------------
// Auth
// -------------------------------------------------------------

export async function apiRequestCode(
  email: string,
  inviteCode?: string,
  locale?: Locale,
): Promise<AuthRequestCodeRes> {
  return await request("/api/auth/request-code", AuthRequestCodeResSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      { email, invite_code: inviteCode, locale } as AuthRequestCodeReq,
    ),
  });
}

export async function apiVerifyCode(
  email: string,
  code: string,
  tz: string,
  locale: Locale,
): Promise<AuthVerifyRes> {
  return await request("/api/auth/verify", AuthVerifyResSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, tz, locale } as AuthVerifyReq),
  });
}

export async function apiLogout(): Promise<void> {
  return await request("/api/auth/logout", null, {
    method: "POST",
  });
}

export async function apiGetSession(): Promise<SessionRes> {
  return await request("/api/session", SessionResSchema, {
    method: "GET",
  });
}

// -------------------------------------------------------------
// Keyring
// -------------------------------------------------------------

export async function apiGetKeyring(
  allRevisions = false,
): Promise<KeyringGetRes> {
  const url = allRevisions ? "/api/keyring?all_revisions=1" : "/api/keyring";
  return await request(url, KeyringGetResSchema, { method: "GET" });
}

export async function apiPutKeyring(
  keyVersion: number,
  item: KeyringPutReq,
  authProofB64: string,
  ifMatchRev?: number,
): Promise<KeyringPutRes> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Emo-Auth": authProofB64,
  };
  if (ifMatchRev !== undefined) {
    headers["If-Match"] = `"${ifMatchRev}"`;
  }
  return await request(`/api/keyring/${keyVersion}`, KeyringPutResSchema, {
    method: "PUT",
    headers,
    body: JSON.stringify(item),
  });
}

// -------------------------------------------------------------
// Entries
// -------------------------------------------------------------

export async function apiPutEntry(
  id: string,
  blob: EntryPutReq,
): Promise<EntryPutRes> {
  return await request(`/api/entries/${id}`, EntryPutResSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blob),
  });
}

export async function apiDeleteEntry(
  id: string,
  authProofB64: string,
): Promise<EntryDeleteRes> {
  return await request(`/api/entries/${id}`, EntryDeleteResSchema, {
    method: "DELETE",
    headers: { "X-Emo-Auth": authProofB64 },
  });
}

export async function apiPullEntries(
  since = 0,
  limit = 500,
): Promise<EntriesPullRes> {
  return await request(
    `/api/entries?since=${since}&limit=${limit}`,
    EntriesPullResSchema,
    {
      method: "GET",
    },
  );
}

// -------------------------------------------------------------
// Prefs
// -------------------------------------------------------------

export async function apiGetPrefs(): Promise<PrefsGetRes> {
  return await request("/api/prefs", PrefsGetResSchema, { method: "GET" });
}

export async function apiPutPrefs(blob: PrefsPutReq): Promise<PrefsPutRes> {
  return await request("/api/prefs", PrefsPutResSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blob),
  });
}

// -------------------------------------------------------------
// Settings
// -------------------------------------------------------------

export async function apiGetReminders(
  since: string,
): Promise<RemindersPullRes> {
  return await request(
    `/api/reminders?since=${encodeURIComponent(since)}`,
    RemindersPullResSchema,
  );
}

export async function apiGetSettings(): Promise<SettingsGetRes> {
  return await request("/api/settings", SettingsGetResSchema, {
    method: "GET",
  });
}

export async function apiPutSettings(
  settings: SettingsPutReq,
): Promise<SettingsGetRes> {
  return await request("/api/settings", SettingsGetResSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

/** Pause reminders for 1, 3 or 7 days (api.md §2.5) */
export async function apiPauseReminders(
  days: 1 | 3 | 7,
): Promise<SettingsGetRes> {
  return await request("/api/settings/pause", SettingsGetResSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
}

/** Resume reminders now */
export async function apiResumeReminders(): Promise<SettingsGetRes> {
  return await request("/api/settings/pause", SettingsGetResSchema, {
    method: "DELETE",
  });
}

// -------------------------------------------------------------
// Account
// -------------------------------------------------------------

export async function apiSendRecoveryMail(recoveryKey: string): Promise<void> {
  return await request("/api/account/recovery-mail", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recovery_key: recoveryKey }),
  });
}

export async function apiDeleteAccount(authProofB64: string): Promise<void> {
  return await request("/api/account", null, {
    method: "DELETE",
    headers: { "X-Emo-Auth": authProofB64 },
  });
}

// -------------------------------------------------------------
// Push
// -------------------------------------------------------------

export async function apiGetVapidKey(): Promise<VapidRes> {
  return await request("/api/push/vapid", VapidResSchema, { method: "GET" });
}

export async function apiSubscribePush(
  sub: PushSubscribeReq,
): Promise<PushSubscribeRes> {
  return await request("/api/push/subscriptions", PushSubscribeResSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
}

// -------------------------------------------------------------
// Instance
// -------------------------------------------------------------

export async function apiListSessions(): Promise<SessionsListRes> {
  return await request("/api/sessions", SessionsListResSchema);
}

export async function apiRevokeSession(id: string): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(id)}`, null, {
    method: "DELETE",
  });
}

export async function apiListInvites(): Promise<InvitesListRes> {
  return await request("/api/invites", InvitesListResSchema);
}

export async function apiCreateInvite(): Promise<InviteCreateRes> {
  return await request("/api/invites", InviteCreateResSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function apiListPushSubscriptions(): Promise<
  PushSubscriptionsRes
> {
  return await request("/api/push/subscriptions", PushSubscriptionsResSchema);
}

export async function apiDeletePushSubscription(id: string): Promise<void> {
  await request(`/api/push/subscriptions/${encodeURIComponent(id)}`, null, {
    method: "DELETE",
  });
}

export async function apiGetInstance(): Promise<InstanceRes> {
  return await request("/api/instance", InstanceResSchema, { method: "GET" });
}
