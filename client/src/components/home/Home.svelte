<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Home: the Now circle and "after an event"; the wordmark, the sync dot and
   * the pane switcher are the shared pane bar (App, `PaneBar.svelte`). With
   * a check-in left open, Now reads "Continue" and a quiet line offers to
   * skip it — no step count, no countdown (ui.md §3). → or a
   * swipe left steps to the next pane. Nothing here ever blocks: a
   * signed-out device still records. Now is the mark in the accent
   * (`NowBead.svelte`): translucent layers round a lit bead that carries the
   * label, and on dark themes a rim light that circles three times, slowly,
   * then rests. It never moves on its own; a mouse, a drag or a tilt moves
   * the bead and the layers follow (`lib/bead.ts`). Back from a check-in,
   * Home comes back out: Now settles from .96 in 400 ms, tappable from the
   * first frame.
   * Specification: ui.md §2.1–§3, §5.1–§5.4, §14.4.
   */
  import { onDestroy, onMount } from "svelte";
  import type { AccountInfo } from "../../../../shared/protocol.ts";
  import type { CompatState } from "../../lib/api.ts";
  import { onSyncStatus, type SyncStatus } from "../../lib/sync.ts";
  import { getStoredDraft } from "../../lib/db.ts";
  import { cachedPause, pauseLabel, resumeReminders } from "../../lib/pause.ts";
  import {
    enablePush,
    keepRemindersOff,
    type PushState,
    recordPushChoice,
    remindersNotReaching,
  } from "../../lib/push.ts";
  import Toast from "../common/Toast.svelte";
  import NowBead from "./NowBead.svelte";
  import { neighbourPane, type PaneId } from "../../lib/panes.ts";
  import { paneSwipe } from "../../lib/swipe.ts";
  import { type LastSaved, undoLeft } from "../../lib/lastSaved.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import { DUR, EASE, play, takeArrival } from "../../lib/motion.ts";
  import { bead } from "../../lib/bead.ts";

  interface Props {
    account: AccountInfo;
    compat: CompatState;
    onStartCheckIn: () => void;
    /** "after an event": the same form, `trigger = after_event` (D7). */
    onAfterEvent: () => void;
    /** "Skip it": the open check-in ends as stopped on its screen. */
    onSkipDraft: () => Promise<void>;
    /** Another pane of the registry (lib/panes.ts) */
    onOpenPane: (id: PaneId) => void;
    /** The check-in just saved, while its Undo lasts (lib/lastSaved.ts) */
    lastSaved: LastSaved | null;
    onUndoLastEntry: (entryId: string) => void;
    onClearLastEntry: () => void;
  }

  let {
    compat,
    onStartCheckIn,
    onAfterEvent,
    onSkipDraft,
    onOpenPane,
    lastSaved,
    onUndoLastEntry,
    onClearLastEntry,
  }: Props = $props();

  let sync = $state<SyncStatus>("synced");
  const stopStatus = onSyncStatus((s) => (sync = s));
  onDestroy(stopStatus);

  // A check-in left open (closed, or waiting): "Continue" and "Skip it".
  // A new version is the shared update card's (App, UpdateCard.svelte).
  let draft = $state<"unknown" | "open" | "none">("unknown");
  getStoredDraft().then((d) => (draft = d !== null ? "open" : "none")).catch(() => {});

  // ui.md §5.5: returning home (from the check-in, Saved, a
  // pane) focuses the Now button
  let nowButton = $state<HTMLButtonElement | null>(null);
  let homeEl = $state<HTMLElement | null>(null);
  /** Back from the check-in (Saved, Close): ui.md §5.1 "coming back out" */
  const fromFlow = takeArrival() === "flow";
  onMount(() => {
    nowButton?.focus({ preventScroll: true });
    if (!fromFlow) return;
    play(nowButton, [
      { opacity: 0.4, transform: "scale(0.96)" },
      { opacity: 1, transform: "none" },
    ], { duration: DUR[5], easing: EASE.emphasized });
    for (const el of homeEl?.querySelectorAll(".centre > :not(.now), .bottom") ?? []) {
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: 80, easing: EASE.out });
    }
  });

  // Reminders paused (ui.md §3): one quiet line with Resume, no count, no colour
  let paused = $state<Date | null>(null);
  // Reminders off on this device without the person choosing it (ui.md §3)
  let notReaching = $state<PushState | null>(null);
  cachedPause()
    .then(async (d) => {
      paused = d;
      notReaching = await remindersNotReaching(d !== null);
    })
    .catch(() => {});

  /** "Turn on": ask from this tap; blocked or not installed → Settings */
  async function turnOn() {
    if (notReaching === "denied" || notReaching === "needs_install") {
      onOpenPane("settings");
      return;
    }
    const state = await enablePush().catch(() => notReaching);
    if (state === "on") {
      await recordPushChoice(false).catch(() => {});
      notReaching = null;
    } else {
      notReaching = state;
    }
  }

  async function keepOff() {
    await keepRemindersOff().catch(() => {});
    notReaching = null;
  }
  let resuming = $state(false);
  async function resume() {
    resuming = true;
    try {
      await resumeReminders();
      paused = null;
    } catch {
      // Offline: the line stays; Settings explains
    } finally {
      resuming = false;
    }
  }

  /** The toast rises in after Home itself when back from the check-in */
  const toastDelay = fromFlow ? 200 : 0;
  /**
   * What is left of the Undo time when this save reaches Home, read once per
   * save (Date.now() is not reactive): the toast ends at the save's
   * deadline, its rise-in included, never 10 s from now (lib/lastSaved.ts)
   */
  const undoMs = $derived(undoLeft(lastSaved) - toastDelay);
  /** The Undo toast is up: it sits where the quiet lines are */
  const toastShown = $derived(!!lastSaved && undoMs > 0);

  /**
   * A quiet line too long for one row breaks before its actions, which stay
   * together, and the dot before them hides (`data-wrapped`). Hidden, not
   * removed: the row's width does not change, so this never flips back
   */
  function breakBeforeActions(line: HTMLElement) {
    const check = () => {
      const first = line.firstElementChild as HTMLElement | null;
      const actions = line.querySelector<HTMLElement>(".line-actions");
      line.toggleAttribute(
        "data-wrapped",
        !!first && !!actions && actions.offsetTop >= first.offsetTop + first.offsetHeight,
      );
    };
    const resized = new ResizeObserver(check);
    resized.observe(line);
    return { destroy: () => resized.disconnect() };
  }

  let skipping = $state(false);
  async function skipDraft() {
    if (skipping) return;
    skipping = true;
    try {
      await onSkipDraft();
      draft = "none";
    } finally {
      skipping = false;
    }
  }

  // ui.md §5.4: → opens the next pane; ui.md §5.3: a swipe to the left does too
  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (
      e.key === "ArrowRight" && !e.altKey && !e.ctrlKey && !e.metaKey &&
      !target?.closest("input, textarea, select, [role=dialog]")
    ) {
      e.preventDefault();
      openNext();
    }
  }

  function openNext() {
    const next = neighbourPane("home", 1);
    if (next) onOpenPane(next.id);
  }

  // Touch or pen; not from a field, a sheet or an edge, nor zoomed; a drag
  // to the right pulls toward nothing (lib/swipe.ts)
  const swipe = {
    onstep: openNext,
    canStep: (dir: -1 | 1) => dir === 1 && neighbourPane("home", 1) !== null,
  };
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="home"
  data-pane="home"
  bind:this={homeEl}
  use:paneSwipe={swipe}
>
  <main class="centre">
    <!-- The visible "Now" is the name (WCAG 2.5.3); the rest describes it.
         A drag here moves the bead; a sideways one swipes the pane too, as
         anywhere on Home (it sits where the thumb swipes) -->
    <button
      type="button"
      class="now"
      bind:this={nowButton}
      aria-describedby={draft === "open" ? "draft-open" : "now-hint"}
      use:bead
      onclick={onStartCheckIn}
    >
      <NowBead label={draft === "open" ? t("home.now.continue") : t("home.now")} />
    </button>
    <span id="now-hint" class="sr-only">{t("home.now.aria")}</span>
    {#if draft === "open"}
      <p class="draft-line">
        <span id="draft-open">{t("home.draft.open")}</span>
        <button type="button" class="draft-skip text-action" onclick={skipDraft} disabled={skipping}>
          {t("home.draft.skip")}
        </button>
      </p>
    {:else}
      <button type="button" class="after-event" onclick={onAfterEvent}>
        {t("home.afterEvent")}
      </button>
    {/if}
  </main>

  <!-- Quiet lines above the pane dots (the shared pane bar's). The Undo
       toast covers them, so they wait under it, their room kept -->
  <footer class="bottom" class:hushed={toastShown}>
    {#if notReaching}
      <p class="line paused" use:breakBeforeActions>
        <span>{t("home.reminders.notReaching")}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span class="line-actions">
          <button type="button" class="update text-action" onclick={turnOn}>{t("home.reminders.turnOn")}</button>
          <span aria-hidden="true">·</span>
          <button type="button" class="update text-action" onclick={keepOff}>{t("home.reminders.keepOff")}</button>
        </span>
      </p>
    {/if}
    {#if paused}
      <p class="line paused" use:breakBeforeActions>
        <span>{t("home.reminders.paused", { date: pauseLabel(paused, getLocale()) })}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span class="line-actions">
          <button type="button" class="update text-action" disabled={resuming} onclick={resume}>
            {t("home.reminders.resume")}
          </button>
        </span>
      </p>
    {/if}
    {#if sync === "stale"}
      <p class="line" role="status">{t("home.sync.stale")}</p>
    {/if}
    {#if compat === "server_older"}
      <p class="line" role="status">{t("settings.data.serverOlder")}</p>
    {/if}
  </footer>

  {#if toastShown && lastSaved}
    {@const saved = lastSaved}
    <!-- A new save is a new toast, with its own time -->
    {#key saved}
      <Toast
        message={t("checkin.saved.title")}
        undoLabel={t("checkin.saved.undo")}
        durationMs={undoMs}
        delay={toastDelay}
        onUndo={() => onUndoLastEntry(saved.id)}
        onDismiss={onClearLastEntry}
      />
    {/key}
  {/if}
</div>

<style>
  /* Under the pane bar, down to the pane dots (fixed, 18 px + 44 px) */
  .home {
    flex: 1;
    display: flex;
    flex-direction: column;
    max-width: 680px;
    width: 100%;
    margin: 0 auto;
    padding: 0 16px calc(62px + var(--safe-bottom, 0px));
    touch-action: pan-y pinch-zoom;
  }

  @media (min-width: 900px) {
    .home {
      padding-bottom: calc(18px + var(--safe-bottom, 0px));
    }
  }

  .centre {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
  }

  /* The mark's outline; its face is NowBead's, whose core keeps the label at
     the flat accent's contrast (ui.md §14.4). A finger's drag is the bead's, so
     the page neither pans nor swipes from here; two fingers still zoom */
  .now {
    position: relative;
    width: 208px;
    height: 208px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    font: inherit;
    cursor: pointer;
    touch-action: pinch-zoom;
    transition: scale var(--dur-spring) var(--ease-spring);
  }

  .now:active {
    scale: 0.95;
    transition-duration: var(--dur-1);
    transition-timing-function: var(--ease-out);
  }

  /* The rim light (dark themes with a cool accent, --fx-ring): a pre-painted
     arc turned on the compositor, 24 s a lap, three laps, then it rests.
     Far slower than a breath; never a pulse */
  .now::before {
    content: "";
    display: var(--fx-ring, none);
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: conic-gradient(
      from 210deg,
      transparent 0 62%,
      var(--fx-ring-c, transparent) 80%,
      transparent 92%
    );
    -webkit-mask: radial-gradient(closest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px));
    mask: radial-gradient(closest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px));
    pointer-events: none;
    animation: fx-spin 24s linear 3;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .after-event {
    min-height: 44px;
    padding: 0 0.75rem;
    border: none;
    background: none;
    /* Not the accent itself: a fill colour, unchecked as text (ui.md §14.3) */
    color: var(--c-accent-text, #4338ca);
    font: inherit;
    font-size: 15px;
    text-decoration-line: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  /* Quiet: muted, no colour, no count (ui.md §3) */
  .draft-line {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin: 0;
    font-size: 15px;
    color: var(--c-muted, #5c6670);
  }

  .draft-skip {
    min-height: 44px;
    padding: 0 0.5rem;
    border: none;
    background: none;
    color: var(--c-ink, #1e2a26);
    font: inherit;
    text-decoration-line: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .bottom.hushed {
    visibility: hidden;
  }

  .line {
    margin: 0;
    font-size: 13px;
    color: var(--c-muted, #5c6670);
    text-align: center;
  }

  .line.paused {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0 0.375rem;
  }

  /* The actions break onto their own row together, never one alone */
  .line.paused .line-actions {
    display: flex;
    align-items: center;
    gap: 0 0.375rem;
    white-space: nowrap;
  }

  .line.paused:global([data-wrapped]) .sep {
    visibility: hidden;
  }

  .update {
    min-height: 44px;
    border: none;
    background: none;
    /* The line's muted colour, not the browser's button text (dark themes) */
    color: inherit;
    font: inherit;
    font-size: 13px;
    text-decoration-line: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .update:focus-visible,
  .after-event:focus-visible,
  .draft-skip:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 3px;
  }

  /* The ring follows the circle in every browser we support */
  .now:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 4px;
    box-shadow: var(--fx-focus-halo);
  }

  @media (prefers-reduced-motion: reduce) {
    .now:active {
      scale: none;
    }
  }

  /* A phone: Now and the line under it centered, a bit above the bottom;
     the quiet lines and their actions in the footer are centered too */
  @media (max-width: 899px) {
    .centre {
      justify-content: flex-end;
      align-items: center;
      gap: 16px;
      padding-bottom: 24px;
    }
  }
</style>
