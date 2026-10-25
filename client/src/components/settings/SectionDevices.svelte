<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Devices: this account's sessions with Revoke for the others (revoking
   * only stops that device's sync), and "Sign out on this device", which ends
   * this session and removes the local data after naming unsynced check-ins.
   * Specification: ui.md §11.6, api.md §2.4,
   * reliability.md §1.4.
   */
  import "./settings.css";
  import { onMount } from "svelte";
  import type { SessionItem } from "../../../../shared/protocol.ts";
  import { apiListSessions, apiRevokeSession } from "../../lib/api.ts";
  import { deviceName, timeAgo } from "../../lib/devices.ts";
  import { signOutDevice, unsyncedCount } from "../../lib/session.ts";
  import { getLocale, t, tn } from "../../lib/i18n.svelte.ts";
  import ConfirmSheet from "../common/ConfirmSheet.svelte";

  interface Props {
    signedOut: boolean;
    onSignIn: () => void;
    onLoggedOut: () => void;
  }

  let { signedOut, onSignIn, onLoggedOut }: Props = $props();

  let sessions = $state<SessionItem[]>([]);
  let revoking = $state<SessionItem | null>(null);
  let signOutSheet = $state<{ unsynced: number } | null>(null);
  let busy = $state(false);

  onMount(load);

  async function load() {
    if (signedOut) return;
    try {
      sessions = (await apiListSessions()).items;
    } catch {
      // Offline: no list, sign out still works
    }
  }

  const label = (s: SessionItem) => deviceName(s.user_agent) ?? t("settings.devices.unknown");

  async function revoke() {
    if (!revoking) return;
    busy = true;
    try {
      await apiRevokeSession(revoking.id);
      await load();
    } finally {
      busy = false;
      revoking = null;
    }
  }

  async function openSignOut() {
    signOutSheet = { unsynced: await unsyncedCount() };
  }

  async function signOut() {
    busy = true;
    await signOutDevice();
    onLoggedOut();
  }
</script>

<section class="settings-section">
  <h2 class="section-header">{t("settings.devices.header")}</h2>
  <div class="settings-card">
    {#if signedOut}
      <div class="settings-row">
        <span>{t("settings.devices.signedOut")}</span>
        <button type="button" class="settings-link" onclick={onSignIn}>
          {t("settings.devices.signIn")}
        </button>
      </div>
    {:else}
      {#each sessions as s (s.id)}
        <div class="settings-row">
          <span class="device">
            <span>{label(s)}</span>
            <span class="row-sub">
              {s.current
                ? t("settings.devices.thisDevice")
                : t("settings.devices.lastSeen", { ago: timeAgo(s.last_seen_at, getLocale()) })}
            </span>
          </span>
          {#if !s.current}
            <button type="button" class="settings-link text-action" onclick={() => (revoking = s)}>
              {t("settings.devices.revoke")}
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
  <button type="button" class="settings-link sign-out text-action" onclick={openSignOut}>
    {t("settings.devices.signOut")}
  </button>
</section>

{#if revoking}
  <ConfirmSheet
    title={t("settings.devices.revoke")}
    confirmLabel={t("settings.devices.revoke")}
    {busy}
    onconfirm={revoke}
    oncancel={() => (revoking = null)}
  >
    <p>{t("settings.devices.revoke.confirm", { device: label(revoking) })}</p>
  </ConfirmSheet>
{/if}

{#if signOutSheet}
  <ConfirmSheet
    title={t("settings.devices.signOut")}
    confirmLabel={signOutSheet.unsynced > 0
      ? tn("settings.devices.signOut.discard", signOutSheet.unsynced)
      : t("settings.devices.signOut")}
    destructive={signOutSheet.unsynced > 0}
    {busy}
    onconfirm={signOut}
    oncancel={() => (signOutSheet = null)}
  >
    <p>{t("settings.devices.signOut.confirm")}</p>
  </ConfirmSheet>
{/if}

<style>
  .device {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .sign-out {
    align-self: flex-start;
    margin: 0 0.25rem;
  }

  /* A phone: at the right edge (settings.css) */
  @media (max-width: 899px) {
    .sign-out {
      align-self: flex-end;
    }
  }
</style>
