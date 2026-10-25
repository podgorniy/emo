// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What this device knows about its account without the network: the account
 * (`meta.account`) and the current keyring revision (`meta.keyring`), so the
 * app starts, unlocks and records offline; the network only refreshes them.
 * Specification: reliability.md §5.2, §1.3; architecture.md §4.3, §8.1.
 */

import type {
  AccountInfo,
  KeyringItem,
  KeyringPutReq,
} from "../../../shared/protocol.ts";
import {
  ApiErrorResponse,
  apiGetKeyring,
  apiGetSession,
  apiLogout,
  setDeviceAccount,
} from "./api.ts";
import { keyringProblem } from "../../../shared/crypto/keyring.ts";
import { broadcast } from "./channel.ts";
import { lockDevice } from "./crypto.ts";
import {
  deleteLocalDatabase,
  getAllEntries,
  getMeta,
  getOutboxItems,
  removeMeta,
  setMeta,
} from "./db.ts";

/** Also tells `api.ts` which account this device's requests act for. */
export async function cachedAccount(): Promise<AccountInfo | null> {
  const account = await getMeta<AccountInfo>("account");
  setDeviceAccount(account?.id ?? null);
  return account;
}

export async function rememberAccount(account: AccountInfo): Promise<void> {
  await setMeta("account", account);
  await setMeta("account_id", account.id);
  setDeviceAccount(account.id);
}

/** A 401 left the local data in place: recording works, syncing waits. */
export async function isSignedOut(): Promise<boolean> {
  return (await getMeta<boolean>("signed_out")) === true;
}

export async function setSignedOut(value: boolean): Promise<void> {
  if (value) await setMeta("signed_out", true);
  else await removeMeta("signed_out");
}

export type SessionCheck =
  | { state: "ok"; account: AccountInfo }
  | { state: "signed_out" }
  | { state: "account_gone" }
  | { state: "offline" };

/** `GET /api/session`, read as the state of this device's session. */
export async function checkSession(): Promise<SessionCheck> {
  try {
    const { account } = await apiGetSession();
    // reliability.md §1.3: the session of another account than the one whose
    // data is here (a sign-in this device refused) is ended, never adopted
    const cached = await cachedAccount();
    if (cached && cached.id !== account.id) {
      await apiLogout().catch(() => {});
      await setSignedOut(true);
      return { state: "signed_out" };
    }
    await rememberAccount(account);
    await setSignedOut(false);
    return { state: "ok", account };
  } catch (err) {
    if (err instanceof ApiErrorResponse && err.status === 401) {
      if (err.code === "account_gone") return { state: "account_gone" };
      await setSignedOut(true);
      return { state: "signed_out" };
    }
    return { state: "offline" };
  }
}

export async function cachedKeyring(): Promise<KeyringItem | null> {
  return await getMeta<KeyringItem>("keyring");
}

export async function rememberKeyring(item: KeyringItem): Promise<void> {
  await setMeta("keyring", item);
}

/** After a successful `PUT /api/keyring`: the revision now on the server. */
export async function rememberUploadedKeyring(
  put: KeyringPutReq,
  rev: number,
): Promise<void> {
  await rememberKeyring({ ...put, rev, created_at: new Date().toISOString() });
  // The cached account must not send the next start back to "set a passphrase"
  const account = await cachedAccount();
  if (account && !account.has_keyring) {
    await rememberAccount({
      ...account,
      has_keyring: true,
      current_key_version: put.key_version,
    });
  }
}

/**
 * The newest revision from the server; null offline or when none. Cached only
 * when it is well-formed, so a damaged revision never replaces a copy this
 * device can still unlock with (reliability.md §1.2).
 */
export async function fetchKeyring(): Promise<KeyringItem | null> {
  try {
    const res = await apiGetKeyring();
    const latest = res.items
      .filter((k) => k.key_version === res.current_key_version)
      .sort((a, b) => b.rev - a.rev)[0] ?? res.items[0] ?? null;
    if (latest && !keyringProblem(latest)) await rememberKeyring(latest);
    return latest;
  } catch {
    return null;
  }
}

/** Check-ins on this device the server does not have yet. */
export async function unsyncedCount(): Promise<number> {
  return (await getOutboxItems()).length;
}

/**
 * What clearing this device would remove (reliability.md §1.3): its
 * check-ins, deleted ones aside, and how many of them the server lacks.
 */
export async function localCheckIns(): Promise<
  { entries: number; unsynced: number }
> {
  const entries = (await getAllEntries()).filter((e) => !e.deleted).length;
  return { entries, unsynced: await unsyncedCount() };
}

/**
 * Sign out on this device (reliability.md §1.4): end the session on the
 * server (a network failure is ignored: the cookie goes with the data),
 * tell the other tabs, delete the local database and the localStorage
 * cache. The caller reloads to the sign-in screen.
 */
export async function signOutDevice(): Promise<void> {
  try {
    await apiLogout();
  } catch {
    // Offline or already signed out
  }
  await wipeThisDevice();
}

/** Everything this app keeps on the device, in every tab (sign out, deletion). */
export async function wipeThisDevice(): Promise<void> {
  broadcast({ type: "signout" });
  setDeviceAccount(null);
  await lockDevice().catch(() => {});
  await deleteLocalDatabase();
  try {
    localStorage.clear();
  } catch {
    // Storage blocked: nothing kept there
  }
}
