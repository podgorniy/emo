<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Shown at start while `meta.recovery_pending` is set: the last recovery key
   * was shown but never saved (a reload, a crash, a closed tab). The
   * passphrase issues a new one (keyring rev + 1); the unsaved key stops
   * working. Specification: architecture.md §4.1, §5.3; todo H48.
   */
  import "./auth.css";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { changeKeyring } from "../../lib/keyring.ts";
  import { setRecoveryPending } from "../../lib/recoveryPending.ts";
  import { userError } from "../../lib/errors.ts";
  import { t } from "../../lib/i18n.svelte.ts";
  import Button from "../common/Button.svelte";
  import LangSwitch from "../common/LangSwitch.svelte";
  import RecoveryKeyDisplay from "./RecoveryKeyDisplay.svelte";

  interface Props {
    accountId: string;
    onDone: () => void;
    /** "Use a different account": the device's clear-or-keep screen */
    onSwitchAccount: () => void;
  }

  let { accountId, onDone, onSwitchAccount }: Props = $props();

  let passphrase = $state("");
  let busy = $state(false);
  let errorKey = $state<MessageKey | null>(null);
  let newKey = $state<string | null>(null);

  async function issue(e: Event) {
    e.preventDefault();
    if (!passphrase) return;
    busy = true;
    errorKey = null;
    try {
      newKey = (await changeKeyring(accountId, passphrase, { newRecoveryKey: true }))
        .newRecoveryKeyFormatted;
    } catch (err) {
      errorKey = err instanceof DOMException || (err as Error)?.name === "OperationError"
        ? "auth.unlock.wrong"
        : userError(err).key;
    } finally {
      busy = false;
    }
  }

  async function saved() {
    await setRecoveryPending(false);
    onDone();
  }
</script>

{#if newKey}
  <RecoveryKeyDisplay recoveryKey={newKey} step={null} onConfirmed={saved} onLeave={onSwitchAccount} />
{:else}
  <main class="auth-screen">
    <div class="auth-card">
      <h1 class="auth-title">{t("auth.recovery.pending.title")}</h1>
      <p class="auth-body">{t("auth.recovery.pending.body")}</p>
      {#if errorKey}<p class="auth-error" role="alert">{t(errorKey)}</p>{/if}
      <form class="auth-form" onsubmit={issue}>
        <div class="auth-field">
          <label for="pending-pass">{t("auth.passphrase.title")}</label>
          <input
            id="pending-pass"
            type="password"
            class="auth-input fx-field"
            autocomplete="current-password"
            bind:value={passphrase}
          />
        </div>
        <Button type="submit" variant="primary" size="large" loading={busy} disabled={!passphrase}>
          {busy ? t("auth.passphrase.deriving") : t("common.next")}
        </Button>
        <button type="button" class="auth-link" disabled={busy} onclick={onSwitchAccount}>
          {t("auth.signin.again.switch")}
        </button>
      </form>
    </div>
    <LangSwitch />
  </main>
{/if}
