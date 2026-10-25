// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The browser's own install offer (Chrome, Edge, Android): `beforeinstallprompt`
 * is kept from the first moment so onboarding step 3 can show "Install Emo"
 * (ui.md §12.8). Browsers without it (Safari, Firefox) never
 * show the button.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let offer: InstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

function tell() {
  for (const fn of listeners) fn(offer !== null);
}

export function watchInstallOffer(): void {
  globalThis.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // shown from our button instead of the mini-infobar
    offer = e as InstallPromptEvent;
    tell();
  });
  globalThis.addEventListener("appinstalled", () => {
    offer = null;
    tell();
  });
}

/** Called now and on every change; returns the unsubscribe. */
export function onInstallOffer(fn: (available: boolean) => void): () => void {
  listeners.add(fn);
  fn(offer !== null);
  return () => listeners.delete(fn);
}

/** The browser's install dialog, from a tap; true when installed. */
export async function install(): Promise<boolean> {
  const event = offer;
  if (!event) return false;
  offer = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  tell();
  return outcome === "accepted";
}
