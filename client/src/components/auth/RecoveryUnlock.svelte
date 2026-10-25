<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * "Use recovery key": the 32 characters (grouped and normalised as they are
   * typed, checksum checked before any decryption) in a two-line field laid
   * out like the key card (4 groups a line), a new passphrase, then a new
   * recovery key shown once — which the body says up front (UX-15).
   * Specification: ui.md §12, architecture.md §5.1, §5.3.
   */
  import "./auth.css";
  import type { KeyringItem } from "../../../../shared/protocol.ts";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { validatePassphrase } from "../../../../shared/passphrase/validator.ts";
  import {
    formatRecoveryInput,
    parseRecoveryKey,
    RECOVERY_KEY_LENGTH,
  } from "../../../../shared/crypto/recovery.ts";
  import { recoverAndUpload } from "../../lib/keyring.ts";
  import { setRecoveryPending } from "../../lib/recoveryPending.ts";
  import { userError } from "../../lib/errors.ts";
  import { t } from "../../lib/i18n.svelte.ts";
  import { onMount } from "svelte";
  import { sessionEmail } from "../../lib/sessionEmail.ts";
  import Button from "../common/Button.svelte";
  import NewPassphrase from "./NewPassphrase.svelte";
  import RecoveryKeyDisplay from "./RecoveryKeyDisplay.svelte";

  interface Props {
    accountId: string;
    currentKeyring: KeyringItem;
    /** Called after the server stored the new keyring and the user saw the new key. */
    onRecovered: () => void;
    onCancel: () => void;
  }

  let { accountId, currentKeyring, onRecovered, onCancel }: Props = $props();

  let keyInput = $state("");
  let newPassphrase = $state("");
  let repeat = $state("");
  let errorKey = $state<MessageKey | null>(null);
  let busy = $state(false);
  /** null while incomplete; then whether the checksum matches */
  let checksumOk = $state<boolean | null>(null);
  // Set only once the server has stored the new keyring revision
  let newKey = $state<string | null>(null);
  let keyField = $state<HTMLTextAreaElement | null>(null);
  /** For password managers: the address signed in with, never stored */
  const username = sessionEmail();

  /** "AAAA-BBBB-…" as on the key card: 4 groups a line, two lines */
  function asCard(formatted: string): string {
    const groups = formatted ? formatted.split("-") : [];
    const lines = [groups.slice(0, 4).join(" "), groups.slice(4).join(" ")];
    return lines[1] ? lines.join("\n") : lines[0];
  }

  onMount(() => keyField?.focus());

  const complete = $derived(keyInput.replaceAll("-", "").length === RECOVERY_KEY_LENGTH);
  const validation = $derived(validatePassphrase(newPassphrase));
  const canSubmit = $derived(
    checksumOk === true && validation.valid && newPassphrase === repeat && !busy,
  );

  $effect(() => {
    const value = keyInput;
    if (!complete) {
      checksumOk = null;
      return;
    }
    parseRecoveryKey(value).then((r) => {
      if (value === keyInput) checksumOk = r.valid;
    });
  });

  function onKeyInput(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    keyInput = formatRecoveryInput(el.value);
    el.value = asCard(keyInput);
  }

  async function recover(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    busy = true;
    errorKey = null;
    try {
      await setRecoveryPending(true);
      const res = await recoverAndUpload(accountId, keyInput, newPassphrase, currentKeyring);
      newKey = res.newRecoveryKeyFormatted;
    } catch (err) {
      // A well-formed key that does not open this keyring
      errorKey = err instanceof DOMException || (err as Error)?.name === "OperationError"
        ? "auth.recoverFlow.wrong"
        : userError(err).key;
    } finally {
      busy = false;
    }
  }
</script>

{#if newKey}
  <RecoveryKeyDisplay
    recoveryKey={newKey}
    step={null}
    onConfirmed={async () => {
      await setRecoveryPending(false);
      onRecovered();
    }}
  />
{:else}
  <main class="auth-screen">
    <div class="auth-card">
      <h1 class="auth-title">{t("auth.recoverFlow.title")}</h1>
      <p class="auth-body">{t("auth.recoverFlow.body")}</p>

      {#if errorKey}
        <p class="auth-error" role="alert">{t(errorKey)}</p>
      {/if}

      <form class="auth-form" onsubmit={recover}>
        <!-- For password managers: the address this passphrase belongs to -->
        {#if username}
          <input type="text" name="username" autocomplete="username" value={username} readonly hidden />
        {/if}
        <div class="auth-field">
          <label for="recovery-key">{t("auth.recovery.key.aria")}</label>
          <textarea
            id="recovery-key"
            rows="2"
            class="auth-input fx-field mono key"
            value={asCard(keyInput)}
            oninput={onKeyInput}
            bind:this={keyField}
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            aria-invalid={checksumOk === false}
            aria-describedby="recovery-check"
          ></textarea>
          <p id="recovery-check" class="auth-hint" role="status">
            {checksumOk === false ? t("auth.recoverFlow.checksum") : ""}
          </p>
        </div>

        <NewPassphrase bind:passphrase={newPassphrase} bind:repeat idPrefix="recover" disabled={busy} />

        <p class="auth-info">{t("auth.passphrase.warning")}</p>

        <Button type="submit" variant="primary" size="large" disabled={!canSubmit} loading={busy}>
          {busy ? t("auth.passphrase.deriving") : t("common.next")}
        </Button>
        <button type="button" class="auth-link" onclick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
      </form>
    </div>
  </main>
{/if}

<style>
  /* Two lines of four groups, like the key card: the 8 × 4 characters can
     be compared with what was written down, nothing scrolls sideways */
  .key {
    min-height: 0;
    resize: none;
    overflow-x: auto;
    overflow-y: hidden;
    white-space: pre;
    font-size: min(1.125rem, 4.6vw);
    line-height: 1.6;
  }
</style>
