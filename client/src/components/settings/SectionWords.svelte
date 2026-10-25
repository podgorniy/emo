<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Words, inline in Settings (ui.md §11.9): one row,
   * "Words in check-ins ›", that opens every description in check-in order
   * under the step eyebrows, the same label and text pairs as the check-in's
   * help sheet (ui.md §6.5). Under WORD each level-1 word is a native `<details>`,
   * closed by default, with its level-2 terms; then the certainties.
   * Read-only, no hover; `#words` opens it. The descriptions are a lazy chunk,
   * fetched when the section first opens (performance.md §1.1).
   */
  import "./settings.css";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import { type Glossary, glossarySections, loadGlossary } from "../../lib/help.ts";
  import TermList from "../common/TermList.svelte";

  /** Open on a deep link to `/settings#words`, else one row */
  let open = $state(typeof location !== "undefined" && location.hash === "#words");
  let glossary = $state.raw<Glossary | null>(null);
  const locale = $derived(getLocale());
  const sections = $derived(glossary ? glossarySections(locale, glossary, (k) => t(k)) : []);

  $effect(() => {
    if (open && !glossary) {
      loadGlossary()
        .then((g) => (glossary = g))
        .catch((err) => console.warn("Descriptions not loaded:", err));
    }
  });
</script>

<section class="settings-section" id="words">
  <h2 class="section-header">{t("settings.words.header")}</h2>
  <div class="settings-card">
    <button
      type="button"
      class="settings-row disclosure"
      aria-expanded={open}
      aria-controls="words-body"
      onclick={() => (open = !open)}
    >
      <span>{t("settings.words.row")}</span>
      <svg class="chevron" class:open viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </button>
  </div>

  <div class="body" id="words-body" hidden={!open}>
    <p class="settings-note">{t("settings.words.intro")}</p>
    {#each sections as section (section.id)}
      <div class="settings-card group">
        <h3 class="group-heading">{section.heading}</h3>
        {#if section.kind === "terms"}
          <TermList terms={section.terms} />
        {:else if section.kind === "scale"}
          <TermList terms={[section.term]} />
        {:else}
          <div class="words">
            {#each section.words as word (word.l1.key)}
              <details class="word">
                <summary>{word.l1.label}</summary>
                <div class="word-body">
                  {#if word.l1.text}<p class="l1-text">{word.l1.text}</p>{/if}
                  {#if word.l2.length > 0}<TermList terms={word.l2} />{/if}
                </div>
              </details>
            {/each}
          </div>
          <h4 class="certainty-heading">{section.certaintyHeading}</h4>
          <TermList terms={section.certainty} />
        {/if}
      </div>
    {/each}
  </div>
</section>

<style>
  .disclosure {
    width: 100%;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .disclosure:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: -2px;
    border-radius: 16px;
  }

  .chevron {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--c-muted, #5c6670);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.2s ease;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .body[hidden] {
    display: none;
  }

  .group {
    padding: 1rem;
  }

  .group-heading {
    margin: 0 0 0.75rem;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--c-muted, #5c6670);
  }

  .words {
    display: flex;
    flex-direction: column;
  }

  .word + .word {
    border-top: 1px solid var(--c-line, #e2e8f0);
  }

  .word summary {
    min-height: 44px;
    box-sizing: border-box;
    padding: 0.625rem 0;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.35;
    color: var(--c-ink, #1c1c1a);
    cursor: pointer;
  }

  .word summary:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
    border-radius: 8px;
  }

  .word-body {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 0 0 1rem 1rem;
  }

  .l1-text {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--c-ink, #1c1c1a);
  }

  .certainty-heading {
    margin: 1rem 0 0.75rem;
    padding-top: 1rem;
    border-top: 1px solid var(--c-line, #e2e8f0);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--c-muted, #5c6670);
  }
</style>
