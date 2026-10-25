<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The Home toast ("Saved · Undo"), for `durationMs` (ui.md §6.5). It rises in
   * (after `delay`, when Home itself is arriving), its
   * countdown drains on the compositor, and on timeout it sinks away in
   * 160 ms; Undo leaves at once. Under reduced motion it is simply there,
   * the bar full (ui.md §5.1). Undo is not armed until the toast has risen in
   * (`delay` + max(DUR[4], 350 ms), under reduced motion too): until then it
   * takes no pointer and ignores a click, and the toast swallows the tap, so
   * a second tap meant for what was under it ("Skip it") lands on nothing.
   * Home passes what is left of the Undo time (lib/lastSaved.ts) as
   * `durationMs`, never a fresh 10 s.
   */
  import { t } from "../../lib/i18n.svelte.ts";
  import { onDestroy, onMount } from "svelte";
  import { DUR, EASE, motionOK, play } from "../../lib/motion.ts";

  interface Props {
    message: string;
    undoLabel?: string;
    durationMs?: number;
    /** Wait this long before rising in (Home coming back from a check-in) */
    delay?: number;
    onUndo: () => void;
    onDismiss: () => void;
  }

  let {
    message,
    undoLabel = t("checkin.saved.undo"),
    durationMs = 10000,
    delay = 0,
    onUndo,
    onDismiss,
  }: Props = $props();

  /** The shortest time before Undo takes a tap, motion or not */
  const ARM_MS = 350;

  let toast = $state<HTMLElement | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let armed = $state(false);

  onMount(() => {
    play(toast, [
      { opacity: 0, transform: "translate3d(0, 16px, 0)" },
      { opacity: 1, transform: "none" },
    ], { duration: DUR[4], delay, easing: EASE.emphasized });
    timer = setTimeout(leave, durationMs + delay);
    armTimer = setTimeout(() => (armed = true), delay + Math.max(DUR[4], ARM_MS));
  });

  onDestroy(() => {
    if (timer) clearTimeout(timer);
    if (armTimer) clearTimeout(armTimer);
  });

  function undo() {
    if (armed) onUndo();
  }

  /** Timed out: it sinks away, then is gone */
  function leave() {
    const out = motionOK()
      ? play(toast, [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translate3d(0, 8px, 0)" },
      ], { duration: 160, easing: EASE.in, fill: "forwards", id: "leave" })
      : null;
    if (out) out.finished.then(onDismiss, onDismiss);
    else onDismiss();
  }

  /** Immediate dismiss with fast exit animation */
  function dismissFast() {
    if (timer) clearTimeout(timer);
    if (armTimer) clearTimeout(armTimer);
    const out = motionOK()
      ? play(toast, [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translate3d(0, 8px, 0)" },
      ], { duration: 80, easing: EASE.in, fill: "forwards", id: "leave" })
      : null;
    if (out) out.finished.then(onDismiss, onDismiss);
    else onDismiss();
  }
</script>

<div class="toast-container" class:armed role="status" aria-live="polite" bind:this={toast}>
  <div class="toast-content">
    <span class="toast-message">{message}</span>
    <div class="toast-actions">
      <button type="button" class="undo-btn btn-primary" onclick={undo}>
        {undoLabel}
      </button>
      <button
        type="button"
        class="close-btn text-action"
        aria-label={t("common.close")}
        onclick={dismissFast}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  </div>
  <div
    class="progress-bar"
    style:--toast-ms="{durationMs}ms"
    style:--toast-delay="{delay}ms"
  ></div>
</div>

<style>
  /* Above the pane dots (18 + 44 px, ui.md §2.2), never over
     the navigation; a desktop has tabs at the top instead */
  .toast-container {
    position: fixed;
    bottom: calc(var(--safe-bottom, 0px) + 70px);
    left: 1rem;
    right: 1rem;
    max-width: 440px;
    margin: 0 auto;
    background-color: var(--c-surface, #ffffff);
    border: 1px solid var(--c-line, #e2e8f0);
    border-radius: var(--r-card, 12px);
    box-shadow: var(--fx-rim), var(--fx-lift-2);
    overflow: hidden;
    z-index: 100;
    display: flex;
    flex-direction: column;
  }

  @media (min-width: 900px) {
    .toast-container {
      bottom: calc(var(--safe-bottom, 0px) + 1.25rem);
    }
  }

  .toast-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    gap: 1rem;
  }

  .toast-message {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--c-ink, #1c1c1a);
  }

  .toast-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Looks: `.btn-primary` (fx.css) */
  .undo-btn {
    min-height: 44px;
    min-width: 72px;
    font-size: 0.9375rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
  }

  .close-btn {
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--c-muted, #5c6670);
    border-radius: var(--r-card, 8px);
  }

  .close-btn:hover {
    color: var(--c-ink, #1c1c1a);
  }

  /* Not armed yet: a tap goes to the toast itself, never through it */
  .toast-container:not(.armed) .undo-btn,
  .toast-container:not(.armed) .close-btn {
    pointer-events: none;
  }

  /* The time left, drained as one compositor animation; matte */
  .progress-bar {
    height: 3px;
    background-color: var(--c-accent, #3182ce);
    transform-origin: left;
    animation: drain var(--toast-ms, 10s) linear var(--toast-delay, 0ms) forwards;
  }

  @keyframes drain {
    to {
      transform: scaleX(0);
    }
  }

  /* Still: the bar stays full (the kill switch would empty it at once) */
  @media (prefers-reduced-motion: reduce) {
    .progress-bar {
      animation: none;
    }
  }
</style>
