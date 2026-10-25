<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * History: the check-ins on this device, newest first, under each one's own
   * local day; a record opens on a tap, one at a time, and can be deleted,
   * never edited. No counts, no gaps, nothing on the rows to compare. While
   * a check-in is in progress (here or in another tab) only that is shown.
   * The plaintext lives in this component and goes with it: leaving the
   * pane, locking, signing out. A swipe or ←/→ steps to the neighbour pane
   * (← Home, → Settings); Esc and Back go Home.
   * Specification: ui.md (Part II), ui.md §11.
   */
  import "../settings/settings.css";
  import { onDestroy, onMount, tick } from "svelte";
  import type { AccountInfo } from "../../../../shared/protocol.ts";
  import type { TriggerType } from "../../../../shared/entry.ts";
  import { getLocale, t, tn } from "../../lib/i18n.svelte.ts";
  import { neighbourPane, type PaneId } from "../../lib/panes.ts";
  import { paneSwipe } from "../../lib/swipe.ts";
  import { pageRoom } from "../../lib/reach.ts";
  import { stickyHeads } from "../../lib/sticky.ts";
  import { broadcast, onBroadcast } from "../../lib/channel.ts";
  import { getMeta } from "../../lib/db.ts";
  import { stopDecryptWorker } from "../../lib/decrypt.ts";
  import { isFullPullRunning, onSyncStatus } from "../../lib/sync.ts";
  import {
    compareItems,
    dayLabel,
    deleteFromHistory,
    type Gate,
    groupByDay,
    hiddenCounts,
    type HistoryData,
    historyGate,
    type HistoryItem,
    loadHistory,
    pageEnd,
    reconcileHistory,
    whenLabel,
  } from "../../lib/history.ts";
  import ConfirmSheet from "../common/ConfirmSheet.svelte";
  import HistoryEntry, { loadRecord } from "./HistoryEntry.svelte";

  interface Props {
    account: AccountInfo;
    /** Home: Esc, a swipe right */
    onBack: () => void;
    /** Another pane of the registry (lib/panes.ts) */
    onOpenPane: (id: PaneId) => void;
    /** Continue the check-in in progress */
    onContinue: (trigger: TriggerType, reminderId: string | null) => void;
    /** "Skip it": App ends the check-in in progress as stopped, as Home's does */
    onSkipDraft: () => Promise<void>;
    /** A check-in was deleted here (the Home toast forgets it) */
    onDeleted: (entryId: string) => void;
  }

  let { account, onBack, onOpenPane, onContinue, onSkipDraft, onDeleted }: Props = $props();

  const locale = $derived(getLocale());

  let gate = $state<Gate | null>(null);
  /** Decrypted check-ins: only here, never stored (ui.md §15.17) */
  let data: HistoryData | null = null;
  /** What `data` holds, newest first; null until it is decrypted */
  let items = $state.raw<HistoryItem[] | null>(null);
  let shown = $state(0);
  /** The open record, by id: one at a time (ui.md §15.9) */
  let expanded = $state<Record<string, boolean>>({});
  let hidden = $state({ corrupt: 0, newer: 0 });
  /** "Opening check-ins…", after 300 ms so a quick open does not flash */
  let slow = $state(false);
  let evicted = $state(false);
  /** A first full pull is running: the end line says "Syncing…" */
  let syncing = $state(false);
  let announcement = $state("");
  let confirming = $state<HistoryItem | null>(null);
  let heading = $state<HTMLHeadingElement | null>(null);
  let destroyed = false;

  const days = $derived(groupByDay(items?.slice(0, shown) ?? []));
  /** One quiet note for the rows not shown (ui.md §15.14) */
  const notes = $derived(
    hidden.corrupt + hidden.newer > 0
      ? [
        hidden.corrupt && tn("settings.data.unreadable.corrupt", hidden.corrupt),
        hidden.newer && tn("settings.data.unreadable.newer", hidden.newer),
        t("settings.data.unreadable.hint"),
      ].filter((n) => n)
      : [],
  );
  /** The end of the list, or "Syncing…" while a first full pull runs */
  const endLines = $derived(
    syncing
      ? [t("history.syncing")]
      : [t("history.end"), evicted && t("history.end.evicted")].filter((n) => n),
  );

  function apply() {
    items = data?.items ?? null;
    if (data) hidden = hiddenCounts(data);
    syncing = isFullPullRunning();
  }

  /** The same words twice are still announced: the second differs by a space */
  function announce(text: string) {
    announcement = announcement === text ? `${text}\u00a0` : text;
  }

  /** Opening, reconciling: one at a time, in order */
  let queue = Promise.resolve();
  function run(job: () => Promise<void>) {
    queue = queue.then(job).catch((err) =>
      console.warn("History:", (err as Error)?.name)
    );
  }

  /**
   * On open, on return to the tab and on news from another tab: the gate
   * first, so nothing is decrypted while a check-in is in progress; then
   * everything once, later only what changed.
   */
  /**
   * "Skip it" next to "Continue it" (ui.md §15.14): the check-in ends as stopped,
   * through App as on Home. Once: both buttons wait until the list is back,
   * so a double tap never saves it twice.
   */
  let skipping = $state(false);
  async function skipDraft() {
    if (skipping) return;
    skipping = true;
    try {
      await onSkipDraft();
      run(open);
      await queue;
    } finally {
      skipping = false;
    }
    heading?.focus({ preventScroll: true });
  }

  async function open() {
    const next = await historyGate(account.id, account.current_key_version || 1);
    if (destroyed) return;
    gate = next;
    if (next.kind !== "list") {
      data = null; // drops the plaintext
      expanded = {};
      return apply();
    }
    if (data) return await reconcile();
    const timer = setTimeout(() => (slow = true), 300);
    try {
      data = await loadHistory(account.id);
      evicted = (await getMeta<boolean>("evicted")) === true;
      if (destroyed) data = null;
      apply();
      shown = pageEnd(data?.items ?? [], 0);
      void loadRecord().catch(() => {}); // the open record's code, now
    } finally {
      clearTimeout(timer);
      slow = false;
    }
  }

  /**
   * Sync, another tab, another device (ui.md §15.13): rows are inserted or removed
   * in place; open records stay open and what is on screen stays there.
   */
  async function reconcile() {
    const current = data;
    if (!current || !items || destroyed) return;
    const last = items[shown - 1];
    const keep = keepScroll();
    const left = await reconcileHistory(current, account.id);
    if (data !== current) return;
    apply();
    shown = pageEnd(
      current.items,
      last ? current.items.filter((i) => compareItems(i, last) <= 0).length : 0,
      last ? 0 : undefined,
    );
    if (left.some((id) => expanded[id])) announce(t("history.deleted"));
    for (const id of left) delete expanded[id];
    await tick();
    keep();
  }

  /**
   * New rows above the viewport must not push it down: browsers with scroll
   * anchoring see to it; elsewhere (Safari) the first row in view is put
   * back where it was. At the top of the list nothing is held, as scroll
   * anchoring does at the very top: on a phone that is the reach room's
   * edge (lib/reach.ts), where anchoring would hold, so the place is put back.
   */
  function keepScroll(): () => void {
    const room = pageRoom();
    const page = [document.body, document.documentElement]
      .find((el) => el.scrollTop > 0);
    const at = page?.scrollTop ?? 0;
    if (page && at <= room) {
      return () => {
        page.scrollTop = at;
      };
    }
    if (CSS.supports("overflow-anchor", "auto")) return () => {};
    const row = [...document.querySelectorAll(".entry")]
      .find((el) => el.getBoundingClientRect().bottom > 0);
    const top = row?.getBoundingClientRect().top ?? 0;
    // The body or the page, whichever has been scrolled (boot.css); at the
    // very top nothing is held, as scroll anchoring does
    const scroller = [document.body, document.documentElement]
      .find((el) => el.scrollTop > 0);
    return () => {
      if (scroller && row?.isConnected) {
        scroller.scrollBy(0, row.getBoundingClientRect().top - top);
      }
    };
  }

  function onVisible() {
    if (document.visibilityState === "visible") run(open);
  }

  const stopBroadcast = onBroadcast((msg) => {
    if (msg.type === "entries") run(open);
  });
  // After each sync pass (and once now, which finds nothing to do)
  const stopStatus = onSyncStatus(() => run(reconcile));

  onMount(() => {
    // ui.md §5.5: the screen is announced by its heading
    heading?.focus({ preventScroll: true });
    document.addEventListener("visibilitychange", onVisible);
    run(open);
  });

  onDestroy(() => {
    destroyed = true;
    stopBroadcast();
    stopStatus();
    document.removeEventListener("visibilitychange", onVisible);
    stopDecryptWorker();
    data = null;
  });

  /**
   * One record at a time (ui.md §15.9): opening one closes the other. The row
   * tapped stays where it is when a record above it closes; browsers with
   * scroll anchoring see to that themselves (as in keepScroll)
   */
  function toggle(id: string) {
    if (expanded[id]) {
      settleRow(id);
      delete expanded[id];
      return;
    }
    const hold = Object.keys(expanded).length > 0 &&
        !CSS.supports("overflow-anchor", "auto")
      ? holdRow(id)
      : null;
    expanded = { [id]: true };
    if (hold) void tick().then(hold);
  }

  /**
   * A record closed from its row held at the top (lib/sticky.ts): the page
   * goes back to where the row starts, so the row stays where it is on the
   * screen and the record folds away under it rather than off the top
   */
  function settleRow(id: string) {
    const row = document.getElementById(`toggle-${id}`)?.parentElement;
    const entry = row?.parentElement;
    if (!row || !entry) return;
    const by = entry.getBoundingClientRect().top + entry.clientTop -
      row.getBoundingClientRect().top;
    if (by < -0.5) document.body.scrollBy(0, by);
  }

  /**
   * Keeps the row's toggle where it is now while the other record folds
   * away (200 ms, HistoryEntry), by scrolling the page (boot.css: body).
   * At the top nothing is held, as scroll anchoring does, and the reach
   * room never comes into view for it.
   */
  function holdRow(id: string): (() => void) | null {
    const row = document.getElementById(`toggle-${id}`);
    const page = document.body;
    const room = pageRoom();
    if (!row || page.scrollTop <= room + 1) return null;
    const top = row.getBoundingClientRect().top;
    const until = performance.now() + 320;
    const keep = () => {
      if (!row.isConnected) return;
      const by = Math.max(row.getBoundingClientRect().top - top, room - page.scrollTop);
      if (Math.abs(by) >= 1) page.scrollBy(0, by);
      if (performance.now() < until) requestAnimationFrame(keep);
    };
    return keep;
  }

  /** "Show earlier": the next page; focus on its first check-in (ui.md §15.12) */
  async function showEarlier() {
    const first = items![shown].entry.id;
    shown = pageEnd(items!, shown);
    await tick();
    document.getElementById(`toggle-${first}`)?.focus();
  }

  /**
   * Confirmed: the row goes at once, the tombstone follows under the sync
   * lock and the server hears in the background (ui.md §15.10). Focus moves to the
   * next check-in, else the previous one, else the heading.
   */
  async function confirmDelete() {
    const id = confirming!.entry.id;
    const onScreen = items!.slice(0, shown).map((i) => i.entry.id);
    const at = onScreen.indexOf(id);
    const focusId = onScreen[at + 1] ?? onScreen[at - 1];
    const done = deleteFromHistory(data!, id, account.id)
      .catch((err) => console.warn("Delete not saved:", (err as Error)?.name));
    apply();
    shown--;
    delete expanded[id];
    confirming = null;
    onDeleted(id);
    announce(t("history.deleted"));
    await tick();
    (focusId ? document.getElementById(`toggle-${focusId}`) : heading)?.focus();
    await done;
  }

  /** The neighbour pane: Home before History, Settings after it */
  function stepPane(step: 1 | -1) {
    const pane = neighbourPane("history", step);
    if (pane?.id === "home") onBack();
    else if (pane) onOpenPane(pane.id);
  }

  /** ←/→ step to the neighbour panes, Esc goes Home (fields and sheets keep their keys) */
  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (
      e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || confirming ||
      target?.closest("input, textarea, select, [role=dialog]")
    ) {
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      stepPane(e.key === "ArrowLeft" ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onBack();
    }
  }

  // ui.md §5.3: a swipe right steps to the previous pane, left to the next; rows
  // have no swipes of their own. Touch or pen; not from a field, a sheet or
  // an edge, nor zoomed (lib/swipe.ts)
  const swipe = {
    onstep: stepPane,
    canStep: (dir: -1 | 1) => neighbourPane("history", dir) !== null,
  };
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Instead of the list: no check-ins, or a check-in in progress (ui.md §15.14) -->
{#snippet state(
  title: string,
  body: string | null,
  action?: string,
  onaction?: () => void,
  second?: string,
  onsecond?: () => void,
  busy = false,
)}
  <div class="state" class:empty={!action}>
    <p class="state-title">{title}</p>
    {#if body}<p class="state-body">{body}</p>{/if}
    {#if action}
      <div class="actions">
        <button type="button" class="action" onclick={onaction} disabled={busy}>{action}</button>
        {#if second}
          <button type="button" class="action second" onclick={onsecond} disabled={busy}>{second}</button>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<div
  class="settings-container history"
  data-pane="history"
  use:paneSwipe={swipe}
  use:stickyHeads
>
  <!-- No back chevron: the pane dots at the bottom go Home (ui.md §2.2, owner
       decision 2026-10-10). The title stays in view as the list
       scrolls; the hint goes under it -->
  <header class="settings-header">
    <h1 class="settings-title" id="history-title" tabindex="-1" bind:this={heading}>
      {t("history.title")}
    </h1>
  </header>
  <p class="settings-hint">{t("history.hint")}</p>

  <main class="content" aria-labelledby="history-title" aria-busy={gate?.kind === "list" && !items}>
    {#if gate?.kind === "otherWindow"}
      {@render state(
        t("checkin.otherWindow"),
        null,
        t("checkin.otherWindow.focus"),
        () => broadcast({ type: "draft-ping" }),
      )}
    {:else if gate?.kind === "draft"}
      {@const draft = gate}
      {@render state(
        t("history.draft"),
        t("history.draft.body"),
        t("history.draft.continue"),
        () => onContinue(draft.trigger, draft.reminderId),
        t("history.draft.skip"),
        skipDraft,
        skipping,
      )}
    {:else if gate?.kind === "list" && items}
      {#if notes.length > 0}
        <div class="unreadable">
          {#each notes as note (note)}<p class="settings-note">{note}</p>{/each}
        </div>
      {/if}
      {#if items.length === 0 && notes.length === 0}
        {@render state(t("history.empty.title"), t("history.empty.body"))}
      {:else}
        {#each days as day (day.day)}
          <section class="settings-section day" aria-labelledby="day-{day.day}">
            <h2 class="section-header day-header" id="day-{day.day}">
              {dayLabel(day.day, locale, t)}
            </h2>
            <ul class="settings-card">
              {#each day.items as item (item.entry.id)}
                <HistoryEntry
                  {item}
                  open={expanded[item.entry.id] === true}
                  ontoggle={() => toggle(item.entry.id)}
                  ondelete={() => (confirming = item)}
                />
              {/each}
            </ul>
          </section>
        {/each}
        {#if shown < items.length}
          <button type="button" class="more" onclick={showEarlier}>{t("history.more")}</button>
        {:else}
          <div class="end">
            {#each endLines as line (line)}<p>{line}</p>{/each}
          </div>
        {/if}
      {/if}
    {:else if slow}
      <p class="loading">{t("history.loading")}</p>
    {/if}
  </main>

  <p class="legend" aria-hidden="true">{t("history.keyboardLegend")}</p>
  <p class="sr-only" aria-live="polite">{announcement}</p>
</div>

{#if confirming}
  {@const item = confirming}
  <ConfirmSheet
    title={t("history.delete.title")}
    confirmLabel={t("history.delete.confirm")}
    destructive
    onconfirm={confirmDelete}
    oncancel={() => (confirming = null)}
  >
    <p>{t("history.delete.body", { when: whenLabel(item.entry, locale) })}</p>
  </ConfirmSheet>
{/if}

<style>
  .action:focus-visible,
  .more:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  /* Focused on open so it is announced (ui.md §5.5), as a
     check-in step's title is; a heading is not a control: no ring */
  .settings-title:focus {
    outline: none;
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    flex: 1;
  }

  .unreadable {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: -0.75rem;
  }

  /* A day: the Settings section header, held under the title while its
     rows scroll (settings.css), its room inside its box as it always was */
  .day-header {
    margin: 0;
    padding-inline: 0.25rem;
  }

  .day {
    gap: 0.25rem;
  }

  /* Its corners clipped without making it a scroller, so an open record's
     row can stay in view in it (HistoryEntry) */
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: clip;
  }

  .state {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 1.5rem 0.25rem;
    color: var(--c-ink, #1c1c1a);
  }

  .state.empty {
    align-items: center;
    justify-content: center;
    flex: 1;
    max-height: 60vh;
    text-align: center;
  }

  .state-title {
    margin: 0;
    font-size: 1.0625rem;
    font-weight: 500;
  }

  .state-body,
  .loading,
  .end p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--c-muted, #5c6670);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  /* "Skip it": secondary, outlined, never louder than "Continue it" */
  .action.second {
    border: 1.5px solid var(--c-line, #d5dbe0);
    background: var(--c-surface, #ffffff);
    color: var(--c-ink, #1e2a26);
    font-weight: 500;
  }

  .action {
    min-height: 44px;
    padding: 0 1.25rem;
    border: none;
    border-radius: var(--r-control, 12px);
    background: var(--c-primary, #1e2a26);
    color: var(--c-on-primary, #ffffff);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .loading {
    padding: 0 0.25rem;
  }

  /* A full-width secondary button, not infinite scroll (ui.md §15.12) */
  .more {
    width: 100%;
    min-height: 48px;
    border: 1.5px solid var(--c-line, #d5dbe0);
    border-radius: var(--r-control, 12px);
    background: var(--c-surface, #ffffff);
    color: var(--c-ink, #1c1c1a);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }

  .end {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0 0.25rem;
    text-align: center;
  }

  /* ui.md §9: the keyboard legend, on desktop only */
  .legend {
    display: none;
    margin: 2rem 0 0;
    font-size: 0.8125rem;
    color: var(--c-muted, #5c6670);
    text-align: center;
  }

  @media (hover: hover) and (pointer: fine) and (min-width: 900px) {
    .legend {
      display: block;
    }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
