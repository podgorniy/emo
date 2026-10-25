// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The one `BroadcastChannel('emo')` between tabs of this app, with typed
 * messages; receivers apply them without a reload. Missing in old browsers:
 * then other tabs simply catch up on their next open.
 * Specification: reliability.md §1.3, README.md §3.
 */

export type ChannelMessage =
  | { type: "prefs" }
  | { type: "locale"; payload: string }
  | { type: "lock" }
  | { type: "signout" }
  | { type: "db-upgrade" }
  | { type: "draft-ping" }
  /** Entries were saved or deleted here: an open History reconciles. */
  | { type: "entries" };

type Listener = (msg: ChannelMessage) => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function open(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel("emo");
  channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
    for (const fn of listeners) fn(e.data);
  };
  return channel;
}

/** Tells the other tabs; this tab does not receive its own message. */
export function broadcast(msg: ChannelMessage): void {
  open()?.postMessage(msg);
}

export function onBroadcast(fn: Listener): () => void {
  open();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
