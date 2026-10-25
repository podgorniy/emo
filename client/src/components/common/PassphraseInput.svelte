<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * A passphrase field with a "Show" / "Hide" button inside its right end
   * (ui.md §12.5, UX-12): the same on sign-up, unlock,
   * recovery and every Settings sheet that asks for it. The label stays with
   * the caller (`<label for={id}>`); a button cannot sit inside a label. Given
   * the label's text, the button is named after its field ("Show — Repeat"),
   * so two on one screen are told apart (AUTH-18).
   */
  import { onMount } from "svelte";
  import { t } from "../../lib/i18n.svelte.ts";

  interface Props {
    id: string;
    value: string;
    autocomplete: "current-password" | "new-password";
    /** Shown in clear text (bindable: "Suggest" turns it on) */
    shown?: boolean;
    describedby?: string;
    invalid?: boolean;
    /** Focus on arrival (ui.md §5.5, §12) */
    autofocus?: boolean;
    disabled?: boolean;
    /** The caller's label text, for the Show button's name */
    fieldLabel?: string;
    /** What the keyboard's Return key says ("next" where it moves on) */
    enterkeyhint?: "next" | "done" | "go";
    input?: HTMLInputElement | null;
    onblur?: () => void;
    oninput?: () => void;
    onkeydown?: (e: KeyboardEvent) => void;
  }

  let {
    id,
    value = $bindable(""),
    autocomplete,
    shown = $bindable(false),
    describedby,
    invalid = false,
    autofocus = false,
    disabled = false,
    fieldLabel,
    enterkeyhint,
    input = $bindable(null),
    onblur,
    oninput,
    onkeydown,
  }: Props = $props();

  onMount(() => {
    if (autofocus) input?.focus();
  });
</script>

<div class="pass">
  <input
    {id}
    class="fx-field"
    type={shown ? "text" : "password"}
    {autocomplete}
    autocapitalize="off"
    spellcheck="false"
    bind:value
    bind:this={input}
    aria-describedby={describedby}
    aria-invalid={invalid ? "true" : undefined}
    {enterkeyhint}
    {disabled}
    {onblur}
    {oninput}
    {onkeydown}
  />
  <button
    type="button"
    class="show text-action"
    aria-controls={id}
    {disabled}
    onclick={() => (shown = !shown)}
  >
    {shown ? t("common.hide") : t("common.show")}
    <!-- Hidden text, not aria-label: the visible word still starts the name
         (WCAG 2.5.3), and the button never answers to the field's label -->
    {#if fieldLabel}<span class="sr-only">— {fieldLabel}</span>{/if}
  </button>
</div>

<style>
  .pass {
    position: relative;
    display: flex;
  }

  /* The well, ring, halo and the 2 px ink of an error: `.fx-field` (fx.css) */
  input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0.625rem 4.75rem 0.625rem 0.875rem;
    font: inherit;
    font-size: 1rem;
  }

  .show {
    position: absolute;
    top: 2px;
    right: 2px;
    bottom: 2px;
    min-width: 44px;
    min-height: 44px;
    padding: 0 0.75rem;
    border: none;
    border-radius: max(0px, calc(var(--r-field, 8px) - 2px));
    background: none;
    color: var(--c-ink, #1c1c1a);
    font: inherit;
    font-size: 0.875rem;
    text-decoration-line: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .show:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
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
