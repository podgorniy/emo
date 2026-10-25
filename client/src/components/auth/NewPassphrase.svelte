<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Choosing a passphrase — on sign-up, after a recovery key and in Settings
   * (ui.md §12.5, UX-12): the field with Show, the hint
   * (non-ASCII at once, length once typed), the strength meter only while
   * the value is valid, "Repeat" checked on blur or once it is as long as
   * the first, and "Suggest a passphrase" — five random English words in
   * clear text, from a chunk fetched on that tap. Return in the first field
   * moves on to "Repeat".
   */
  import "./auth.css";
  import { tick } from "svelte";
  import { validatePassphrase } from "../../../../shared/passphrase/validator.ts";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { t } from "../../lib/i18n.svelte.ts";
  import PassphraseInput from "../common/PassphraseInput.svelte";

  interface Props {
    passphrase: string;
    repeat: string;
    /** "Passphrase, 8 characters or more" by default */
    label?: string;
    /** "Repeat" by default */
    repeatLabel?: string;
    idPrefix?: string;
    autofocus?: boolean;
    disabled?: boolean;
  }

  let {
    passphrase = $bindable(""),
    repeat = $bindable(""),
    label,
    repeatLabel,
    idPrefix = "new",
    autofocus = false,
    disabled = false,
  }: Props = $props();

  const passId = $derived(`${idPrefix}-passphrase`);
  const repeatId = $derived(`${idPrefix}-repeat`);
  let shown = $state(false);
  let repeatShown = $state(false);
  let repeatBlurred = $state(false);
  let suggested = $state(false);
  let first = $state<HTMLInputElement | null>(null);
  let second = $state<HTMLInputElement | null>(null);
  const passLabel = $derived(label ?? t("auth.passphrase.field"));
  const repeatText = $derived(repeatLabel ?? t("auth.passphrase.repeat"));

  const validation = $derived(validatePassphrase(passphrase));
  // Non-ASCII at once; length only once something is typed
  const hint = $derived(
    passphrase.length === 0
      ? ""
      : !validation.asciiOnly
      ? t("auth.passphrase.error.asciiOnly")
      : !validation.lengthValid
      ? t("auth.passphrase.rule")
      : validation.score <= 1
      ? t("auth.passphrase.tooWeak")
      : "",
  );
  /** Four segments: score 0–1 lights one, 4 lights all. */
  const segments = $derived(Math.max(1, validation.score));
  const STRENGTH: MessageKey[] = [
    "auth.passphrase.strength.weak",
    "auth.passphrase.strength.weak",
    "auth.passphrase.strength.fair",
    "auth.passphrase.strength.good",
    "auth.passphrase.strength.strong",
  ];
  // Not after two characters: on leaving the field, or once it is as long
  const mismatch = $derived(
    repeat.length > 0 && repeat !== passphrase &&
      (repeatBlurred || repeat.length >= passphrase.length),
  );

  async function suggest() {
    const { suggestPassphrase } = await import("../../lib/passphraseWords.ts");
    const words = suggestPassphrase();
    passphrase = words;
    repeat = words;
    shown = true;
    repeatShown = true;
    suggested = true;
    await tick();
    first?.select();
  }

  /** Return in the first field moves on to Repeat; sending waits for both */
  function toRepeat(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.isComposing) return;
    // Handled: neither a form nor a sheet's own Return acts on it again
    e.preventDefault();
    second?.focus();
  }
</script>

<div class="fields">
  <div class="auth-field">
    <label for={passId}>{passLabel}</label>
    <PassphraseInput
      id={passId}
      bind:value={passphrase}
      bind:shown
      bind:input={first}
      autocomplete="new-password"
      describedby={`${passId}-hint`}
      invalid={passphrase.length > 0 && !validation.asciiOnly}
      fieldLabel={passLabel}
      enterkeyhint="next"
      {autofocus}
      {disabled}
      oninput={() => (suggested = false)}
      onkeydown={toRepeat}
    />
  </div>

  {#if validation.valid}
    <div class="meter" aria-hidden="true">
      {#each [1, 2, 3, 4] as i (i)}
        <span class="segment" class:on={i <= segments} style:--i={i - 1}></span>
      {/each}
      <span class="meter-word">{t(STRENGTH[validation.score])}</span>
    </div>
  {/if}
  {#if suggested}
    <!-- The whole phrase in sight: the field is too narrow for five words -->
    <p class="words">{passphrase}</p>
  {/if}
  <p id={`${passId}-hint`} class="auth-hint" role="status">
    {suggested ? t("auth.passphrase.suggested") : hint}
  </p>
  <button type="button" class="auth-link suggest text-action" onclick={suggest} {disabled}>
    {t("auth.passphrase.suggest")}
  </button>

  <div class="auth-field">
    <label for={repeatId}>{repeatText}</label>
    <PassphraseInput
      id={repeatId}
      bind:value={repeat}
      bind:shown={repeatShown}
      bind:input={second}
      autocomplete="new-password"
      fieldLabel={repeatText}
      describedby={`${repeatId}-check`}
      invalid={mismatch}
      {disabled}
      onblur={() => (repeatBlurred = true)}
    />
  </div>
  <p id={`${repeatId}-check`} class="auth-hint" role="status">
    {mismatch ? t("auth.passphrase.mismatch") : ""}
  </p>
</div>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .words {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-radius: var(--r-field, 8px);
    background: var(--c-ground, #f7f6f2);
    font-family: var(--font-mono, monospace);
    font-size: 1rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
    user-select: all;
    color: var(--c-ink, #1c1c1a);
  }

  .suggest {
    align-self: flex-start;
    padding: 0;
  }

  /* A meter, not a reward: matte, the accent, no traffic-light colours.
     Segments fill left to right, 40 ms apart, and empty right to left at
     once (ui.md §5.1) */
  .meter {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    animation: fx-fade-in var(--dur-2) var(--ease-standard);
  }

  .segment {
    position: relative;
    flex: 1;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--c-track, var(--c-line, #e2e8f0));
  }

  .segment::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--c-accent, #4f46e5);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 120ms var(--ease-in);
  }

  .segment.on::after {
    transform: scaleX(1);
    transition: transform var(--dur-3) var(--ease-out) calc(var(--i, 0) * 40ms);
  }

  .meter-word {
    min-width: 4.5rem;
    text-align: right;
    font-size: 0.875rem;
    color: var(--c-muted, #718096);
  }
</style>
