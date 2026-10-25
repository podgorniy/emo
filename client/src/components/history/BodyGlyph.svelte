<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The body figure of a past check-in, read-only: front and back, 44×88
   * each, the chosen zones solid in the fixed highlight (principle 7), the
   * whole silhouette tinted for "whole body" and nothing for "nowhere".
   * The geometry is the body map's (ui.md §7.2,
   * `lib/bodyFigure.ts`). Hidden from assistive technology: the zone list
   * beside it says the same (D15).
   * Specification: ui.md §15.7.
   */
  import { BANDS, PATH } from "../../lib/bodyFigure.ts";

  interface Props {
    locations: string[];
    /** Makes the clip path ids unique when several records are open */
    uid: string;
  }

  let { locations, uid }: Props = $props();

  const whole = $derived(locations[0] === "whole_body");
</script>

<span class="glyph" aria-hidden="true">
  {#each ["front", "back"] as const as view (view)}
    <svg viewBox="0 0 260 520" class:whole>
      <defs>
        <clipPath id="glyph-{uid}-{view}"><path d={PATH[view]} /></clipPath>
      </defs>
      <path class="fill" d={PATH[view]} />
      <g clip-path="url(#glyph-{uid}-{view})">
        {#if whole}
          <rect class="whole-tint" x="0" y="0" width="260" height="520" />
        {/if}
        {#each Object.entries(BANDS[view]) as [key, d] (key)}
          {#if locations.includes(key)}<path class="band" {d} />{/if}
        {/each}
      </g>
      <path class="outline" d={PATH[view]} />
    </svg>
  {/each}
</span>

<style>
  .glyph {
    display: inline-flex;
    gap: 8px;
    flex: none;
  }

  svg {
    width: 44px;
    height: 88px;
  }

  .fill {
    fill: var(--c-ground, #e4edf1);
  }

  /* 5 units ≈ 0.85 px at 44 × 88: the fingers and the leg gap stay open */
  .outline {
    fill: none;
    stroke: var(--c-ink, #1e2a26);
    stroke-opacity: 0.5;
    stroke-width: 5;
    stroke-linejoin: round;
  }

  .band {
    fill: var(--c-figure-sel, #4f46e5);
    fill-opacity: 0.85;
  }

  .whole-tint {
    fill: var(--c-figure-sel, #4f46e5);
    fill-opacity: 0.33;
  }

  svg.whole .outline {
    stroke: var(--c-figure-sel, #4f46e5);
    stroke-opacity: 1;
  }
</style>
