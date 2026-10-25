// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The sign-in and key screens, loaded as one lazy chunk
 * (performance.md §3.3): an unlocked device opens Home without them.
 */
export { default as AccountSwitch } from "./AccountSwitch.svelte";
export { default as Login } from "./Login.svelte";
export { default as OnboardingFinish } from "./OnboardingFinish.svelte";
export { default as PassphraseSetup } from "./PassphraseSetup.svelte";
export { default as PassphraseUnlock } from "./PassphraseUnlock.svelte";
export { default as RecoveryKeyDisplay } from "./RecoveryKeyDisplay.svelte";
export { default as RecoveryPending } from "./RecoveryPending.svelte";
export { default as RecoveryUnlock } from "./RecoveryUnlock.svelte";
