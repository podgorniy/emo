<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The two null answers of a step as one row of two 44 px pills, always on
   * screen (ui.md §1.4): Whole body / Nowhere under the
   * Front/Back switch on step 1, "nothing" / "can't tell" pinned above the
   * footer on step 2. Same colours, weight, light and motion as every other
   * option (the shared `.answer`; only the pill shape differs); native
   * buttons with `aria-pressed`.
   */
  interface Option {
    key: string;
    label: string;
  }

  interface Props {
    options: Option[];
    selected: (key: string) => boolean;
    ontoggle: (key: string) => void;
    ariaLabel: string;
  }

  let { options, selected, ontoggle, ariaLabel }: Props = $props();
</script>

<div class="pair" role="group" aria-label={ariaLabel}>
  {#each options as option (option.key)}
    <button
      type="button"
      class="pill answer answer--pill"
      class:on={selected(option.key)}
      aria-pressed={selected(option.key)}
      data-null={option.key}
      onclick={() => ontoggle(option.key)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    width: 100%;
  }

  .pill {
    padding: 0.375rem 0.875rem;
    font-size: 1rem;
  }
</style>
