<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Step 9 — What is the situation? One option (required). "other" reveals
   * a field focused once when it appears, ≤ 40 code points; the text is kept
   * while "other" is deselected but saved only with it (ui.md §6.12, §5.5). The
   * note sits under it (`StepNote`).
   */
  import { CONTEXT_TAGS, forInput } from "../../../../shared/dictionaries.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import { CONTEXT_OTHER_MAX, cut } from "../../lib/machine.ts";
  import { reveal } from "../../lib/motion.ts";
  import OptionGrid from "./OptionGrid.svelte";

  interface Props {
    tag: string | null;
    other: string;
    ontag: (key: string) => void;
    onother: (text: string) => void;
  }

  let { tag, other, ontag, onother }: Props = $props();

  const locale = $derived(getLocale());
  let input = $state<HTMLInputElement | null>(null);

  // Focus the field once, when it appears (D14) — not again on every change
  // of the form: the note under it would lose focus at each keystroke
  let focused = false;
  $effect(() => {
    if (tag !== "other") {
      focused = false;
      return;
    }
    if (focused || !input) return;
    focused = true;
    input.focus();
  });
</script>

<OptionGrid
  ariaLabel={t("checkin.step.9.title")}
  options={forInput(CONTEXT_TAGS).map((c) => ({ key: c.key, label: c.label[locale] }))}
  selected={(k) => k === tag}
  ontoggle={ontag}
/>

{#if tag === "other"}
  <div class="other" use:reveal>
    <label for="context-other">{t("checkin.step.9.other.label")}</label>
    <input
      bind:this={input}
      id="context-other"
      class="fx-field"
      type="text"
      value={other}
      placeholder={t("checkin.step.9.other.placeholder")}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      oninput={(e) => {
        const el = e.target as HTMLInputElement;
        const v = cut(el.value, CONTEXT_OTHER_MAX);
        if (v !== el.value) el.value = v;
        onother(v);
      }}
    />
    <span class="counter" aria-live="polite">
      {t("checkin.step.9.other.counter", { n: Array.from(other).length })}
    </span>
  </div>
{/if}

<style>
  .other {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 1.25rem;
  }

  label {
    font-size: 0.9375rem;
    font-weight: 600;
  }

  /* The well, focus ring and halo: `.fx-field` (fx.css) */
  input {
    height: 52px;
    padding: 0 0.875rem;
    font: inherit;
    font-size: 1rem;
  }

  .counter {
    align-self: flex-end;
    font-size: 0.8125rem;
    color: var(--c-muted, #5c6670);
  }
</style>
