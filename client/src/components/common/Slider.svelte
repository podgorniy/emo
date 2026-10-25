<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Measurement slider, identical in every theme (ui.md §1.11, §14.4). Never
   * shows a number (principle 8). Until the first
   * input it is "untouched": a dashed thumb at the midpoint, with no note under
   * it (owner decision 2026-10-08), and Next waits (owner decision
   * 2026-10-10). A still tap is a first input too (lib/press.ts): on the
   * thumb it answers the midpoint, elsewhere on the track the value under the
   * finger; so is Space / Enter, at the midpoint. A scroll, a pull or a pinch
   * that starts on the slider answers nothing. The thumb is the fixed
   * highlight (`--c-bloom`, principle 7) in every theme. Touched it is lit;
   * untouched it is unlit and never moves. The first input sends one ring out
   * ("set"), the same at any value. No fill: a fill would add a magnitude cue
   * (and is wrong for a bipolar scale).
   */
  import { t } from "../../lib/i18n.svelte.ts";
  import { motionOK } from "../../lib/motion.ts";
  import { isSlide, tapIntent } from "../../lib/press.ts";

  interface Props {
    value: number;
    min: number;
    max: number;
    touched: boolean;
    ariaLabel: string;
    poleLow: string;
    poleHigh: string;
    /** Bipolar slider (valence): labelled, visible centre tick. */
    poleCenter?: string;
    oninput: (value: number) => void;
  }

  let { value, min, max, touched, ariaLabel, poleLow, poleHigh, poleCenter, oninput }: Props =
    $props();

  // Words, not numbers, for screen readers too (copy.md a11y.slider.*)
  const valueText = $derived.by(() => {
    const at = (value - min) / (max - min);
    const text = at < 0.35
      ? t("a11y.slider.low", { pole: poleLow })
      : at > 0.65
      ? t("a11y.slider.high", { pole: poleHigh })
      : poleCenter ?? t("a11y.slider.mid");
    return touched ? text : t("a11y.slider.untouched", { text });
  });

  /** The thumb's diameter (CSS below): its centre travels the width less this */
  const THUMB_PX = 32;

  /**
   * The pointer pressing the range: where it went down, whether it has slid
   * along the track and a range input answered, and a value the browser set
   * by itself that waits until the press shows what it is
   */
  let down: {
    id: number;
    touch: boolean;
    x: number;
    y: number;
    slid: boolean;
    answered: boolean;
    held: number | null;
  } | null = null;

  /** The press is over unanswered: what the browser set by itself goes back */
  function drop(range: HTMLInputElement) {
    if (down?.held != null) range.value = String(value);
    down = null;
  }

  // Answers wait for the pointer to go up still (lib/press.ts): a press the
  // browser takes for a scroll or a zoom (pointercancel) answers nothing
  function onpointerdown(e: PointerEvent) {
    // A second finger is a pinch's; the browser takes those (pinch-zoom)
    if (!e.isPrimary) return;
    // A press whose up went elsewhere (a mouse let go off the range) is over
    drop(e.currentTarget as HTMLInputElement);
    if (e.button !== 0) return;
    down = {
      id: e.pointerId,
      touch: e.pointerType !== "mouse",
      x: e.clientX,
      y: e.clientY,
      slid: false,
      answered: false,
      held: null,
    };
  }

  // A slide along the track answers, with what the browser set so far
  function onpointermove(e: PointerEvent) {
    if (!down || e.pointerId !== down.id || down.slid) return;
    if (!isSlide(e.clientX - down.x, e.clientY - down.y)) return;
    down.slid = true;
    if (down.held !== null) {
      const v = down.held;
      down.held = null;
      down.answered = true;
      oninput(v);
    }
  }

  function onpointerup(e: PointerEvent) {
    if (!down || e.pointerId !== down.id) return;
    const range = e.currentTarget as HTMLInputElement;
    const box = range.getBoundingClientRect();
    const intent = tapIntent({
      downX: down.x,
      downY: down.y,
      upX: e.clientX,
      upY: e.clientY,
      cancelled: false,
      sawInput: down.answered,
      held: down.held,
      value,
      trackLeft: box.left + THUMB_PX / 2,
      trackWidth: box.width - THUMB_PX,
      min,
      max,
      step: 1,
    });
    drop(range);
    // On the thumb, the value where it is: an answer only while untouched
    const next = intent.kind === "value" ? intent.value : intent.kind === "thumb" ? value : null;
    if (next !== null && (next !== value || !touched)) oninput(next);
  }

  function onpointercancel(e: PointerEvent) {
    if (down && e.pointerId === down.id) drop(e.currentTarget as HTMLInputElement);
  }

  // Android moves the thumb to a finger at once, before the browser can tell
  // a tap from a scroll: that value waits for the press to show which it is
  function onrangeinput(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (down?.touch && !down.slid) {
      down.held = v;
      return;
    }
    if (down) down.answered = true;
    oninput(v);
  }

  function onkeydown(e: KeyboardEvent) {
    if (touched || (e.key !== " " && e.key !== "Enter")) return;
    e.preventDefault();
    oninput(value);
  }

  // The first input (pointer or keys) rings once (ui.md §5.1)
  let settle = $state(false);
  let wasTouched: boolean | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const now = touched;
    if (now && wasTouched === false && motionOK()) {
      settle = true;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => (settle = false), 450);
    }
    wasTouched = now;
    return () => {
      if (settleTimer) clearTimeout(settleTimer);
    };
  });
</script>

<div class="slider" class:untouched={!touched} class:settle class:bipolar={!!poleCenter}>
  <div class="track-wrap">
    {#if poleCenter}<span class="center-tick" aria-hidden="true"></span>{/if}
    <input
      type="range"
      {min}
      {max}
      step="1"
      {value}
      aria-label={ariaLabel}
      aria-valuetext={valueText}
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      {onpointercancel}
      {onkeydown}
      oninput={onrangeinput}
    />
  </div>
  <div class="poles" aria-hidden="true">
    <span>{poleLow}</span>
    {#if poleCenter}<span class="center">{poleCenter}</span>{/if}
    <span class="high">{poleHigh}</span>
  </div>
</div>

<style>
  .slider {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  .track-wrap {
    position: relative;
  }

  .center-tick {
    position: absolute;
    left: calc(50% - 1px);
    top: 6px;
    width: 2px;
    height: 32px;
    background: var(--c-muted, #4e5853);
    pointer-events: none;
  }

  input[type="range"] {
    width: 100%;
    height: 44px;
    margin: 0;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    cursor: pointer;
    /* A vertical drag scrolls the page (the browser then cancels the press),
       a pinch zooms; along the track the range has the finger */
    touch-action: pan-y pinch-zoom;
  }

  /* The whole control is ringed; the thumb's own light is enough halo */
  input[type="range"]:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 4px;
    border-radius: 12px;
  }

  /* ui.md §14.4: a 6 px recessed track (one rule per engine: a combined selector
     list would be dropped) */
  input[type="range"]::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 3px;
    background: var(--c-track, var(--c-line, #e2e8f0));
    box-shadow: var(--fx-inset);
  }

  input[type="range"]::-moz-range-track {
    height: 6px;
    border-radius: 3px;
    background: var(--c-track, var(--c-line, #e2e8f0));
    box-shadow: var(--fx-inset);
  }

  /* Touched: a lit bead of the fixed highlight; grabbed, it grows a little
     and glows more; released, it springs back */
  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    box-sizing: border-box;
    width: 32px;
    height: 32px;
    margin-top: -13px;
    border: 3px solid var(--c-surface, #ffffff);
    border-radius: 50%;
    background-color: var(--c-bloom, #4f46e5);
    background-image: var(--fx-thumb-sheen, none);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), var(--fx-thumb-aura);
    transition:
      transform var(--dur-spring) var(--ease-spring),
      box-shadow var(--dur-3) var(--ease-out),
      background-color var(--dur-2) var(--ease-standard);
  }

  input[type="range"]::-moz-range-thumb {
    box-sizing: border-box;
    width: 32px;
    height: 32px;
    border: 3px solid var(--c-surface, #ffffff);
    border-radius: 50%;
    background-color: var(--c-bloom, #4f46e5);
    background-image: var(--fx-thumb-sheen, none);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), var(--fx-thumb-aura);
    transition:
      transform var(--dur-spring) var(--ease-spring),
      box-shadow var(--dur-3) var(--ease-out),
      background-color var(--dur-2) var(--ease-standard);
  }

  .slider:not(.untouched) input[type="range"]:active::-webkit-slider-thumb {
    transform: scale(1.1);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), var(--fx-thumb-aura-hi);
    transition-duration: var(--dur-1), var(--dur-1), var(--dur-2);
    transition-timing-function: var(--ease-out);
  }

  .slider:not(.untouched) input[type="range"]:active::-moz-range-thumb {
    transform: scale(1.1);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), var(--fx-thumb-aura-hi);
    transition-duration: var(--dur-1), var(--dur-1), var(--dur-2);
    transition-timing-function: var(--ease-out);
  }

  /* Untouched: the dashed ring, exactly recognisable, unlit and still; the
     first input makes it solid at once (state, not decoration) */
  .untouched input[type="range"]::-webkit-slider-thumb {
    border: 2px dashed var(--c-bloom, #4f46e5);
    background-color: var(--c-surface, #ffffff);
    background-image: none;
    box-shadow: var(--fx-lift-1);
    transform: none;
    transition: none;
  }

  .untouched input[type="range"]::-moz-range-thumb {
    border: 2px dashed var(--c-bloom, #4f46e5);
    background-color: var(--c-surface, #ffffff);
    background-image: none;
    box-shadow: var(--fx-lift-1);
    transform: none;
    transition: none;
  }

  @keyframes untouched-pulse {
    0%, 100% {
      box-shadow: var(--fx-lift-1);
    }
    50% {
      box-shadow: var(--fx-lift-1), 0 0 0 4px color-mix(in srgb, var(--c-bloom, #4f46e5) 25%, transparent);
    }
  }

  .untouched input[type="range"]:focus::-webkit-slider-thumb,
  .untouched input[type="range"]:hover::-webkit-slider-thumb {
    animation: untouched-pulse 2s ease-in-out infinite;
  }

  .untouched input[type="range"]:focus::-moz-range-thumb,
  .untouched input[type="range"]:hover::-moz-range-thumb {
    animation: untouched-pulse 2s ease-in-out infinite;
  }

  /* The first input: one ring goes out and is gone (420 ms) */
  .settle input[type="range"]::-webkit-slider-thumb {
    animation: set 420ms var(--ease-out);
  }

  .settle input[type="range"]::-moz-range-thumb {
    animation: set 420ms var(--ease-out);
  }

  @keyframes set {
    from {
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), var(--fx-thumb-aura), var(--fx-set-ring);
    }
    to {
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), var(--fx-thumb-aura), var(--fx-set-ring-end);
    }
  }

  .poles {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.9375rem;
    color: var(--c-muted, #5c6670);
  }

  .poles .center {
    text-align: center;
  }

  .poles .high {
    text-align: right;
  }
</style>
