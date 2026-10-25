<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Saved — the same screen for every check-in, saved or skipped, whatever
   * the answers (owner decision: one ending for all; ui.md §6.5
   * "Saved"): "Saved", one orienting line that evaluates nothing, Done and
   * Undo in the check-in's footer row, Done where Save was, so the thumb that
   * just saved is already on it. Done, a tap anywhere else or 5 s return
   * home, where a toast offers Undo for 10 s more. It arrives calmly (ui.md §5.1): the
   * status fades in rising 10 px in 400 ms, the buttons 60 ms later; no
   * drawn check, no pop, no colour flash, the same for every outcome.
   * An Undo that fails (a storage error) leaves the check-in saved: the
   * buttons come back, one line above them says so, and the 5 s start again.
   */
  import { onDestroy, onMount } from "svelte";
  import { t } from "../../lib/i18n.svelte.ts";
  import { arrive, DUR, EASE, reveal } from "../../lib/motion.ts";
  import { SAVED_MS } from "../../lib/lastSaved.ts";
  import { refreshViewport } from "../../lib/viewport.ts";

  interface Props {
    /** True once the form is back; false when the check-in is still saved. */
    onundo: () => Promise<boolean>;
    ondone: () => void;
  }

  let { onundo, ondone }: Props = $props();

  let undoing = $state(false);
  let undoFailed = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let statusEl = $state<HTMLElement | null>(null);
  let actionsEl = $state<HTMLElement | null>(null);
  let destroyed = false;

  onMount(() => {
    // The note it replaced may have had the keyboard up, and a removed field
    // fires no blur everywhere: read the viewport again
    refreshViewport();
    timer = setTimeout(ondone, SAVED_MS);
    const calm = { offset: 10, from: 0, duration: DUR[5], easing: EASE.emphasized };
    arrive(statusEl, "up", calm);
    arrive(actionsEl, "up", { ...calm, delay: 60 });
  });

  onDestroy(() => {
    destroyed = true;
    if (timer) clearTimeout(timer);
  });

  async function undo() {
    if (undoing) return;
    if (timer) clearTimeout(timer);
    undoing = true;
    undoFailed = false;
    const undone = await onundo().catch(() => false);
    // Undone: the form replaces this screen
    if (undone || destroyed) return;
    undoing = false;
    undoFailed = true;
    timer = setTimeout(done, SAVED_MS);
  }

  let left = false;
  function done() {
    if (left || undoing) return;
    left = true;
    if (timer) clearTimeout(timer);
    ondone();
  }

  /** A tap anywhere but on Undo returns home too (keyboard: Done) */
  function tapAnywhere(e: MouseEvent) {
    if (!(e.target as HTMLElement | null)?.closest("button")) done();
  }
</script>

<main class="saved">
  <div class="area" role="presentation" onclick={tapAnywhere}>
    <div class="status" role="status" aria-label={t("checkin.saved.aria")} bind:this={statusEl}>
      <svg class="check" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r="26" />
        <path d="M17 29l7 7 15-16" />
      </svg>
      <h1 class="title">{t("checkin.saved.title")}</h1>
      <p class="return">{t("checkin.saved.return")}</p>
    </div>
    <!-- Above the buttons, which stay where they are -->
    {#if undoFailed}<p class="failed" role="alert" use:reveal>{t("checkin.saved.undoFailed")}</p>{/if}
    <!-- Done comes first in the DOM, so it is the first Tab stop; CSS keeps
         Undo on the left, where Back was -->
    <div class="actions" bind:this={actionsEl}>
      <button type="button" class="done btn-primary" onclick={done} disabled={undoing}>
        {t("common.done")}
      </button>
      <button type="button" class="undo btn-secondary quiet" onclick={undo} disabled={undoing}>
        {undoing ? t("checkin.saved.undoing") : t("checkin.saved.undo")}
      </button>
    </div>
  </div>
</main>

<style>
  .saved {
    flex: 1;
    display: flex;
  }

  .area {
    flex: 1;
    display: flex;
    flex-direction: column;
    cursor: default;
    position: relative;
  }

  .status {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    text-align: center;
  }

  /* Muted, orienting, the same for every check-in */
  .return {
    margin: -0.5rem 0 0;
    font-size: 0.9375rem;
    color: var(--c-muted, #5c6670);
  }

  /* "Couldn't undo": plain words, no alarm colour (CheckInFlow .failed) */
  .failed {
    margin: 0;
    font-size: 0.9375rem;
    text-align: center;
    color: var(--c-ink, #1e2a26);
  }

  /* The check-in footer's row and spacing (CheckInFlow .foot): Done where
     Save was, at the bottom right under the thumb, Undo where Back was */
  .actions {
    display: flex;
    gap: 0.75rem;
    padding: 0.75rem 0 calc(0.5rem + var(--safe-bottom, 0px));
  }

  :global(html[data-handed="left"]) .actions {
    flex-direction: row-reverse;
  }

  /* Looks: `.btn-primary` / `.btn-secondary` (fx.css); matte status: no
     halo, no glow, nothing that reads as a reward */
  .done {
    flex: 1;
    min-width: 0;
    height: 56px;
    font: inherit;
    font-size: 1.0625rem;
    font-weight: 600;
  }

  .check {
    width: 56px;
    height: 56px;
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .check circle {
    stroke: var(--c-accent, #4f46e5);
  }

  .check path {
    stroke: var(--c-ink, #1e2a26);
  }

  .title {
    margin: 0;
    font-size: 1.375rem;
    font-weight: 500;
  }

  .undo {
    order: -1;
    flex: none;
    height: 56px;
    padding: 0 1.5rem;
    font: inherit;
  }
</style>
