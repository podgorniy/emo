<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Data and keys: export (JSONL, CSV, reminder log, encrypted copy), change
   * passphrase, new recovery key, lock on this device, copy diagnostics, and
   * "Delete account" behind a sheet that asks for the passphrase (the key is
   * unwrapped here first, and the proof is derived from it). Quiet lines appear
   * only when they apply.
   * Specification: ui.md §11.7, architecture.md §4.5, §5.3,
   * §10.1; reliability.md §1.8, §5.1; api.md §2.3, §2.5.
   */
  import "./settings.css";
  import { onMount } from "svelte";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { validatePassphrase } from "../../../../shared/passphrase/validator.ts";
  import { deriveAuthKey } from "../../../../shared/crypto/e2e.ts";
  import { encodeBase64Url } from "../../../../shared/crypto/encoding.ts";
  import { unwrapDekWithPassphrase } from "../../../../shared/crypto/keyring.ts";
  import { apiDeleteAccount } from "../../lib/api.ts";
  import { userError } from "../../lib/errors.ts";
  import { cachedKeyring, fetchKeyring, wipeThisDevice } from "../../lib/session.ts";
  import { changeKeyring, FALLBACK_KEY, resaveKeyring } from "../../lib/keyring.ts";
  import { diagnosticsText } from "../../lib/diag.ts";
  import { setRecoveryPending } from "../../lib/recoveryPending.ts";
  import { getLocale, t, tn } from "../../lib/i18n.svelte.ts";
  import { getMeta } from "../../lib/db.ts";
  import { unsavedCount } from "../../lib/sync.ts";
  import { sessionEmail } from "../../lib/sessionEmail.ts";
  import { openSheet } from "../../lib/sheets.ts";
  import ConfirmSheet from "../common/ConfirmSheet.svelte";
  import PassphraseInput from "../common/PassphraseInput.svelte";
  import NewPassphrase from "../auth/NewPassphrase.svelte";
  import RecoveryKeyDisplay from "../auth/RecoveryKeyDisplay.svelte";

  interface Props {
    accountId: string;
    onLock: () => void;
    onLoggedOut: () => void;
  }

  let { accountId, onLock, onLoggedOut }: Props = $props();

  type Sheet = "export" | "passphrase" | "recovery" | "resave" | "delete" | null;
  let sheet = $state<Sheet>(null);
  let busy = $state(false);
  let errorKey = $state<MessageKey | null>(null);
  let passphrase = $state("");
  let newPassphrase = $state("");
  let repeat = $state("");
  let csvLabels = $state(true);
  let preparing = $state<number | null>(null);
  let doneKey = $state<MessageKey | null>(null);
  let newKey = $state<string | null>(null);
  let copied = $state(false);
  /** The current-passphrase field of the open sheet: a wrong one is selected */
  let passField = $state<HTMLInputElement | null>(null);
  /** For password managers: the address signed in with, never stored */
  const username = sessionEmail();
  let storageFull = $state(false);
  /** reliability.md §1.2, data.md §8.1: entries kept but not readable here */
  /** Unlock had to use an older keyring revision (reliability.md §1.2) */
  let fallback = $state(false);
  let corrupt = $state(0);
  let newer = $state(0);
  /** Minutes the device clock is off; shown from 5 (reliability.md §1.1) */
  let skewMin = $state(0);

  const newValid = $derived(validatePassphrase(newPassphrase));

  onMount(async () => {
    corrupt = ((await getMeta<number>("undecryptable")) ?? 0) +
      ((await getMeta<number>("invalid_entries")) ?? 0);
    newer = (await getMeta<number>("needs_newer_app")) ?? 0;
    fallback = (await getMeta<boolean>(FALLBACK_KEY)) === true;
    skewMin = Math.round(Math.abs((await getMeta<number>("clock_skew_sec")) ?? 0) / 60);
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota && est.usage) storageFull = est.usage / est.quota > 0.8;
    } catch {
      // Unknown: no line
    }
  });

  function open(next: Sheet) {
    sheet = next;
    errorKey = null;
    doneKey = null;
    savedFiles = null;
    partial = false;
    passphrase = "";
    newPassphrase = "";
    repeat = "";
  }

  function close() {
    if (!busy) sheet = null;
  }

  async function run(fn: () => Promise<void>) {
    busy = true;
    errorKey = null;
    try {
      await fn();
    } catch (err) {
      errorKey = (err as Error)?.name === "OperationError" || err instanceof DOMException
        ? "auth.unlock.wrong"
        : userError(err).key;
    } finally {
      busy = false;
      preparing = null;
    }
    // Kept and selected: one typo is fixed, not the whole phrase retyped
    if (errorKey === "auth.unlock.wrong") {
      passField?.focus();
      passField?.select();
    }
  }

  // The export code is its own chunk, fetched on the first export
  // (performance.md §3.3)
  const exporter = () => import("../../lib/export.ts");
  const onProgress = (n: number) => (preparing = n);
  /** The names just downloaded, shown as "Saved {filename}" (UX-23) */
  let savedFiles = $state<string | null>(null);
  /** The last export lacks check-ins only the server has (export.ts) */
  let partial = $state(false);
  const saving = (fn: () => Promise<{ files: string[]; partial: boolean }>) =>
    run(async () => {
      savedFiles = null;
      partial = false;
      const result = await fn();
      savedFiles = result.files.join(", ");
      partial = result.partial;
    });
  const exportJ = () =>
    saving(async () => (await exporter()).exportJsonl(accountId, onProgress));
  const exportC = () =>
    saving(async () =>
      (await exporter()).exportCsv(accountId, csvLabels ? getLocale() : undefined, onProgress)
    );
  const exportR = () => saving(async () => (await exporter()).exportReminders(accountId));
  const exportB = () => saving(async () => (await exporter()).exportBundle(accountId));

  const changePassphrase = () =>
    run(async () => {
      await changeKeyring(accountId, passphrase, { newPassphrase });
      doneKey = "common.done";
      sheet = null;
    });

  const resaveKeys = () =>
    run(async () => {
      await resaveKeyring(accountId, passphrase);
      fallback = false;
      doneKey = "common.done";
      sheet = null;
    });

  const makeRecoveryKey = () =>
    run(async () => {
      // H48: until the new key is saved, the app keeps asking for it
      await setRecoveryPending(true);
      const r = await changeKeyring(accountId, passphrase, { newRecoveryKey: true });
      newKey = r.newRecoveryKeyFormatted;
      sheet = null;
    });

  // The new key's overlay is a dialog with a history entry, like a sheet
  // (lib/sheets.ts), but Back keeps it: the key is shown once, and saying it
  // is kept is the only way out
  $effect(() => {
    if (!newKey) return;
    return openSheet(() => false).release;
  });

  /**
   * And a modal one (aria-modal): focus moves into it and stays there, and
   * nothing behind it takes a tap, a key or a screen reader's cursor, so the
   * only copy of the key is never left by a key press meant for it. Once it
   * goes, focus is back on "New recovery key".
   */
  let overlayEl = $state<HTMLElement | null>(null);
  let recoveryRow = $state<HTMLElement | null>(null);
  $effect(() => {
    const el = overlayEl;
    if (!el) return;
    const behind: HTMLElement[] = [];
    for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
      for (const other of node.parentElement?.children ?? []) {
        if (other !== node && other instanceof HTMLElement && !other.inert) {
          other.inert = true;
          behind.push(other);
        }
      }
    }
    el.focus({ preventScroll: true });
    // The closing sheet gives focus back behind it: taken back
    const keep = (e: FocusEvent) => {
      if (!el.contains(e.target as Node)) el.focus({ preventScroll: true });
    };
    // Tab goes round inside it, as in a sheet (ConfirmSheet)
    const round = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const stops = [
        ...el.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled)"),
      ];
      const at = document.activeElement;
      if (stops.length === 0) {
        e.preventDefault();
      } else if (e.shiftKey && (at === stops[0] || at === el)) {
        e.preventDefault();
        stops[stops.length - 1].focus();
      } else if (!e.shiftKey && at === stops[stops.length - 1]) {
        e.preventDefault();
        stops[0].focus();
      }
    };
    document.addEventListener("focusin", keep);
    el.addEventListener("keydown", round);
    return () => {
      document.removeEventListener("focusin", keep);
      el.removeEventListener("keydown", round);
      for (const other of behind) other.inert = false;
      recoveryRow?.focus({ preventScroll: true });
    };
  });

  async function recoveryKeySaved() {
    await setRecoveryPending(false);
    newKey = null;
  }

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(await diagnosticsText());
      copied = true;
    } catch {
      errorKey = "errors.generic";
    }
  }

  const deleteAccount = () =>
    run(async () => {
      const keyring = (await fetchKeyring()) ?? (await cachedKeyring());
      if (!keyring) throw new TypeError("offline");
      const dek = await unwrapDekWithPassphrase(keyring, accountId, passphrase);
      let proof;
      try {
        proof = encodeBase64Url(await deriveAuthKey(dek, accountId));
      } finally {
        dek.fill(0);
      }
      await apiDeleteAccount(proof);
      await wipeThisDevice();
      onLoggedOut();
    });
</script>

<section class="settings-section">
  <h2 class="section-header">{t("settings.data.header")}</h2>
  <div class="settings-card">
    <button type="button" class="settings-row row-button" onclick={() => open("export")}>
      {t("settings.data.export")}
    </button>
    <button type="button" class="settings-row row-button" onclick={() => open("passphrase")}>
      {t("settings.data.changePassphrase")}
    </button>
    <button
      type="button"
      class="settings-row row-button"
      onclick={() => open("recovery")}
      bind:this={recoveryRow}
    >
      {t("settings.data.newRecoveryKey")}
    </button>
    {#if fallback}
      <button type="button" class="settings-row row-button stacked" onclick={() => open("resave")}>
        <span>{t("settings.data.resaveKeys")}</span>
        <span class="row-sub">{t("settings.data.resaveKeys.hint")}</span>
      </button>
    {/if}
    <button type="button" class="settings-row row-button stacked" onclick={onLock}>
      <span>{t("settings.data.lock")}</span>
      <span class="row-sub">{t("settings.data.lock.hint")}</span>
    </button>
    <button type="button" class="settings-row row-button stacked" onclick={copyDiagnostics}>
      <span>{copied ? t("common.copied") : t("settings.data.diagnostics")}</span>
      <span class="row-sub">{t("settings.data.diagnostics.hint")}</span>
    </button>
  </div>
  {#if doneKey}<p class="settings-note" role="status">{t(doneKey)}</p>{/if}
  {#if unsavedCount() > 0}
    <!-- reliability.md §1.1: entries held in memory until there is room -->
    <p class="settings-note" role="status">{t("errors.storageFull")}</p>
  {:else if storageFull}<p class="settings-note">{t("settings.data.storageNearlyFull")}</p>{/if}
  {#if skewMin >= 5}<p class="settings-note">{t("settings.data.clockSkew", { n: skewMin })}</p>{/if}
  {#if corrupt > 0}<p class="settings-note">{tn("settings.data.unreadable.corrupt", corrupt)}</p>{/if}
  {#if newer > 0}<p class="settings-note">{tn("settings.data.unreadable.newer", newer)}</p>{/if}
  {#if corrupt > 0 || newer > 0}
    <p class="settings-note">{t("settings.data.unreadable.hint")}</p>
  {/if}
  {#if errorKey && !sheet}<p class="settings-note" role="alert">{t(errorKey)}</p>{/if}
  <button type="button" class="settings-link delete text-action" onclick={() => open("delete")}>
    {t("settings.data.deleteAccount")}
  </button>
</section>

{#if sheet === "export"}
  <ConfirmSheet title={t("settings.data.export")} oncancel={close}>
    <div class="choices">
      <button type="button" class="choice" disabled={busy} onclick={exportC}>
        {t("settings.data.export.csv")}
      </button>
      <label class="check">
        <input type="checkbox" bind:checked={csvLabels} />
        {t("settings.data.export.csv.labels", {
          language: new Intl.DisplayNames([getLocale()], { type: "language" }).of(getLocale()) ?? getLocale(),
        })}
      </label>
      <button type="button" class="choice" disabled={busy} onclick={exportJ}>
        {t("settings.data.export.jsonl")}
      </button>
      <button type="button" class="choice" disabled={busy} onclick={exportR}>
        {t("settings.data.export.reminders")}
      </button>
      <button type="button" class="choice" disabled={busy} onclick={exportB}>
        {t("settings.data.export.bundle")}
      </button>
    </div>
    <!-- One status line: preparing, then "Saved {filename}" after each download -->
    <p class="row-sub" role="status">
      {#if preparing !== null}
        {t("settings.data.export.preparing", { n: preparing })}
      {:else if savedFiles}
        {t("settings.data.export.saved", { filename: savedFiles })}
      {/if}
    </p>
    {#if partial && preparing === null}<p class="row-sub">{t("settings.data.export.partial")}</p>{/if}
    {#if errorKey}<p class="row-sub" role="alert">{t(errorKey)}</p>{/if}
    <!-- What the exported fields rest on: the methodology's field map -->
    <a
      class="settings-link fieldmap"
      href={`/methodology#${getLocale()}-s4`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {t("settings.data.export.methodology")}
    </a>
  </ConfirmSheet>
{/if}

{#if sheet === "passphrase"}
  <ConfirmSheet
    title={t("settings.data.changePassphrase")}
    confirmLabel={t("common.save")}
    {busy}
    onconfirm={() => {
      if (passphrase && newValid.valid && newPassphrase === repeat) changePassphrase();
    }}
    oncancel={close}
  >
    {#if username}
      <input type="text" name="username" autocomplete="username" value={username} readonly hidden />
    {/if}
    <div class="field">
      <label for="data-pass">{t("settings.data.changePassphrase.current")}</label>
      <PassphraseInput
        id="data-pass"
        autocomplete="current-password"
        fieldLabel={t("settings.data.changePassphrase.current")}
        bind:value={passphrase}
        bind:input={passField}
      />
    </div>
    <div class="new">
      <NewPassphrase
        bind:passphrase={newPassphrase}
        bind:repeat
        label={t("settings.data.changePassphrase.new")}
        repeatLabel={t("settings.data.changePassphrase.repeat")}
        idPrefix="data-new"
        disabled={busy}
      />
    </div>
    {#if errorKey}<p class="row-sub" role="alert">{t(errorKey)}</p>{/if}
  </ConfirmSheet>
{/if}

{#if sheet === "recovery"}
  <ConfirmSheet
    title={t("settings.data.newRecoveryKey")}
    confirmLabel={t("common.next")}
    {busy}
    onconfirm={() => {
      if (passphrase) makeRecoveryKey();
    }}
    oncancel={close}
  >
    <p>{t("settings.data.newRecoveryKey.warning")}</p>
    {#if username}
      <input type="text" name="username" autocomplete="username" value={username} readonly hidden />
    {/if}
    <div class="field">
      <label for="data-pass">{t("auth.passphrase.title")}</label>
      <PassphraseInput
        id="data-pass"
        autocomplete="current-password"
        bind:value={passphrase}
        bind:input={passField}
      />
    </div>
    {#if errorKey}<p class="row-sub" role="alert">{t(errorKey)}</p>{/if}
  </ConfirmSheet>
{/if}

{#if sheet === "resave"}
  <ConfirmSheet
    title={t("settings.data.resaveKeys")}
    confirmLabel={t("common.save")}
    {busy}
    onconfirm={() => {
      if (passphrase) resaveKeys();
    }}
    oncancel={close}
  >
    <p>{t("settings.data.resaveKeys.hint")}</p>
    {#if username}
      <input type="text" name="username" autocomplete="username" value={username} readonly hidden />
    {/if}
    <div class="field">
      <label for="data-pass">{t("auth.passphrase.title")}</label>
      <PassphraseInput
        id="data-pass"
        autocomplete="current-password"
        bind:value={passphrase}
        bind:input={passField}
      />
    </div>
    {#if errorKey}<p class="row-sub" role="alert">{t(errorKey)}</p>{/if}
  </ConfirmSheet>
{/if}

{#if sheet === "delete"}
  <ConfirmSheet
    title={t("settings.data.deleteAccount.title")}
    confirmLabel={t("settings.data.deleteAccount.confirm")}
    destructive
    {busy}
    confirmDisabled={!passphrase}
    onconfirm={() => {
      if (passphrase) deleteAccount();
    }}
    oncancel={close}
  >
    <p>{t("settings.data.deleteAccount.body")}</p>
    {#if username}
      <input type="text" name="username" autocomplete="username" value={username} readonly hidden />
    {/if}
    <div class="field">
      <label for="data-pass">{t("auth.passphrase.title")}</label>
      <PassphraseInput
        id="data-pass"
        autocomplete="current-password"
        bind:value={passphrase}
        bind:input={passField}
      />
    </div>
    {#if errorKey}<p class="row-sub" role="alert">{t(errorKey)}</p>{/if}
  </ConfirmSheet>
{/if}

{#if newKey}
  <!-- A dialog: no pane swipe, arrow or Esc reaches the pane under it -->
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label={t("settings.data.newRecoveryKey")}
    tabindex="-1"
    bind:this={overlayEl}
  >
    <RecoveryKeyDisplay
      recoveryKey={newKey}
      step={null}
      landmark={false}
      onConfirmed={recoveryKeySaved}
    />
  </div>
{/if}

<style>
  /* ui.md §11 asks for #312E81; the theme's ink keeps it readable on dark grounds too */
  .delete {
    align-self: flex-start;
    margin: 0 0.25rem;
    color: var(--c-ink, #312e81);
  }

  /* A phone: at the right edge (settings.css) */
  @media (max-width: 899px) {
    .delete {
      align-self: flex-end;
    }
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .choice {
    min-height: 48px;
    padding: 0.5rem 0.875rem;
    border: 1px solid var(--c-line, #e2e8f0);
    border-radius: 10px;
    background: var(--c-ground, #f7f6f2);
    color: var(--c-ink, #1c1c1a);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  /* A link's min-height needs a box: a 44 px line as wide as its words, at
     the right edge on a phone (settings.css) */
  .fieldmap {
    display: flex;
    align-items: center;
    width: fit-content;
    font-size: 0.9375rem;
  }

  .fieldmap:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
    padding-left: 0.25rem;
    font-size: 0.9375rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 0.75rem;
    font-size: 0.875rem;
  }

  /* The new passphrase and its repeat (NewPassphrase), under the current */
  .new {
    margin-top: 0.75rem;
    font-size: 0.875rem;
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--c-ground, #e4edf1);
  }

  /* Focused as a whole when it opens, like a sheet: no ring round the screen */
  .overlay:focus {
    outline: none;
  }
</style>
