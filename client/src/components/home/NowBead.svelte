<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Now's face (ui.md §3): the mark (shared/brand.ts) in the
   * accent, six discs nested one in another, the five outer ones translucent
   * so they take the ground and the ambient light, the core a lit bead that
   * carries the label. Each disc's box is centred in the one before and
   * leaned by `translate` (lib/bead.ts moves them; here they rest). The label
   * is 30 px, smaller only where it would not fit the core ("Продолжить").
   */
  import { MARK_ALPHA } from "../../../../shared/brand.ts";
  import { BEAD_LAYERS, BEAD_RATIO, beadPose } from "../../lib/bead.ts";

  interface Props {
    label: string;
  }

  let { label }: Props = $props();

  const rest = beadPose();
  const core = BEAD_LAYERS - 1;
  /** The label's widest, as a share of the core's width */
  const FIT = 0.8;

  let text = $state<HTMLElement | null>(null);

  $effect(() => {
    const el = text;
    void label;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      const room = (el.parentElement?.clientWidth ?? 0) * FIT;
      const wide = el.scrollWidth;
      if (room > 0 && wide > room) {
        el.style.fontSize = `${Math.max(16, Math.floor((30 * room) / wide))}px`;
      }
    };
    fit();
    document.fonts?.ready.then(fit).catch(() => {});
  });
</script>

{#snippet disc(i: number)}
  <span class="disc" class:core={i === core} style:translate={i > 0 ? `${rest[i - 1][0]}% ${rest[i - 1][1]}%` : null}>
    {#if i < core}
      {@render disc(i + 1)}
    {:else}
      <span class="label" bind:this={text}>{label}</span>
    {/if}
  </span>
{/snippet}

<span class="bead" style:--ratio={BEAD_RATIO} style:--layer="{MARK_ALPHA * 100}%">
  {@render disc(0)}
</span>

<style>
  .bead {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    pointer-events: none;
  }

  /* Paper: the accent, thin, each disc a ratio of the one before */
  .disc {
    position: absolute;
    inset: calc((1 - var(--ratio)) * 50%);
    border-radius: 50%;
    background-color: color-mix(in srgb, var(--c-accent, #4f46e5) var(--layer), transparent);
  }

  .bead > .disc {
    inset: 0;
  }

  /* The lit bead: a small highlight upper left, a soft shade below, the
     accent's halo where it is cool; all clear of the label */
  .disc.core {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--c-accent, #4f46e5);
    background-image: var(--fx-orb-sheen, none);
    box-shadow: var(--fx-orb-rim), var(--fx-now-aura, 0 18px 40px -18px rgb(79 70 229 / 0.6));
    transition: box-shadow 260ms var(--ease-out);
  }

  @media (hover: hover) and (pointer: fine) {
    :global(.now:hover) .disc.core {
      box-shadow: var(--fx-orb-rim), var(--fx-now-aura-hi, 0 18px 40px -18px rgb(79 70 229 / 0.6));
    }
  }

  :global(.now:active) .disc.core {
    box-shadow: var(--fx-orb-rim), var(--fx-now-aura-press, 0 18px 40px -18px rgb(79 70 229 / 0.6));
    transition-duration: var(--dur-1);
    transition-timing-function: var(--ease-out);
  }

  .label {
    color: var(--c-on-accent, #ffffff);
    font-family: var(--font-display, inherit);
    font-size: 30px;
    font-weight: 500;
    line-height: 1.2;
    white-space: nowrap;
  }

  /* Forced colours: the outline of Now and its core, the label in them */
  @media (forced-colors: active) {
    .disc {
      background: none;
    }

    .bead > .disc,
    .disc.core {
      border: 2px solid ButtonText;
    }

    .label {
      color: ButtonText;
    }
  }
</style>
