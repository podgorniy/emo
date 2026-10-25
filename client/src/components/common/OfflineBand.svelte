<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The offline band: one quiet line at the top of every screen while Emo
   * does not answer (lib/network.ts). It says which of the two it is: "Offline"
   * when the device itself reports no network, otherwise "Can't reach the
   * server" (a server down behind its proxy, a network without internet).
   * App moves the screens down by its height through `--safe-top`, so it
   * never covers a control. The live region stays mounted, so screen readers
   * hear the change. Specification: ui.md §3.6.
   */
  import { onDestroy } from "svelte";
  import { deviceOnline, onDeviceOnlineChange } from "../../lib/network.ts";
  import { t } from "../../lib/i18n.svelte.ts";

  let { offline }: { offline: boolean } = $props();

  let online = $state(deviceOnline());
  onDestroy(onDeviceOnlineChange((o) => (online = o)));
  const label = $derived(online ? t("common.unreachable") : t("common.offline"));
  const spoken = $derived(online ? t("errors.unreachable") : t("errors.offline"));
</script>

<div role="status" aria-live="polite">
  {#if offline}
    <div class="offline-band" title={spoken}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 19h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.2 5 5 0 0 0 7 19z" />
        <path d="M3 3l18 18" />
      </svg>
      <span aria-hidden="true">{label}</span>
      <span class="sr-only">{spoken}</span>
    </div>
  {/if}
</div>

<style>
  /* 24 px: the same as the reserve in App.svelte (.app-root.offline) */
  .offline-band {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 60;
    height: calc(env(safe-area-inset-top, 0px) + 24px);
    padding-top: env(safe-area-inset-top, 0px);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: var(--c-ground, #e4edf1);
    border-bottom: 1px solid var(--c-line, #e2e8f0);
    color: var(--c-muted, #5c6670);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.01em;
    user-select: none;
  }

  svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
