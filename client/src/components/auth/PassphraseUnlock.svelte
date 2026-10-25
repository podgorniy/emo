<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Unlock on a known device: the passphrase field and "Use recovery key".
   * The keyring kept on the device works offline; the server's revisions are
   * read only when it does not open (`lib/unlock.ts`: a damaged keyring, the
   * revision fallback, the 30 s wait after 5 wrong tries).
   * Specification: ui.md §12, reliability.md §1.2, §5.2.
   */
  import "./auth.css";
  import { onDestroy, onMount } from "svelte";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { unlockDevice, unlockWaitSeconds } from "../../lib/unlock.ts";
  import { fetchKeyring } from "../../lib/session.ts";
  import { t } from "../../lib/i18n.svelte.ts";
  import { sessionEmail } from "../../lib/sessionEmail.ts";
  import Button from "../common/Button.svelte";
  import PassphraseInput from "../common/PassphraseInput.svelte";

  interface Props {
    accountId: string;
    /** Right after a sign-in on a device that did not hold this account */
    newDevice?: boolean;
    onUnlocked: () => void;
    onNeedRecovery: () => void;
  }

  let { accountId, newDevice = false, onUnlocked, onNeedRecovery }: Props = $props();

  let passphrase = $state("");
  let loading = $state(false);
  let slow = $state(false);
  let errorKey = $state<MessageKey | null>(null);
  /** Seconds left before the next try (after 5 wrong ones), counting down. */
  let wait = $state(0);
  let field = $state<HTMLInputElement | null>(null);
  /** For password managers: the address signed in with, never stored */
  const username = sessionEmail();
  let ticker: ReturnType<typeof setInterval> | null = null;

  function countDown(seconds: number) {
    wait = seconds;
    if (ticker) clearInterval(ticker);
    ticker = setInterval(() => {
      wait = Math.max(0, wait - 1);
      if (wait === 0 && ticker) {
        clearInterval(ticker);
        ticker = null;
        field?.focus();
      }
    }, 1000);
  }

  onMount(async () => {
    field?.focus();
    const seconds = await unlockWaitSeconds();
    if (seconds > 0) countDown(seconds);
  });
  onDestroy(() => {
    if (ticker) clearInterval(ticker);
  });

  async function handleUnlock(e: Event) {
    e.preventDefault();
    if (!passphrase || wait > 0) return;
    loading = true;
    errorKey = null;
    const slowTimer = setTimeout(() => (slow = true), 3000);
    try {
      const result = await unlockDevice(accountId, passphrase);
      if (result.kind === "ok") {
        void fetchKeyring();
        onUnlocked();
        return;
      }
      errorKey = result.kind === "damaged"
        ? "auth.unlock.keyringDamaged"
        : result.kind === "offline"
        ? "errors.offline"
        : result.kind === "wait"
        ? null
        : "auth.unlock.wrong";
      if (result.kind === "wait") countDown(result.seconds);
      if (result.kind === "wrong") {
        // Kept and selected: one typo is fixed, not the whole phrase retyped
        const seconds = await unlockWaitSeconds();
        if (seconds > 0) countDown(seconds);
        field?.focus();
        field?.select();
      }
    } catch (err) {
      errorKey = (err as Error)?.name === "KdfUnsupported"
        ? "auth.passphrase.kdfUnsupported"
        : "errors.generic";
    } finally {
      clearTimeout(slowTimer);
      slow = false;
      loading = false;
    }
  }
</script>

<main class="auth-screen">
  <div class="auth-card">
    <h1 class="auth-title">{t(newDevice ? "auth.newDevice.title" : "auth.unlock.title")}</h1>
    <p class="auth-body">{t(newDevice ? "auth.newDevice.body" : "auth.unlock.body")}</p>

    {#if errorKey}
      <p class="auth-error" role="alert">{t(errorKey)}</p>
    {/if}
    {#if wait > 0}
      <p class="auth-hint" role="status">{t("auth.unlock.wait", { s: wait })}</p>
    {/if}

    <form onsubmit={handleUnlock} class="auth-form">
      <!-- For password managers: the address this passphrase belongs to -->
      {#if username}
        <input type="text" name="username" autocomplete="username" value={username} readonly hidden />
      {/if}
      <div class="auth-field">
        <label for="unlock-passphrase">{t("auth.passphrase.title")}</label>
        <PassphraseInput
          id="unlock-passphrase"
          autocomplete="current-password"
          bind:value={passphrase}
          bind:input={field}
          invalid={errorKey === "auth.unlock.wrong"}
        />
      </div>

      <Button type="submit" variant="primary" size="large" loading={loading} disabled={!passphrase || wait > 0}>
        {loading ? t("auth.passphrase.deriving") : t("auth.unlock.title")}
      </Button>

      {#if slow}<p class="auth-hint" role="status">{t("auth.passphrase.derivingSlow")}</p>{/if}

      <button type="button" class="auth-link" onclick={onNeedRecovery}>
        {t("auth.unlock.useRecovery")}
      </button>
    </form>
  </div>
</main>
