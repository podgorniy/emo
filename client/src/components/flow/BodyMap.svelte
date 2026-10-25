<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Step 1 — the body figure, front and back. Zones toggle on tap; real
   * buttons sit over the SVG at the same scale. A zone shown in both views
   * (shoulders, arms, legs) is one key; it counts in the badge of the view on
   * screen only, so the two badges always add up to the selection. On a
   * phone the switch is centered under the figure, and the null answers are
   * in the form's footer; the figure fills the height left, never below 85 % of
   * 520 px (ui.md §10: the step
   * scrolls instead).
   * Selected regions use the fixed highlight colour (principle 7); the figure
   * itself never glows, wobbles or lights up (it is the instrument). Turning
   * to the other side, the figure narrows to .86 and back in 220 ms, its
   * zones visible and tappable throughout (ui.md §5.1). Hovering or focusing a
   * zone tints its shape in the SVG, not the button's box. At
   * ≥ 900 px two columns: the figure on the left; the switch, the null
   * answers and the summary (`side`) on the right (ui.md §9, UX-16).
   * Specification: ui.md §7.1–§7.4 (geometry in viewBox 0 0 260 520,
   * `lib/bodyFigure.ts`).
   */
  import type { Snippet } from "svelte";
  import { t } from "../../lib/i18n.svelte.ts";
  import { EASE, play } from "../../lib/motion.ts";
  import { BANDS, DETAILS, HITS, PATH, SEAMS, type View } from "../../lib/bodyFigure.ts";

  interface Props {
    /** The selected keys (`whole_body` / `nowhere` exclusive, ui.md §7.4) */
    locations: string[];
    labelOf: (key: string) => string;
    ontoggle: (key: string) => void;
    /** The theme's Front/Back tab style (ui.md §14.4) */
    tabs?: "segmented" | "underline";
    /** Whole body / Nowhere under the Front/Back switch: desktop (ui.md §9) */
    controls?: Snippet;
    /** Under the controls on desktop: the selection summary (ui.md §9) */
    side?: Snippet;
  }

  let { locations, labelOf, ontoggle, tabs = "segmented", controls, side }: Props = $props();

  let view = $state<View>("front");
  let figureEl = $state<HTMLElement | null>(null);

  /** The zone under the pointer or the keyboard focus: its shape tints */
  let hovered = $state<string | null>(null);

  // The body turns around: never on the first render
  let shown: View | null = null;
  $effect(() => {
    const now = view;
    // The buttons under the pointer are gone: no tint carried to the other side
    hovered = null;
    if (shown !== null && shown !== now) {
      play(figureEl, [
        { transform: "scaleX(0.86)", opacity: 0.55 },
        { transform: "none", opacity: 1 },
      ], { duration: 220, easing: EASE.out, id: "turn" });
    }
    shown = now;
  });

  const whole = $derived(locations[0] === "whole_body");
  const isOn = (key: string) => locations.includes(key);
  /**
   * ui.md §7.1 badge: every selected zone the view on screen shows; for the other
   * view, only the selected zones that view alone shows (no double count).
   */
  const countIn = (v: View) => {
    const other = BANDS[v === "front" ? "back" : "front"];
    return Object.keys(BANDS[v]).filter((k) =>
      locations.includes(k) && (v === view || !(k in other))
    ).length;
  };

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;

  function onTabKey(e: KeyboardEvent) {
    // ui.md §5.4: ← / → switch the view and never change the step
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      view = view === "front" ? "back" : "front";
      (document.getElementById(`bodymap-tab-${view}`) as HTMLElement | null)?.focus();
    }
  }
</script>

<div class="bodymap">
  <div
    class="tabs"
    class:seg={tabs !== "underline"}
    class:underline={tabs === "underline"}
    role="tablist"
    aria-label={t("checkin.step.1.title")}
  >
    {#if tabs !== "underline"}
      <!-- The raised surface under the chosen side; it slides (ui.md §5.1) -->
      <span class="seg-puck" style:--n={2} style:--i={view === "front" ? 0 : 1} aria-hidden="true"></span>
    {/if}
    {#each ["front", "back"] as const as v (v)}
      {@const n = countIn(v)}
      <button
        type="button"
        role="tab"
        id="bodymap-tab-{v}"
        aria-selected={view === v}
        aria-controls="bodymap-figure"
        tabindex={view === v ? 0 : -1}
        aria-label={t("checkin.step.1.tab.aria", {
          view: t(v === "front" ? "checkin.step.1.tab.front" : "checkin.step.1.tab.back"),
          n,
        })}
        class:on={view === v}
        onclick={() => (view = v)}
        onkeydown={onTabKey}
      >
        <!-- The name ("Front, 1 selected") contains this visible text (WCAG 2.5.3) -->
        {t(v === "front" ? "checkin.step.1.tab.front" : "checkin.step.1.tab.back")}
        {#if n > 0}<span class="badge" aria-hidden="true">{n}</span>{/if}
      </button>
    {/each}
  </div>

  {#if controls}<div class="controls">{@render controls()}</div>{/if}
  {#if side}<div class="side">{@render side()}</div>{/if}

  <div class="stage">
  <div
    class="figure"
    id="bodymap-figure"
    bind:this={figureEl}
    role="tabpanel"
    aria-labelledby="bodymap-tab-{view}"
  >
    <svg
      viewBox="0 0 260 520"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      class:whole
    >
      <defs>
        <clipPath id="bodymap-clip"><path d={PATH[view]} /></clipPath>
      </defs>
      <path class="fill" d={PATH[view]} />
      <g clip-path="url(#bodymap-clip)">
        {#if whole}
          <rect class="whole-tint" x="0" y="0" width="260" height="520" />
        {/if}
        {#each Object.entries(BANDS[view]) as [key, d] (key)}
          <path class="band" class:on={isOn(key)} class:hover={hovered === key} {d} />
        {/each}
        {#each SEAMS[view] as d (d)}
          <path class="seam" {d} />
        {/each}
      </g>
      {#each DETAILS[view] as d (d)}
        <path class="detail" {d} />
      {/each}
      <path class="outline" d={PATH[view]} />
    </svg>

    <!-- A zone's extra targets first: its main one sits on top of them -->
    {#each HITS[view] as [key, [main, ...more]] (key)}
      {#each [...more, main] as [x, y, w, h], i (i)}
        {@const extra = i < more.length}
        <button
          type="button"
          class="hit"
          aria-pressed={isOn(key)}
          aria-label={isOn(key)
            ? t("a11y.zone.pressed", { zone: labelOf(key) })
            : t("a11y.zone.notPressed", { zone: labelOf(key) })}
          aria-hidden={extra ? "true" : undefined}
          tabindex={extra ? -1 : undefined}
          style:left={pct(x, 260)}
          style:top={pct(y, 520)}
          style:width={pct(w, 260)}
          style:height={pct(h, 520)}
          onclick={() => ontoggle(key)}
          onpointerenter={() => (hovered = key)}
          onpointerleave={() => (hovered = null)}
          onfocus={() => (hovered = key)}
          onblur={() => (hovered = null)}
        ></button>
      {/each}
    {/each}
  </div>
  </div>
</div>

<style>
  .bodymap {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
  }

  /* `segmented`: the shared `.seg` (fx.css), a recessed track and a raised
     puck that slides; `underline` below */
  .tabs {
    width: min(100%, 320px);
  }

  /* A phone: under the figure, centered; it stays first in the focus order
     (the tabs before their panel) */
  @media (max-width: 899px) {
    .tabs {
      order: 1;
      align-self: center;
      width: min(100%, 240px);
    }
  }

  /* The null answers line up with the switch above them */
  .controls {
    width: min(100%, 320px);
  }

  /* `underline`: mono caps, the active one ruled in ink; no glow, no slide */
  .tabs.underline {
    display: flex;
    gap: 24px;
    padding: 0;
    border-radius: 0;
    border-bottom: 1px solid var(--c-line, #b3bdb7);
    background: none;
  }

  .tabs.underline button {
    min-height: 44px;
    /* "Back" is a short word: still a 44 px target */
    min-width: 44px;
    padding: 0;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: none;
    color: var(--c-ink, #1e2a26);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .tabs.underline button.on {
    border-bottom-color: var(--c-ink, #1e2a26);
    font-weight: 600;
  }

  .tabs.underline button:focus-visible,
  .hit:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  .badge {
    display: inline-block;
    min-width: 1.25rem;
    margin-left: 0.375rem;
    padding: 0 0.3rem;
    border-radius: 0.625rem;
    background: var(--c-figure-sel, #4f46e5);
    color: var(--c-on-figure-sel, #ffffff);
    font-size: 0.75rem;
    line-height: 1.25rem;
  }

  /* ui.md §7.1: the figure takes the height left on the screen (the stage is a
     size container), at most 520 px; ui.md §10: never below 85 % of 520 px tall,
     the step scrolls instead */
  .stage {
    flex: 1 1 0;
    align-self: stretch;
    min-height: 442px;
    display: flex;
    justify-content: center;
    container-type: size;
  }

  .figure {
    position: relative;
    height: min(100cqh, 520px);
    aspect-ratio: 1 / 2;
  }

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  /* The contour rides on top of the fill and the zones: 2 px, continuous */
  .outline {
    fill: none;
    stroke: var(--c-ink, #1e2a26);
    stroke-width: 2;
    stroke-linejoin: round;
    /* Whole body: the outline takes the highlight in 180 ms */
    transition: stroke var(--dur-3) var(--ease-out);
  }

  .fill {
    fill: var(--c-surface, #ffffff);
  }

  /* The body's curvatures: the faintest lines, never touching a border */
  .detail {
    fill: none;
    stroke: var(--c-ink, #1e2a26);
    stroke-opacity: 0.32;
    stroke-width: 1.2;
    stroke-linecap: round;
    transition: stroke var(--dur-3) var(--ease-out);
  }

  /* A zone fills and empties in the same 140 ms (no "reward" asymmetry) */
  .band {
    fill: var(--c-figure-sel, #4f46e5);
    fill-opacity: 0;
    transition: fill-opacity var(--dur-2) var(--ease-standard);
  }

  .band.on {
    fill-opacity: 0.85;
    transition-timing-function: var(--ease-out);
  }

  /* Hover and focus tint the zone's shape in the fixed highlight, never the
     accent (Night's amber would tint the instrument); no scale: the figure
     never wobbles */
  .band.hover:not(.on) {
    fill-opacity: 0.1;
  }

  .whole-tint {
    fill: var(--c-figure-sel, #4f46e5);
    fill-opacity: 0.33;
    animation: tint-in var(--dur-3) var(--ease-out);
  }

  @keyframes tint-in {
    from {
      fill-opacity: 0;
    }
  }

  svg.whole .outline,
  svg.whole .detail {
    stroke: var(--c-figure-sel, #4f46e5);
  }

  /* The zones' borders, which are the body's own lines: stronger than the
     marks, lighter than the contour */
  .seam {
    fill: none;
    stroke: var(--c-ink, #1e2a26);
    stroke-opacity: 0.42;
    stroke-width: 1.25;
    stroke-linecap: round;
  }

  .hit {
    position: absolute;
    padding: 0;
    border: none;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
  }

  /* Desktop (ui.md §9): the figure on the left, everything else on the right */
  @media (min-width: 900px) {
    .bodymap {
      display: grid;
      grid-template-columns: 260px minmax(0, 320px);
      grid-template-rows: auto auto 1fr;
      column-gap: 2.5rem;
      row-gap: 0.75rem;
      justify-content: center;
      align-items: start;
    }

    .tabs,
    .controls,
    .side {
      grid-column: 2;
      width: 100%;
    }

    .stage {
      grid-column: 1;
      grid-row: 1 / span 3;
      align-self: stretch;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .band {
      transition: none;
    }
  }
</style>
