<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The one pane switcher (ui.md §2.2–§3, §9). App renders it
   * once above Home, History and Settings, so it never re-mounts on a pane
   * switch and never moves: a row on the 680 px content column with a left
   * cluster — the wordmark (a tap or click goes Home; a long press opens
   * Settings) and the sync dot, whose "Not synced" text grows inside the
   * cluster — then, on a desktop (≥ 900 px), the tabs flush right against
   * the column, sticky with the page background. On a phone the same panes
   * are dots in a fixed row at the bottom centre, under the thumb. Not shown
   * in the check-in.
   *
   * The sync dot shows one of eight states (lib/syncDot.ts) in one of five
   * shapes (SyncGlyph), muted or ink, never the accent. After 500 ms of
   * hover or on keyboard focus a tooltip names the state; WCAG 1.4.13: it
   * can be hovered, Esc dismisses it, it stays while hovered or focused. A
   * tap or click (Enter, Space) syncs — unless signed out or an update is
   * needed — and opens the explanation sheet: the live state, the last sync,
   * the legend of the five shapes, the encryption line and the one action
   * when one is needed. No counts in any of it.
   */
  import { onDestroy, onMount, tick } from "svelte";
  import type { CompatState } from "../../lib/api.ts";
  import { lastSyncOk, onSyncRunning, onSyncStatus, type SyncStatus } from "../../lib/sync.ts";
  import { deviceOnline, onDeviceOnlineChange, onOfflineChange } from "../../lib/network.ts";
  import {
    announced,
    type DotState,
    dotState as stateOf,
    GLYPH_OF,
    GLYPHS,
    LEGEND_KEY,
    syncTime,
  } from "../../lib/syncDot.ts";
  import { enabledPanes, type PaneId } from "../../lib/panes.ts";
  import { pageRoom, restingTop } from "../../lib/reach.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import ConfirmSheet from "./ConfirmSheet.svelte";
  import Mark from "./Mark.svelte";
  import PaneTabs from "./PaneTabs.svelte";
  import SyncGlyph from "./SyncGlyph.svelte";

  interface Props {
    current: PaneId;
    signedOut: boolean;
    compat: CompatState;
    onSignIn: () => void;
    onSync: () => void;
    /** A dot, a tab, the wordmark or its long press: straight to that pane */
    onopen: (id: PaneId) => void;
  }

  let { current, signedOut, compat, onSignIn, onSync, onopen }: Props = $props();

  let sync = $state<SyncStatus>("synced");
  let running = $state(false);
  let offline = $state(false);
  let online = $state(deviceOnline());
  let lastOk = $state<Date | null>(null);
  onDestroy(onSyncStatus((s) => (sync = s)));
  onDestroy(onSyncRunning((r) => {
    running = r;
    if (!r) void lastSyncOk().then((d) => (lastOk = d));
  }));
  onDestroy(onOfflineChange((o) => (offline = o)));
  onDestroy(onDeviceOnlineChange((o) => (online = o)));
  void lastSyncOk().then((d) => (lastOk = d));

  const dotState: DotState = $derived(stateOf({
    signedOut,
    updateRequired: compat === "update_required",
    offline,
    deviceOnline: online,
    running,
    status: sync,
  }));

  /** The button's short name and the tooltip's (and sheet's) title / detail */
  const TIP: Record<DotState, [MessageKey, MessageKey | null, MessageKey | null]> = {
    signedOut: ["home.sync.signedOut", "home.sync.tip.signedOut.title", "home.sync.tip.signedOut.detail"],
    update: ["home.sync.tip.update.title", null, "home.sync.tip.update.detail"],
    offline: ["home.sync.tip.offline.title", null, "home.sync.tip.offline.detail"],
    unreachable: ["home.sync.tip.unreachable.title", null, "home.sync.tip.unreachable.detail"],
    sending: ["home.sync.tip.sending.title", null, null],
    stale: ["home.sync.tip.stale.title", null, "home.sync.tip.stale.detail"],
    waiting: ["home.sync.tip.waiting.title", null, "home.sync.tip.waiting.detail"],
    synced: ["home.sync.synced", "home.sync.tip.synced.title", "home.sync.tip.synced.detail"],
  };
  // A clock for "{time}" while the tooltip or the sheet is open
  let now = $state(new Date());
  const dotLabel = $derived(t(TIP[dotState][0]));
  const at = (d: Date) => syncTime(d, getLocale(), t("home.sync.justNow"), now);
  const tipTitle = $derived(
    dotState === "synced"
      ? lastOk ? t("home.sync.tip.synced.title", { time: at(lastOk) }) : t("home.sync.synced")
      : t(TIP[dotState][1] ?? TIP[dotState][0]),
  );
  const tipDetail = $derived.by(() => {
    const key = TIP[dotState][2];
    return key ? t(key) : null;
  });

  // Spoken through the polite region only into stale, signed out or
  // update_required, and back to synced from those (ui.md §3); never unreachable
  let spoken = $state("");
  let previous: DotState | null = null;
  $effect(() => {
    const next = dotState;
    if (announced(previous, next)) spoken = [tipTitle, tipDetail].filter(Boolean).join(". ");
    previous = next;
  });

  // ----- The tooltip (hover and keyboard focus) -----
  let syncButton = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  let left = $state(16);
  let top = $state(0);
  let width = $state(280);
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const clear = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) clearTimeout(timer);
    return null;
  };

  function place() {
    if (!syncButton) return;
    const r = syncButton.getBoundingClientRect();
    width = Math.min(280, innerWidth - 32);
    left = Math.max(16, Math.min(r.left, innerWidth - 16 - width));
    top = r.bottom + 8;
  }

  function show() {
    hideTimer = clear(hideTimer);
    if (open || sheetOpen) return;
    now = new Date();
    place();
    open = true;
  }

  function hide() {
    showTimer = clear(showTimer);
    hideTimer = clear(hideTimer);
    open = false;
  }

  /** Desktop: 500 ms of hover; leaving dot and tooltip closes after 150 ms */
  function hoverIn(e: PointerEvent) {
    if (e.pointerType !== "mouse") return;
    hideTimer = clear(hideTimer);
    if (!open && !showTimer) showTimer = setTimeout(() => { showTimer = null; show(); }, 500);
  }
  function hoverOut(e: PointerEvent) {
    if (e.pointerType !== "mouse") return;
    showTimer = clear(showTimer);
    if (open && document.activeElement !== syncButton) {
      hideTimer = setTimeout(hide, 150);
    }
  }

  function focused() {
    // Not when the sheet hands focus back: it has just said all of it
    if (!returning && syncButton?.matches(":focus-visible")) show();
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      hide(); // focus stays on the dot
    }
  }

  // A tap outside, or the page scrolling under it, closes it
  function outside(e: PointerEvent) {
    if (!open) return;
    const target = e.target as Node | null;
    if (target && (syncButton?.contains(target) || tipEl?.contains(target))) return;
    hide();
  }
  let tipEl = $state<HTMLElement | null>(null);
  onMount(() => {
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  });
  onDestroy(hide);

  // ----- The explanation sheet (a tap, a click, Enter or Space) -----
  let sheetOpen = $state(false);
  /** True while the closing sheet gives focus back to the dot */
  let returning = false;
  const sheetAction = $derived(
    dotState === "signedOut"
      ? t("home.sync.signedOut.action")
      : dotState === "update"
      ? t("home.sync.action.update")
      : null,
  );

  function activate() {
    hide();
    if (!signedOut && compat !== "update_required") onSync();
    now = new Date();
    sheetOpen = true;
  }

  async function closeSheet() {
    returning = true;
    // Back on the dot now: the sheet may take a moment to leave (ui.md §5.1), and
    // focus returning then must not open the tooltip over it
    if (document.activeElement?.closest("[role=dialog]")) {
      syncButton?.focus({ preventScroll: true });
    }
    sheetOpen = false;
    await tick(); // the sheet gives focus back to the dot first
    // Safari never focused the tapped dot, so the sheet gave it to the body
    if (document.activeElement === document.body) syncButton?.focus({ preventScroll: true });
    returning = false;
  }

  /** The sheet's one action: the sign-in, or the update card */
  async function act() {
    const state = dotState;
    await closeSheet();
    if (state === "signedOut") onSignIn();
    else if (state === "update") {
      // "Getting the update…" disables the button: then only show the card
      const restart = document.querySelector<HTMLButtonElement>(".update-restart");
      if (restart && !restart.disabled) restart.focus();
      else document.getElementById("update-title")?.scrollIntoView({ block: "nearest" });
    }
  }

  // "{time}" stays current while the tooltip or the sheet is open
  $effect(() => {
    if (!open && !sheetOpen) return;
    const clock = setInterval(() => (now = new Date()), 15_000);
    return () => clearInterval(clock);
  });

  // ----- The wordmark -----
  // The wordmark (ui.md §2.2): a tap or click goes Home — on Home
  // it moves focus to Now — and a 600 ms hold opens Settings, on every pane.
  // A hold that fired, a move of more than 10 px or a cancelled pointer makes
  // the click after it do nothing; a click from the keyboard always goes Home.
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressAt: { x: number; y: number } | null = null;
  let skipClick = false;
  function pressStart(e: PointerEvent) {
    skipClick = false;
    pressAt = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      skipClick = true;
      if (current !== "settings") onopen("settings");
    }, 600);
  }
  function pressMove(e: PointerEvent) {
    if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) {
      skipClick = true;
      pressEnd();
    }
  }
  function pressCancel() {
    skipClick = true;
    pressEnd();
  }
  function pressEnd() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressAt = null;
  }
  function wordmarkClick(e: MouseEvent) {
    const skip = skipClick && e.detail !== 0; // detail 0: Enter or Space
    skipClick = false;
    if (!skip) {
      if (current === "home") {
        // Back to where Home opens: on a phone the page's reach room stays
        // out of view (lib/reach.ts), so its top is the room's edge, not 0
        const page = document.body; // the scroller (boot.css)
        const top = restingTop(pageRoom(), page.scrollHeight, page.clientHeight);
        window.scrollTo({ top: 0, behavior: "smooth" });
        page.scrollTo({ top, behavior: "smooth" });
        const scrollers = document.querySelectorAll(".home, .page, main");
        scrollers.forEach((el) => (el as HTMLElement).scrollTo?.({ top: 0, behavior: "smooth" }));
      }
      onopen("home");
    }
  }
  onDestroy(pressEnd);

  // Desktop: a hairline under the sticky bar once content scrolls under it.
  // The body or the page scrolls, whichever it is (boot.css)
  let scrolled = $state(false);
  const onScroll = () => {
    scrolled = document.body.scrollTop > 0 || document.documentElement.scrollTop > 0;
    if (open) hide();
  };
  onMount(() => {
    document.body.addEventListener("scroll", onScroll, { passive: true });
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.body.removeEventListener("scroll", onScroll);
      globalThis.removeEventListener("scroll", onScroll);
    };
  });
</script>

<div class="panebar" class:scrolled>
  <div class="row">
    <div class="left">
      <button
        type="button"
        class="wordmark"
        aria-label={t("home.wordmark.aria")}
        onpointerdown={pressStart}
        onpointermove={pressMove}
        onpointerup={pressEnd}
        onpointerleave={pressEnd}
        onpointercancel={pressCancel}
        oncontextmenu={(e) => e.preventDefault()}
        onclick={wordmarkClick}
      >
        <Mark size={22} />
        {t("common.appName")}
      </button>
      <button
        type="button"
        class="sync"
        bind:this={syncButton}
        aria-label={t("a11y.syncDot", { state: dotLabel })}
        aria-describedby="sync-tip"
        aria-haspopup="dialog"
        onpointerenter={hoverIn}
        onpointerleave={hoverOut}
        onfocus={focused}
        onblur={hide}
        onkeydown={keydown}
        onclick={activate}
      >
        <SyncGlyph glyph={GLYPH_OF[dotState]} animate />
        {#if signedOut}<span class="sync-text">{dotLabel}</span>{/if}
      </button>
    </div>
    <PaneTabs {current} onopen={(id) => id !== current && onopen(id)} />
  </div>
</div>

<!-- Always in the DOM (aria-describedby), shown on hover or keyboard focus -->
<div
  id="sync-tip"
  class="tip"
  class:open
  role="tooltip"
  bind:this={tipEl}
  style:left="{left}px"
  style:top="{top}px"
  style:width="{width}px"
  onpointerenter={hoverIn}
  onpointerleave={hoverOut}
>
  <p class="tip-title">{tipTitle}</p>
  {#if tipDetail}<p class="tip-detail">{tipDetail}</p>{/if}
  <p class="tip-more">{t("home.sync.tip.more")}</p>
</div>
<p class="sr-only" aria-live="polite">{spoken}</p>

<!-- The explanation sheet: at the root, never inside the sticky bar's
     stacking context (ConfirmSheet is fixed, z 40/41). It follows the state
     live while open -->
{#if sheetOpen}
  <ConfirmSheet
    title={tipTitle}
    cancelLabel={t("common.close")}
    confirmLabel={sheetAction ?? undefined}
    dismissable
    onconfirm={act}
    oncancel={closeSheet}
  >
    {#if tipDetail}<p class="sheet-detail">{tipDetail}</p>{/if}
    {#if dotState !== "synced"}
      <p class="sheet-last">
        {lastOk ? t("home.sync.lastOk", { time: at(lastOk) }) : t("home.sync.neverOk")}
      </p>
    {/if}
    <h3 class="legend-title">{t("home.sync.legend.title")}</h3>
    <ul class="legend">
      {#each GLYPHS as glyph (glyph)}
        <li><SyncGlyph {glyph} /><span>{t(LEGEND_KEY[glyph])}</span></li>
      {/each}
    </ul>
    <p class="sheet-e2ee">{t("home.sync.legend.e2ee")}</p>
  </ConfirmSheet>
{/if}

<!-- Phones: the panes as dots, fixed at the bottom centre on every pane -->
<nav class="dots" aria-label={t("home.panes.aria")}>
  {#each enabledPanes() as pane (pane.id)}
    <button
      type="button"
      class="pane-dot"
      class:on={pane.id === current}
      aria-current={pane.id === current ? "page" : undefined}
      aria-label={t(pane.labelKey)}
      onclick={() => pane.id !== current && onopen(pane.id)}
    >
      <span aria-hidden="true"></span>
    </button>
  {/each}
</nav>

<style>
  .panebar {
    flex: none;
    width: 100%;
    z-index: 20;
  }

  /* The content column: 680 px with the panes' 16 px sides, so the tabs end
     where the content does; 50 px under the 12 px top (and the safe area) */
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    box-sizing: border-box;
    height: calc(62px + var(--safe-top, 0px));
    max-width: 680px;
    margin: 0 auto;
    padding: calc(12px + var(--safe-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) 0
      max(16px, env(safe-area-inset-left, 0px));
  }

  /* Grows (the "Not synced" text) without ever pushing the tabs */
  .left {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .wordmark {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 7px;
    min-height: 44px;
    padding: 0 0.25rem;
    border: none;
    background: none;
    color: var(--c-ink, #1c1c1a);
    font-family: var(--font-display, inherit);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .sync {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 44px;
    min-height: 44px;
    padding: 0 0 0 16px;
    overflow: hidden;
    border: none;
    background: none;
    color: var(--c-muted, #5c6670);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .sync-text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tip {
    position: fixed;
    z-index: 40;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    box-shadow: var(--fx-lift-2);
    background: var(--c-primary, #1e2a26);
    color: var(--c-on-primary, #ffffff);
    font-size: 13px;
    line-height: 1.35;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease-out, visibility 0s linear 120ms;
  }

  .tip.open {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    transition: opacity 120ms ease-out;
  }

  .tip-title {
    margin: 0;
    font-weight: 600;
  }

  .tip-detail {
    margin: 0.125rem 0 0;
    font-weight: 400;
    opacity: 0.85;
  }

  .tip-more {
    margin: 0.375rem 0 0;
    font-weight: 500;
    opacity: 0.85;
  }

  /* The explanation sheet's body (ConfirmSheet styles the frame) */
  .sheet-detail {
    margin: 0 0 0.5rem;
    color: var(--c-ink, #1c1c1a);
    font-size: 1rem;
  }

  .sheet-last,
  .sheet-e2ee {
    margin: 0 0 1rem;
    color: var(--c-muted, #5c6670);
    font-size: 0.875rem;
  }

  .sheet-e2ee {
    margin: 0;
  }

  .legend-title {
    margin: 0 0 0.375rem;
    color: var(--c-ink, #1c1c1a);
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .legend {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 32px;
    font-size: 0.9375rem;
    line-height: 1.4;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .tip,
    .tip.open {
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }
  }

  /* Desktop: sticky; once something scrolls under it, on the page's own
     background (the gradient is fixed to the viewport, as on body) with a
     hairline. Until then clear, so the light behind Home shows through */
  @media (min-width: 900px) {
    .panebar {
      position: sticky;
      top: 0;
    }

    .panebar.scrolled {
      background: var(--c-page, var(--c-ground, #e4edf1)) fixed;
      box-shadow: 0 1px 0 var(--c-line, #e2e8f0);
    }
  }

  /* Centred at the bottom, within either thumb's reach, so the same for
     either hand (ui.md §2.2, owner decision 2026-10-12) */
  .dots {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(18px + env(safe-area-inset-bottom, 0px));
    z-index: 20;
    display: flex;
    width: max-content;
    height: 44px;
    margin: 0 auto;
    border-radius: 22px;
    /* Rows scrolling under it never collide with the dots; a lit pill */
    background: var(--c-ground, #e4edf1);
    box-shadow: var(--fx-rim), var(--fx-lift-1);
  }

  /* Desktop: the tabs in the bar replace the dots */
  @media (min-width: 900px) {
    .dots {
      display: none;
    }
  }

  .pane-dot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: none;
    background: none;
    cursor: pointer;
  }

  /* The current pane's pill grows as the old one shrinks; never re-mounted,
     so plain transitions (ui.md §5.1). Matte */
  .pane-dot span {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: var(--c-line, #cbd5e0);
    transition:
      width var(--dur-4) var(--ease-spring-soft),
      background-color var(--dur-2) var(--ease-standard);
  }

  .pane-dot.on span {
    width: 22px;
    background: var(--c-accent, #4f46e5);
  }

  .wordmark:focus-visible,
  .sync:focus-visible,
  .pane-dot:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 3px;
  }
</style>
