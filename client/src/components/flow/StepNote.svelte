<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The optional note — "One fact, one line" — under the situation on the
   * last screen (ui.md §6.12, §8): a labelled field with
   * its hint, never focused by itself (PSY-21, UX-11): the keyboard opens
   * only when the person taps it. The validator runs on every input. On a stop-phrase the message quotes
   * it ("“because” is about why…") in a live region styled apart from the
   * hint and the focus ring, the text stays for editing, Save stays disabled
   * (the flow checks `isStepValid`), and there are two ways out: "Remove
   * “because…”" cuts the note from that phrase to the end, keeping the
   * concrete part; "Save without the note" saves with no note at all.
   * ≤ 160 code points.
   */
  import { findStopPhrase } from "../../../../shared/entry.ts";
  import { t } from "../../lib/i18n.svelte.ts";
  import { cut, NOTE_MAX } from "../../lib/machine.ts";
  import { reveal } from "../../lib/motion.ts";

  interface Props {
    note: string;
    onnote: (text: string) => void;
    /** Save with `note = null` */
    onsavewithout: () => void;
  }

  let { note, onnote, onsavewithout }: Props = $props();

  let area = $state<HTMLTextAreaElement | null>(null);
  let validator = $state<HTMLElement | null>(null);
  const match = $derived(findStopPhrase(note));

  // The callout appears under the field, at the bottom of the last screen:
  // bring it into view (never focus) so Save's wait has its reason in sight
  let shown = false;
  $effect(() => {
    const now = match !== null;
    if (now && !shown) {
      validator?.scrollIntoView({
        block: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
    shown = now;
  });

  /** "Remove “because…”": from the phrase to the end, and the comma before it */
  function removeFrom(start: number) {
    onnote(note.slice(0, start).replace(/[\s,;:—–-]+$/u, ""));
    area?.focus();
  }
</script>

<div class="note-block">
  <div class="head">
    <label class="label" for="note">{t("checkin.step.10.title")}</label>
    <p class="hint" id="note-hint">{t("checkin.step.10.hint")}</p>
  </div>
  <textarea
    bind:this={area}
    id="note"
    class="fx-field"
    class:rejected={match !== null}
    value={note}
    placeholder={t("checkin.step.10.placeholder")}
    aria-invalid={match !== null}
    aria-describedby="note-hint note-validator"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    oninput={(e) => {
      const el = e.target as HTMLTextAreaElement;
      const v = cut(el.value, NOTE_MAX);
      if (v !== el.value) el.value = v;
      onnote(v);
    }}
  ></textarea>
  <div class="below">
    <span class="counter">{t("checkin.step.10.counter", { n: Array.from(note).length })}</span>
  </div>
  <div
    id="note-validator"
    class="validator"
    class:shown={match !== null}
    aria-live="polite"
    bind:this={validator}
  >
    {#if match}
      <div use:reveal>
        <p class="message">{t("checkin.step.10.validator", { phrase: match.phrase })}</p>
        <div class="ways">
          <button type="button" class="remove btn-primary" onclick={() => removeFrom(match.start)}>
            {t("checkin.step.10.remove", { phrase: match.phrase })}
          </button>
          <button type="button" class="without btn-secondary quiet" onclick={onsavewithout}>
            {t("checkin.step.10.saveWithout")}
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Under the situation grid, set apart from it */
  .note-block {
    margin-top: 0.75rem;
  }

  .head {
    margin-bottom: 0.5rem;
  }

  .label {
    display: block;
    font-size: 1rem;
    font-weight: 600;
    color: var(--c-ink, #1e2a26);
  }

  .hint {
    margin: 0.125rem 0 0;
    font-size: 0.9375rem;
    color: var(--c-muted, #5c6670);
  }

  /* The well, focus ring and halo: `.fx-field` (fx.css) */
  textarea {
    width: 100%;
    min-height: 88px;
    padding: 0.875rem;
    font: inherit;
    font-size: 1.0625rem;
    resize: vertical;
    box-sizing: border-box;
  }

  /* Not the focus ring's colour: the ink, dashed (a warning, not an error);
     no halo, whatever the theme's glow, and no colour */
  textarea.rejected.fx-field {
    border: 2px dashed var(--c-ink, #312e81);
  }

  textarea.rejected.fx-field:focus-visible {
    box-shadow: none;
  }

  .below {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.375rem;
  }

  .counter {
    flex-shrink: 0;
    font-size: 0.8125rem;
    color: var(--c-muted, #5c6670);
  }

  /* A live region, always mounted; a callout only while a phrase matches —
     ink on a surface card with a rule at the left, unlike the muted hint */
  .validator.shown {
    margin-top: 0.5rem;
    padding: 0.75rem 0.875rem;
    border-left: 3px solid var(--c-ink, #312e81);
    border-radius: 4px var(--r-control, 12px) var(--r-control, 12px) 4px;
    background: var(--c-surface, #ffffff);
  }

  .message {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: 1.4;
    /* #312E81 on light grounds; the theme's ink stays readable on dark ones */
    color: var(--c-ink, #312e81);
  }

  .ways {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.625rem;
  }

  /* Looks: `.btn-primary` / `.btn-secondary` (fx.css) */
  .ways button {
    min-height: 44px;
    max-width: 100%;
    padding: 0.375rem 1rem;
    font: inherit;
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }

  .remove {
    font-weight: 600;
  }

  /* A phone: at the right edge, the way out of the phrase in the corner,
     where the thumb is (ui.md §4.5) */
  @media (max-width: 899px) {
    .ways {
      flex-direction: row-reverse;
    }
  }
</style>
