<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Step 1 of 3 — the passphrase. English characters only, 8 or more; the
   * strength meter informs and never blocks (`NewPassphrase`).
   * Specification: ui.md §12.5, architecture.md §4.1.
   */
  import "./auth.css";
  import { validatePassphrase } from "../../../../shared/passphrase/validator.ts";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { setupKeyring } from "../../lib/crypto.ts";
  import { apiPutKeyring } from "../../lib/api.ts";
  import { rememberUploadedKeyring } from "../../lib/session.ts";
  import { setRecoveryPending } from "../../lib/recoveryPending.ts";
  import { userError } from "../../lib/errors.ts";
  import { t } from "../../lib/i18n.svelte.ts";
  import { sessionEmail } from "../../lib/sessionEmail.ts";
  import Button from "../common/Button.svelte";
  import LangSwitch from "../common/LangSwitch.svelte";
  import NewPassphrase from "./NewPassphrase.svelte";

  interface Props {
    accountId: string;
    onCompleted: (recoveryKeyFormatted: string) => void;
    /** "Use a different account": the device's clear-or-keep screen */
    onSwitchAccount: () => void;
  }

  let { accountId, onCompleted, onSwitchAccount }: Props = $props();

  let passphrase = $state("");
  let repeat = $state("");
  let loading = $state(false);
  /** The key takes more than 3 s on this device (performance.md §3.1) */
  let slow = $state(false);
  let errorKey = $state<MessageKey | null>(null);
  /** For password managers: the address signed in with, never stored */
  const username = sessionEmail();

  const validation = $derived(validatePassphrase(passphrase));
  const canSubmit = $derived(validation.valid && repeat === passphrase && !loading);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    loading = true;
    errorKey = null;
    const slowTimer = setTimeout(() => (slow = true), 3000);
    try {
      const { keyringPut, recoveryKeyFormatted, authProofB64 } = await setupKeyring(
        accountId,
        passphrase,
      );
      // H48: from the upload on, an unsaved key is noticed at the next start
      await setRecoveryPending(true);
      // Upload revision 1, then keep it for offline unlocks
      const uploaded = await apiPutKeyring(1, keyringPut, authProofB64);
      await rememberUploadedKeyring(keyringPut, uploaded.rev);
      onCompleted(recoveryKeyFormatted);
    } catch (err) {
      errorKey = (err as Error)?.name === "KdfUnsupported"
        ? "auth.passphrase.kdfUnsupported"
        : userError(err).key;
    } finally {
      clearTimeout(slowTimer);
      slow = false;
      loading = false;
    }
  }
</script>

<main class="auth-screen">
  <div class="auth-card">
    <p class="auth-step">{t("auth.step", { n: 1 })}</p>
    <h1 class="auth-title">{t("auth.passphrase.title")}</h1>
    <p class="auth-body">{t("auth.passphrase.body")}</p>

    {#if errorKey}
      <p class="auth-error" role="alert">{t(errorKey)}</p>
    {/if}

    <form onsubmit={handleSubmit} class="auth-form">
      <!-- For password managers: the address this passphrase belongs to -->
      {#if username}
        <input type="text" name="username" autocomplete="username" value={username} readonly hidden />
      {/if}
      <NewPassphrase bind:passphrase bind:repeat idPrefix="setup" autofocus disabled={loading} />

      <p class="auth-info">{t("auth.passphrase.warning")}</p>
      {#if slow}<p class="auth-hint" role="status">{t("auth.passphrase.derivingSlow")}</p>{/if}

      <Button type="submit" variant="primary" size="large" loading={loading} disabled={!canSubmit}>
        {loading ? t("auth.passphrase.deriving") : t("common.next")}
      </Button>
      <button type="button" class="auth-link" disabled={loading} onclick={onSwitchAccount}>
        {t("auth.signin.again.switch")}
      </button>
    </form>
  </div>
  <LangSwitch />
</main>
