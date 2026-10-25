<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Step 6 — Is there a word for it? (ui.md §6.10).
   * Level 1: 8 identical options incl. "empty" and "don't know". After a
   * word (not "don't know"): the required certainty right under the grid —
   * never pre-selected — then the optional level 2. "Don't know" sets word =
   * certainty = "unknown". `asked`: Next was tapped without a certainty, so
   * a live line says what is missing. What appears rises 6 px into place,
   * never fading (ui.md §5.1).
   */
  import { forInput, WORDS } from "../../../../shared/dictionaries.ts";
  import type { WordConfidence } from "../../../../shared/entry.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import { reveal } from "../../lib/motion.ts";
  import OptionGrid from "./OptionGrid.svelte";

  interface Props {
    word: string | null;
    confidence: WordConfidence | null;
    asked?: boolean;
    onl1: (key: string) => void;
    onl2: (key: string) => void;
    onconfidence: (c: WordConfidence) => void;
  }

  let { word, confidence, asked = false, onl1, onl2, onconfidence }: Props = $props();

  const locale = $derived(getLocale());
  const l1 = $derived(word?.split(".")[0] ?? null);
  const l2 = $derived(word?.split(".")[1] ?? null);
  const l1Item = $derived(WORDS.find((w) => w.key === l1));
  const l2Items = $derived(l1Item ? forInput(l1Item.l2) : []);
  const certainties: WordConfidence[] = ["guess", "sure", "unknown"];
</script>

<OptionGrid
  ariaLabel={t("checkin.step.6.l1.aria")}
  options={forInput(WORDS).map((w) => ({ key: w.key, label: w.label[locale] }))}
  selected={(k) => k === l1}
  ontoggle={onl1}
/>

{#if l1 === "unknown"}
  <p class="note" role="status" use:reveal>{t("checkin.step.6.unknown.note")}</p>
{:else if l1Item}
  <section class="reveal" use:reveal>
    <h2 class="sub" id="certainty-title">{t("checkin.step.6.confidence.title")}</h2>
    <div class="certainty" role="group" aria-labelledby="certainty-title">
      {#each certainties as c (c)}
        <button
          type="button"
          class="option answer"
          class:on={confidence === c}
          aria-pressed={confidence === c}
          onclick={() => onconfidence(c)}
        >
          {t(`checkin.step.6.confidence.${c}`)}
        </button>
      {/each}
    </div>
    <p class="ask" class:shown={asked && confidence === null} role="status">
      {asked && confidence === null ? t("checkin.step.6.confidence.ask") : ""}
    </p>

    {#if l2Items.length > 0}
      <h2 class="sub">{t("checkin.step.6.l2.title")}</h2>
      <OptionGrid
        compact
        ariaLabel={t("checkin.step.6.l2.aria")}
        options={l2Items.map((w) => ({ key: w.key, label: w.label[locale] }))}
        selected={(k) => k === l2}
        ontoggle={onl2}
      />
    {/if}
  </section>
{/if}

<style>
  .reveal {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1.25rem;
  }

  .sub {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--c-ink, #1e2a26);
  }

  /* A live region, always mounted; until Next is tapped without a
     certainty it is empty and cancels its gap */
  .ask {
    margin: -0.75rem 0 0;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--c-ink, #1e2a26);
  }

  .ask.shown {
    margin-top: -0.25rem;
  }

  .note {
    margin: 1rem 0 0;
    font-size: 0.9375rem;
    color: var(--c-muted, #5c6670);
  }

  .certainty {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  /* The certainty buttons are answers like any other (`.answer`) */
  .option {
    min-height: 48px;
    padding: 0.5rem;
  }
</style>
