<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The ambient light behind Home and the sign-in screens (ui.md §13.7): three
   * very soft fields of the theme's own ground, surface
   * and a little of the fixed highlight (never the accent), drawn once as
   * 200 px gradients and scaled up, drifting on 37, 53 and 71 s
   * (incommensurate, far from any breathing pace). It is never behind a
   * question: App unmounts it for the check-in and Saved, and shows it as a
   * still picture on History and Settings. A lazy chunk, loaded when idle;
   * it fades in over 900 ms. Behaviour: `lib/aura.ts`.
   */
  import { onMount } from "svelte";
  import { type AuraControl, startAura } from "../../lib/aura.ts";

  interface Props {
    /** Drifting (Home, sign-in) or a still picture (History, Settings, off) */
    moving: boolean;
    /** The screen on show: the lamp is measured again when it changes */
    screen: string;
  }

  let { moving, screen }: Props = $props();

  let root = $state<HTMLElement | null>(null);
  let on = $state(false);
  let control: AuraControl | null = null;

  onMount(() => {
    control = startAura(root!, moving);
    // "The light comes on": from the next frame, so the fade runs
    const raf = requestAnimationFrame(() => (on = true));
    return () => {
      cancelAnimationFrame(raf);
      control?.stop();
    };
  });

  $effect(() => {
    control?.setMoving(moving);
  });

  $effect(() => {
    void screen;
    // After the new screen is laid out, and once more when its lines arrive
    const raf = requestAnimationFrame(() => control?.placeLamp());
    const later = setTimeout(() => control?.placeLamp(), 400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(later);
    };
  });
</script>

<div class="aura" class:on aria-hidden="true" bind:this={root}>
  <i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i>
</div>

<style>
  /* Behind all content, above the page background; the bottom of the screen
     (the quiet lines, the pane dots) stays on the plain page */
  .aura {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    contain: strict;
    pointer-events: none;
    -webkit-mask: linear-gradient(#000 0 58%, transparent 90%);
    mask: linear-gradient(#000 0 58%, transparent 90%);
    opacity: 0;
    transition: opacity 900ms var(--ease-out);
  }

  .aura.on {
    opacity: 1;
  }

  /* will-change keeps each field a 200 px raster: a soft gradient scales up
     perfectly, and nothing is repainted while it drifts */
  .aura i {
    position: absolute;
    width: 200px;
    height: 200px;
    margin: -100px 0 0 -100px;
    border-radius: 50%;
    will-change: transform;
  }

  /* The lamp, behind Now: the surface lit with the highlight */
  .b1 {
    left: var(--lamp-x, 50%);
    top: var(--lamp-y, 42%);
    background: radial-gradient(closest-side, var(--aura-1, transparent), transparent);
    transform: scale(3.1);
    animation: a1 37s var(--ease-in-out) infinite alternate;
    transition: scale 240ms var(--ease-out);
  }

  /* The pool: the gradient's second colour, or between ground and surface */
  .b2 {
    left: 72%;
    top: 18%;
    background: radial-gradient(closest-side, var(--aura-2, transparent), transparent);
    transform: scale(4);
    animation: a2 53s var(--ease-in-out) infinite alternate;
  }

  /* Daylight: the surface */
  .b3 {
    left: 22%;
    top: 12%;
    background: radial-gradient(closest-side, var(--aura-3, transparent), transparent);
    transform: scale(3.6);
    animation: a3 71s var(--ease-in-out) infinite alternate;
  }

  /* Deep refraction: a 4th subtle ambient field for depth */
  .b4 {
    left: 45%;
    top: 68%;
    background: radial-gradient(closest-side, var(--aura-2, transparent), transparent);
    opacity: 0.6;
    transform: scale(3.2);
    animation: a4 97s var(--ease-in-out) infinite alternate;
  }

  /* At most a few px a second; well inside an eighth of the screen */
  @keyframes a1 {
    50% {
      transform: translate(14px, -10px) scale(3.3);
    }
    to {
      transform: translate(-12px, 8px) scale(3);
    }
  }

  @keyframes a2 {
    50% {
      transform: translate(-40px, 24px) scale(4.2);
    }
    to {
      transform: translate(-46px, 8px) scale(3.8);
    }
  }

  @keyframes a3 {
    50% {
      transform: translate(36px, 20px) scale(3.4);
    }
    to {
      transform: translate(10px, 44px) scale(3.8);
    }
  }

  @keyframes a4 {
    50% {
      transform: translate(-20px, -24px) scale(3.5);
    }
    to {
      transform: translate(24px, -12px) scale(3.1);
    }
  }

  /* Still (History, Settings, switched off) or asleep: no frames at all */
  .aura:global(.still) i,
  .aura:global(.asleep) i {
    animation-play-state: paused;
  }

  /* Pressing Now gathers the lamp under the finger; it springs back */
  .aura:global(.gather) .b1 {
    scale: 0.88;
  }

  .aura:not(:global(.gather)) .b1 {
    transition: scale var(--dur-spring-soft) var(--ease-spring-soft);
  }

  @media (prefers-reduced-motion: reduce) {
    .aura i {
      animation: none;
    }
  }

  /* No light at all: less transparency, more contrast, forced colours */
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active) {
    .aura {
      display: none;
    }
  }
</style>
