<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * One of the sync dot's five looks, 12×12: a solid disc (synced), a half
   * disc (sending), a ring (waiting), a slashed ring (not connected) and a
   * ring with a centre dot (needs a look). They differ by shape, never by
   * colour (WCAG 1.4.1): muted, "needs a look" in ink, never the accent.
   * `currentColor` keeps them visible in forced colours. The dot animates
   * "sending"; the legend in the sync sheet shows the same shapes still.
   * Hidden from assistive technology: the dot's name and the legend's text
   * say it. Specification: ui.md §3.
   */
  import type { Glyph } from "../../lib/syncDot.ts";

  interface Props {
    glyph: Glyph;
    /** The dot's "sending" pulse; the legend never animates */
    animate?: boolean;
  }

  let { glyph, animate = false }: Props = $props();
</script>

<svg
  class="sync-glyph {glyph}"
  class:animate
  viewBox="0 0 12 12"
  width="12"
  height="12"
  aria-hidden="true"
  focusable="false"
>
  {#if glyph === "synced"}
    <circle cx="6" cy="6" r="5" fill="currentColor" />
  {:else if glyph === "sending"}
    <circle class="ring" cx="6" cy="6" r="4.5" />
    <path d="M6 1.5 A4.5 4.5 0 0 0 6 10.5 Z" fill="currentColor" />
  {:else}
    <circle class="ring" cx="6" cy="6" r="4.25" />
    {#if glyph === "notConnected"}
      <line class="slash" x1="2" y1="10" x2="10" y2="2" />
    {:else if glyph === "needsLook"}
      <circle cx="6" cy="6" r="1.75" fill="currentColor" />
    {/if}
  {/if}
</svg>

<style>
  .sync-glyph {
    flex: none;
    color: var(--c-muted, #5c6670);
  }

  .sync-glyph.needsLook {
    color: var(--c-ink, #1c1c1a);
  }

  .ring,
  .slash {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }

  .slash {
    stroke-linecap: round;
  }

  .sync-glyph.sending.animate {
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sync-glyph.animate {
      animation: none !important;
    }
  }
</style>
