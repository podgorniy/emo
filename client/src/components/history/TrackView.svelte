<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * A read-only copy of the measurement slider (`Slider.svelte`,
   * ui.md §14.4) at a smaller scale: the track, the thumb where
   * it was left in the fixed highlight (principle 7), the dashed untouched
   * thumb at the midpoint, and the poles. Never a number (principle 8): an
   * image named with the instrument's word scale, never `<meter>`.
   * Specification: ui.md §15.7, §15.8, §15.16.
   */
  import type { TrackField } from "../../lib/historyRecord.ts";

  let { field }: { field: TrackField } = $props();
</script>

<div class="track-view" class:bipolar={field.bipolar} role="img" aria-label={field.aria}>
  <div class="track">
    {#if field.bipolar}<span class="center-tick"></span>{/if}
    <span
      class="thumb"
      class:untouched={field.untouched}
      style:left="calc({field.at} * (100% - 14px))"
    ></span>
  </div>
  <div class="poles">
    <span>{field.low}</span>
    {#if field.center}<span class="center">{field.center}</span>{/if}
    <span class="high">{field.high}</span>
  </div>
</div>

<style>
  .track-view {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    width: 100%;
    max-width: 280px;
  }

  .track {
    position: relative;
    height: 14px;
  }

  /* The instrument's track, at 4 px */
  .track::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 5px;
    height: 4px;
    border-radius: 2px;
    background: var(--c-track, var(--c-line, #e2e8f0));
  }

  .center-tick {
    position: absolute;
    left: calc(50% - 1px);
    top: -1px;
    width: 2px;
    height: 16px;
    background: var(--c-muted, #4e5853);
  }

  .thumb {
    position: absolute;
    top: 0;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--c-figure-sel, #4f46e5);
    border: 2px solid var(--c-figure-sel, #4f46e5);
  }

  /* Untouched: the instrument's dashed ring on surface, at the midpoint */
  .thumb.untouched {
    background: var(--c-surface, #ffffff);
    border-style: dashed;
  }

  .poles {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--c-muted, #5c6670);
  }

  .poles .center {
    text-align: center;
  }

  .poles .high {
    text-align: right;
  }
</style>
