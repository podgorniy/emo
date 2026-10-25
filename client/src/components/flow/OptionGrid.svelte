<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Answer buttons: a 2-column grid in dictionary order in every theme
   * (ui.md §1.11); on a desktop `auto-fit` columns of at
   * least 190 px, so a long list fits (ui.md §4, §9). Native buttons with
   * `aria-pressed`;
   * selection is shown by weight and border as well as the fixed highlight
   * colour, never by colour alone (ui.md §10). Null answers look like any other
   * option (principle 4): every state, light and motion is the shared
   * `.answer` class (`answer.css`); this sets only size and alignment.
   */
  interface Option {
    key: string;
    label: string;
  }

  interface Props {
    options: Option[];
    selected: (key: string) => boolean;
    ontoggle: (key: string) => void;
    oninspect?: (key: string) => void;
    ariaLabel: string;
    compact?: boolean;
  }

  let { options, selected, ontoggle, oninspect, ariaLabel, compact = false }: Props = $props();

  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let didInspect = false;

  function handlePointerDown(key: string) {
    didInspect = false;
    if (!oninspect) return;
    pressTimer = setTimeout(() => {
      didInspect = true;
      oninspect(key);
    }, 600);
  }

  function handlePointerUp() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }
</script>

<div class="grid" class:compact role="group" aria-label={ariaLabel}>
  {#each options as option (option.key)}
    <button
      type="button"
      class="option answer"
      class:on={selected(option.key)}
      aria-pressed={selected(option.key)}
      onpointerdown={() => handlePointerDown(option.key)}
      onpointerup={handlePointerUp}
      onpointerleave={handlePointerUp}
      onpointercancel={handlePointerUp}
      onclick={() => {
        if (!didInspect) ontoggle(option.key);
      }}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  /* ui.md §9: three columns in the 680 px column, the same dictionary order */
  @media (min-width: 900px) {
    .grid {
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    }
  }

  .grid.compact {
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  }

  /* Size only; colours, selection, focus and press are `.answer`'s
     (ui.md §14.4 "grid") */
  .option {
    min-height: 48px;
    padding: 0.625rem 0.875rem;
    font-size: 1rem;
    text-align: left;
  }
</style>
