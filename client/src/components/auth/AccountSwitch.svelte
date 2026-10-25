<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * One account per browser (reliability.md §1.3): the account set up here or
   * another one, and the person chooses with what clearing would lose in front
   * of them. After signing in as another account (`email`), or before ("Use a
   * different account" on the sign-in screen). Check-ins only on this device
   * take a second tap that repeats their count.
   * Specification: ui.md §12.4.
   */
  import "./auth.css";
  import { onMount } from "svelte";
  import { maskEmail } from "../../lib/errors.ts";
  import { t, tn } from "../../lib/i18n.svelte.ts";
  import Button from "../common/Button.svelte";
  import LangSwitch from "../common/LangSwitch.svelte";
  import ConfirmSheet from "../common/ConfirmSheet.svelte";

  interface Props {
    /** The address just signed in with; null before a sign-in */
    email: string | null;
    /** Check-ins on this device, and those of them the server lacks */
    entries: number;
    unsynced: number;
    onClear: () => Promise<void>;
    onBack: () => void;
  }

  let { email, entries, unsynced, onClear, onBack }: Props = $props();

  let confirming = $state(false);
  let busy = $state(false);
  let heading: HTMLElement | undefined = $state();

  // The screen replaces the one the person acted on: start reading here
  onMount(() => heading?.focus({ preventScroll: true }));

  async function clear() {
    if (unsynced > 0 && !confirming) {
      confirming = true;
      return;
    }
    busy = true;
    try {
      await onClear();
    } finally {
      busy = false;
      confirming = false;
    }
  }
</script>

<main class="auth-screen">
  <div class="auth-card">
    <h1 class="auth-title" tabindex="-1" bind:this={heading}>
      {email ? t("auth.switch.title") : t("auth.switch.confirmTitle")}
    </h1>
    {#if email}
      <p class="auth-body">{t("auth.switch.signedInAs", { email: maskEmail(email) })}</p>
    {/if}
    <p class="auth-body">
      {entries > 0 ? tn("auth.switch.entries", entries) : t("auth.switch.noEntries")}
    </p>
    {#if unsynced > 0}
      <p class="auth-body">{tn("auth.switch.unsynced", unsynced)}</p>
    {/if}
    <p class="auth-body explain">{t("auth.switch.explain")}</p>
    <div class="auth-form">
      <Button variant="primary" size="large" loading={busy && !confirming} onclick={clear}>
        {t("auth.switch.clear")}
      </Button>
      <button type="button" class="auth-link" disabled={busy} onclick={onBack}>
        {t("common.back")}
      </button>
    </div>
  </div>
  <LangSwitch />
</main>

{#if confirming}
  <ConfirmSheet
    title={t("auth.switch.clear")}
    confirmLabel={tn("settings.devices.signOut.discard", unsynced)}
    destructive
    {busy}
    onconfirm={clear}
    oncancel={() => (confirming = false)}
  >
    <p>{tn("auth.switch.unsynced", unsynced)}</p>
  </ConfirmSheet>
{/if}

<style>
  .auth-title:focus {
    outline: none;
  }

  .explain {
    color: var(--c-muted, #718096);
    font-size: 0.9375rem;
  }
</style>
