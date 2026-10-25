<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Terms with their descriptions, as plain text: the check-in's help sheet
   * and Settings → Words (ui.md §6.5, §11.9). Nothing here
   * is a control or an answer. A term without a description yet shows only
   * its label.
   */
  import type { Term } from "../../lib/help.ts";

  interface Props {
    terms: Term[];
  }

  let { terms }: Props = $props();
</script>

<dl class="terms">
  {#each terms as term (term.key)}
    <div class="term">
      <dt>{term.label}</dt>
      {#if term.text}<dd>{term.text}</dd>{/if}
    </div>
  {/each}
</dl>

<style>
  .terms {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    margin: 0;
  }

  dt {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.35;
    color: var(--c-ink, #1e2a26);
  }

  dd {
    margin: 0.125rem 0 0;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--c-ink, #1e2a26);
  }
</style>
