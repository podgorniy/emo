<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The Emo mark (shared/brand.ts) beside the wordmark: six discs of the
   * fixed highlight colour (principle 7), translucent but for the core, so it
   * takes each theme's ground and turns periwinkle on the dark ones.
   * `currentColor` keeps it visible in forced colours. Decorative: the
   * wordmark's text or name says "Emo".
   */
  import {
    MARK_ALPHA,
    MARK_DISCS,
    MARK_VIEWBOX,
  } from "../../../../shared/brand.ts";

  interface Props {
    /** Width and height in CSS pixels */
    size: number;
  }

  let { size }: Props = $props();
  const core = MARK_DISCS.length - 1;
</script>

<svg
  class="mark"
  viewBox={MARK_VIEWBOX}
  width={size}
  height={size}
  aria-hidden="true"
  focusable="false"
>
  {#each MARK_DISCS as d, i (i)}
    <circle
      cx={d.cx}
      cy={d.cy}
      r={d.r}
      fill-opacity={i === core ? 1 : MARK_ALPHA}
    />
  {/each}
</svg>

<style>
  .mark {
    flex: none;
    color: var(--c-figure-sel, #4f46e5);
    fill: currentColor;
  }
</style>
