// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * This device's push subscription: the state the Settings switch shows, turning
 * it on and off, and the check on every app open (a rotated subscription, new
 * VAPID keys, or a server restored without it).
 * Specification: reliability.md §1.6, §2.4; architecture.md §9.4;
 * api.md §2.9.
 */

import {
  apiDeletePushSubscription,
  apiGetVapidKey,
  apiListPushSubscriptions,
  apiSubscribePush,
} from "./api.ts";
import { getMeta, removeMeta, setMeta } from "./db.ts";
import {
  decodeBase64Url,
  encodeBase64Url,
} from "../../../shared/crypto/encoding.ts";

export type PushState =
  | "unsupported"
  | "needs_install"
  | "denied"
  | "default"
  | "off"
  | "on";

function supported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator &&
    typeof PushManager !== "undefined" && typeof Notification !== "undefined";
}

/** iPhone/iPad Safari can subscribe only from the Home Screen icon. */
function iosNotInstalled(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return await reg.pushManager.getSubscription();
}

export async function pushState(): Promise<PushState> {
  if (!supported()) {
    return iosNotInstalledSafe() ? "needs_install" : "unsupported";
  }
  if (iosNotInstalled()) return "needs_install";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "default";
  return (await currentSubscription()) ? "on" : "off";
}

function iosNotInstalledSafe(): boolean {
  try {
    return iosNotInstalled();
  } catch {
    return false;
  }
}

async function post(sub: PushSubscription, replaces?: string): Promise<void> {
  const key = (name: PushEncryptionKeyName) => {
    const raw = sub.getKey(name);
    return raw ? encodeBase64Url(new Uint8Array(raw)) : "";
  };
  await apiSubscribePush({
    endpoint: sub.endpoint,
    keys: { p256dh: key("p256dh"), auth: key("auth") },
    expiration_time: sub.expirationTime,
    ...(replaces && replaces !== sub.endpoint ? { replaces } : {}),
  });
  await setMeta("push_endpoint", sub.endpoint);
}

async function subscribe(): Promise<PushSubscription> {
  const vapid = await apiGetVapidKey();
  const reg = await navigator.serviceWorker.ready;
  return await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(vapid.public_key_b64) as BufferSource,
  });
}

/** The switch turned on: ask (from this tap), subscribe, register. */
export async function enablePush(): Promise<PushState> {
  if (!supported() || iosNotInstalled()) return await pushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return await pushState();
  const previous = await getMeta<string>("push_endpoint");
  const sub = (await currentSubscription()) ?? (await subscribe());
  await post(sub, previous ?? undefined);
  return "on";
}

/** The switch turned off: unsubscribe here and remove the server row. */
export async function disablePush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    const mine = (await apiListPushSubscriptions()).items.find((i) =>
      i.endpoint === sub.endpoint
    );
    if (mine) await apiDeletePushSubscription(mine.id);
    await sub.unsubscribe();
  }
  await removeMeta("push_endpoint");
  return await pushState();
}

function sameKey(sub: PushSubscription, vapidB64: string): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return true;
  return encodeBase64Url(new Uint8Array(current)) === vapidB64;
}

/**
 * On every app open: re-subscribe when the VAPID key changed, register again
 * when the browser rotated the endpoint or the server lost the row.
 */
export async function refreshPushSubscription(): Promise<void> {
  if (!supported() || Notification.permission !== "granted") return;
  let sub = await currentSubscription();
  if (!sub) return;
  const previous = await getMeta<string>("push_endpoint");
  const vapid = await apiGetVapidKey();
  if (!sameKey(sub, vapid.public_key_b64)) {
    await sub.unsubscribe();
    sub = await subscribe();
    await post(sub, previous ?? undefined);
    return;
  }
  const listed = (await apiListPushSubscriptions()).items.some((i) =>
    i.endpoint === sub!.endpoint
  );
  if (!listed || previous !== sub.endpoint) {
    await post(sub, previous ?? undefined);
  }
}

/**
 * The person's own choice to have no reminders on this device: "Not now" in
 * onboarding, or the Settings switch turned off. Turning them on clears it.
 */
export async function recordPushChoice(declined: boolean): Promise<void> {
  if (declined) await setMeta("push_declined", true);
  else await removeMeta("push_declined");
}

/** "Keep off" on Home's line: never show it again on this device. */
export async function keepRemindersOff(): Promise<void> {
  await setMeta("push_keep_off", true);
}

/**
 * Home's quiet line (ui.md §3): reminders are off on this
 * device **without the person choosing it** — notifications blocked,
 * permission never asked, the subscription lost, or iPhone Safari outside
 * the Home Screen. Never after "Not now" or a switch turned off, never once
 * "Keep off" was tapped, never while reminders are paused (that has its own
 * line), never where push cannot work at all. Returns the state, or null.
 */
export async function remindersNotReaching(
  paused: boolean,
): Promise<PushState | null> {
  if (paused) return null;
  if (await getMeta<boolean>("push_keep_off")) return null;
  if (await getMeta<boolean>("push_declined")) return null;
  const state = await pushState();
  return state === "on" || state === "unsupported" ? null : state;
}
