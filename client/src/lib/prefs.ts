// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Encrypted prefs (`{ appearance, email? }`): a local change is encrypted and
 * marked dirty, and the sync pass uploads it; otherwise the newer server blob
 * is applied. Last write wins (api.md §2.7, architecture.md §8.3 step
 * 4). `email` — the normalised sign-in address, E2E-encrypted like the rest —
 * is the passphrase's username for password managers once the device is
 * unlocked (ui.md §12.5); never stored in plaintext.
 */

import { ApiErrorResponse, apiGetPrefs, apiPutPrefs } from "./api.ts";
import { broadcast } from "./channel.ts";
import {
  decryptPrefsLocally,
  encryptPrefsLocally,
  isLocked,
} from "./crypto.ts";
import { getStoredPrefs, putStoredPrefs } from "./db.ts";
import { cachedAccount } from "./session.ts";
import { sessionEmail, setSessionEmail } from "./sessionEmail.ts";
import {
  type AppearancePref,
  getAppearance,
  setAppearance,
  updateTheme,
} from "./theme.ts";

interface PrefsV1 {
  appearance: AppearancePref;
  /** Normalised (trim → NFC → lower case); missing in older blobs */
  email?: string;
}

/** The address the prefs hold, once read or written here (null: none yet) */
let prefsEmail: string | null = null;

/** A decrypted blob: its appearance painted, its address remembered */
function received(prefs: PrefsV1 | null): void {
  if (!prefs) return;
  if (prefs.appearance) setAppearance(prefs.appearance);
  if (typeof prefs.email === "string" && prefs.email) {
    prefsEmail = prefs.email;
    // This tab's own sign-in wins; otherwise the prefs name the account
    if (!sessionEmail()) setSessionEmail(prefs.email);
  }
}

/** The whole blob, encrypted and marked dirty for the next sync pass */
async function writePrefs(accountId: string, keyVersion: number) {
  const email = sessionEmail() ?? prefsEmail;
  const enc = await encryptPrefsLocally(
    {
      appearance: getAppearance(),
      ...(email ? { email } : {}),
    } satisfies PrefsV1,
    accountId,
    keyVersion,
  );
  if (email) prefsEmail = email;
  const previous = await getStoredPrefs();
  await putStoredPrefs({
    key_version: keyVersion,
    ...enc,
    updated_at: previous?.updated_at ?? null,
    dirty: true,
  });
}

/** Applies a new appearance here and queues it for the other devices. */
export async function saveAppearance(
  partial: Partial<AppearancePref>,
  accountId: string,
  keyVersion: number,
): Promise<void> {
  updateTheme(partial);
  if (isLocked()) return;
  await writePrefs(accountId, keyVersion);
  broadcast({ type: "prefs" });
}

/** Lock or sign-out: the address read from the prefs is forgotten too */
export function forgetPrefsEmail(): void {
  prefsEmail = null;
}

/** Re-reads the local blob (after another tab changed it). */
export async function applyStoredPrefs(accountId: string): Promise<void> {
  const local = await getStoredPrefs();
  if (!local || isLocked()) return;
  received(
    await decryptPrefsLocally<PrefsV1>(
      local.nonce_b64,
      local.ct_b64,
      accountId,
      local.key_version,
    ),
  );
}

/**
 * Step 4 of the sync pass. Needs the DEK; a locked device skips it. Then,
 * when this tab signed in with an address the prefs do not hold yet (a new
 * account, or one from before 2026-10-09), it is written in and uploaded —
 * only after the exchange, so this device's appearance never overwrites the
 * one on the server.
 */
export async function syncPrefs(accountId: string): Promise<void> {
  if (isLocked()) return;
  await exchangePrefs(accountId);
  const email = sessionEmail();
  if (!email) return;
  const local = await getStoredPrefs();
  if (local && prefsEmail === null) await applyStoredPrefs(accountId);
  if (email === prefsEmail) return;
  const keyVersion = local?.key_version ??
    (await cachedAccount())?.current_key_version ?? 1;
  await writePrefs(accountId, keyVersion);
  await exchangePrefs(accountId);
}

async function exchangePrefs(accountId: string): Promise<void> {
  const local = await getStoredPrefs();
  if (local?.dirty) {
    const res = await apiPutPrefs({
      key_version: local.key_version,
      nonce_b64: local.nonce_b64,
      ct_b64: local.ct_b64,
    });
    await putStoredPrefs({
      ...local,
      updated_at: res.updated_at,
      dirty: false,
    });
    return;
  }

  let remote;
  try {
    remote = await apiGetPrefs();
  } catch (err) {
    if (err instanceof ApiErrorResponse && err.status === 404) {
      // Never written, or lost in a server restore: upload what this device has
      if (local) await putStoredPrefs({ ...local, dirty: true });
      if (local) await exchangePrefs(accountId);
      return;
    }
    throw err;
  }
  if (local && remote.updated_at === local.updated_at) return;

  const prefs = await decryptPrefsLocally<PrefsV1>(
    remote.nonce_b64,
    remote.ct_b64,
    accountId,
    remote.key_version,
  );
  await putStoredPrefs({
    key_version: remote.key_version,
    nonce_b64: remote.nonce_b64,
    ct_b64: remote.ct_b64,
    updated_at: remote.updated_at,
    dirty: false,
  });
  if (prefs) {
    received(prefs);
    broadcast({ type: "prefs" });
  }
}
