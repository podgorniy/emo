<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Desktop: the panes as a segmented tab control in the top bar
   * ("Check-in · History · Settings", ui.md §2.2, §9), the
   * shared `.seg`: the current pane is the raised surface, which slides to
   * the next one (ui.md §5.1). Hidden on phones, where the dots and swipes do the
   * same.
   */
  import { enabledPanes, type PaneId } from "../../lib/panes.ts";
  import { t } from "../../lib/i18n.svelte.ts";

  interface Props {
    current: PaneId;
    onopen: (id: PaneId) => void;
  }

  let { current, onopen }: Props = $props();
  const panes = $derived(enabledPanes());
</script>

<nav class="tabs seg" aria-label={t("home.panes.aria")}>
  <span
    class="seg-puck"
    style:--n={panes.length}
    style:--i={Math.max(0, panes.findIndex((p) => p.id === current))}
    aria-hidden="true"
  ></span>
  {#each panes as pane (pane.id)}
    <button
      type="button"
      class="tab"
      class:on={pane.id === current}
      aria-current={pane.id === current ? "page" : undefined}
      data-label={t(pane.labelKey)}
      onclick={() => onopen(pane.id)}
    >
      {t(pane.labelKey)}
    </button>
  {/each}
</nav>

<style>
  .tabs.seg {
    display: none;
  }

  @media (min-width: 900px) {
    .tabs.seg {
      display: inline-grid;
    }
  }

  /* ui.md §9 draws 36 px; ui.md §10 asks 44 px for every target, which wins */
  .tab {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0 0.875rem;
    color: var(--c-muted, #5c6670);
    font-size: 0.875rem;
    white-space: nowrap;
  }

  /* Each tab is as wide as its bold label, so the row never changes width
     when another tab becomes the current one (ui.md §2.2) */
  .tab::after {
    content: attr(data-label);
    height: 0;
    overflow: hidden;
    visibility: hidden;
    font-weight: 600;
  }

  .tab.on {
    color: var(--c-ink, #1c1c1a);
  }
</style>
