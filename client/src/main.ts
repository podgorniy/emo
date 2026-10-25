// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from "svelte";
// The theme fonts' @font-face rules (tools/gen_fonts.ts); a face downloads
// only when the active theme uses it and the page shows its script
import "./fonts.css";
// The shared looks and motion (ui.md §5.1, §14.4): buttons,
// fields, segmented controls, View Transitions; and the one class every
// answer control wears, so a null answer cannot look different (principle 4)
import "./fx.css";
import "./components/flow/answer.css";
import App from "./App.svelte";
import { initServiceWorker } from "./lib/update.ts";
import { watchInstallOffer } from "./lib/install.ts";
import { installKdfWorker } from "./lib/kdf.ts";
import { startViewportWatch } from "./lib/viewport.ts";
import { startLayout } from "./lib/layout.svelte.ts";

// Argon2id in a Worker, loaded only when a passphrase is entered
installKdfWorker();

// iOS Safari applies :active only to pages that listen to touches: without
// this every press state is dead on an iPhone (ui.md §5.1)
document.addEventListener("touchstart", () => {}, { passive: true });
// @property (Firefox only from 128): the busy light's moving angle needs it;
// without it the button keeps its spinner
if (typeof CSS !== "undefined" && "registerProperty" in CSS) {
  document.documentElement.classList.add("fx-prop");
}

// The visual viewport, the keyboard and the layout, before the first screen
// is laid out (ui.md §4.5): --vvh, --kb, data-kb, data-short
startViewportWatch();
startLayout();

const target = document.getElementById("app");
if (!target) {
  throw new Error("Target #app element not found");
}

const app = mount(App, {
  target,
});

// After the first paint (reliability.md §3)
initServiceWorker();
// Kept for onboarding's "Install Emo" (ui.md §12.8)
watchInstallOffer();

export default app;
