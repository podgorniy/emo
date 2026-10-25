<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The open record's code is a chunk of its own: History fetches it once
   * the first rows are on screen, so opening a record never waits for it.
   */
  let record: Promise<typeof import("./HistoryRecord.svelte")> | undefined;
  export function loadRecord() {
    record ??= import("./HistoryRecord.svelte").catch((err) => {
      record = undefined;
      throw err;
    });
    return record;
  }
</script>

<script lang="ts">
  /**
   * One check-in in History. Collapsed, an index of the moment: time ·
   * situation, the body, the note's first line — never valence, arousal or
   * the word. Open, the whole record (`HistoryRecord.svelte`). A WAI-ARIA
   * disclosure whose name is line 1 and never changes. The record grows
   * open in 280 ms and its content fades in after it; closing, it fades and
   * folds in 200 ms and only then leaves the page (ui.md §5.1).
   * Open, its row stays in view under the day's header while the record
   * scrolls under it (lib/sticky.ts). A reading surface: no glow anywhere.
   * Specification: ui.md §15.6, §15.9, §15.16.
   */
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import { type HistoryItem, rowView } from "../../lib/history.ts";
  import { motionOK } from "../../lib/motion.ts";

  interface Props {
    item: HistoryItem;
    open: boolean;
    ontoggle: () => void;
    ondelete: () => void;
  }

  let { item, open, ontoggle, ondelete }: Props = $props();

  const id = $derived(item.entry.id);
  const row = $derived(rowView(item.entry, getLocale(), t));

  // Closing keeps the record on the page while it folds away
  let closing = $state(false);
  let wasOpen: boolean | null = null;
  $effect(() => {
    const now = open;
    const shut = wasOpen === true && !now;
    wasOpen = now;
    if (!shut || !motionOK()) {
      closing = false;
      return;
    }
    closing = true;
    const timer = setTimeout(() => (closing = false), 220);
    return () => clearTimeout(timer);
  });
</script>

<li class="entry">
  <h3 class="head">
    <button
      type="button"
      class="toggle"
      id="toggle-{id}"
      aria-expanded={open}
      aria-controls="entry-{id}"
      aria-describedby={open ? undefined : `summary-${id}`}
      onclick={ontoggle}
    >
      <span class="line">
        <span class="time">{row.time}{#if row.tz}<span class="tz">{` ${row.tz}`}</span>{/if}</span>
        {#if row.situation}<span class="sr-only">, </span><span class="situation">{row.situation}</span>{/if}
        <span class="markers">
          {#if row.afterEvent}<span class="sr-only">, </span><span>{t("checkin.afterEvent.badge")}</span>{/if}
          {#if item.unsynced}<span class="sr-only">, </span><span
              class="ring"
              role="img"
              aria-label={t("history.item.unsynced")}
            ></span>{/if}
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </span>
      {#if !open}
        <span class="summary" id="summary-{id}" aria-hidden="true">
          <span class="body">{row.body}</span>
          {#if row.note}<span class="note">{row.note}</span>{/if}
        </span>
      {/if}
    </button>
  </h3>
  <div class="record-clip" class:open id="entry-{id}" inert={closing || undefined}>
    <div class="record-inner">
      {#if open || closing}
        <div class="record">
          {#await loadRecord() then { default: Record }}
            <Record {item} {ondelete} />
          {/await}
        </div>
      {/if}
    </div>
  </div>
</li>

<style>
  .entry:not(:first-child) {
    border-top: 1px solid var(--c-line, #e2e8f0);
  }

  /* Held under the title and the day's header while its record scrolls; a
     closed one has nowhere to go. On the card's surface once held, with the
     card's row line under it */
  .head {
    position: sticky;
    top: calc(var(--head-top, 0px) + var(--title-h, 0px) + var(--section-h, 0px));
    z-index: 1;
    margin: 0;
    font: inherit;
  }

  .head:global([data-stuck]) {
    background: var(--c-surface, #ffffff);
    box-shadow: 0 1px 0 var(--c-line, #e2e8f0);
  }

  /* The whole row is the button: ≥ 64 px with its summary (ui.md §15.16) */
  .toggle {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
    min-height: 52px;
    padding: 0.75rem 1rem;
    border: none;
    background: none;
    color: var(--c-ink, #1c1c1a);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  @media (hover: hover) and (pointer: fine) {
    .toggle:hover {
      background: var(--c-surface-hi, var(--c-surface));
    }
  }

  .toggle:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: -3px;
    border-radius: var(--r-card, 16px);
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 0.625rem;
    width: 100%;
    min-width: 0;
    font-size: 1rem;
  }

  .time {
    flex: none;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .tz {
    font-size: 0.8125rem;
    font-weight: 400;
    color: var(--c-muted, #5c6670);
  }

  .situation {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .markers {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex: none;
    margin-left: auto;
    font-size: 0.8125rem;
    color: var(--c-muted, #5c6670);
  }

  /* The Home sync dot's "pending": a hollow ring */
  .ring {
    width: 10px;
    height: 10px;
    border: 2px solid var(--c-muted, #5c6670);
    border-radius: 50%;
  }

  .chevron {
    align-self: center;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    /* Not a spring: overshoot on a half turn would wobble */
    transition: transform 200ms var(--ease-out);
  }

  [aria-expanded="true"] .chevron {
    transform: rotate(180deg);
  }

  .summary {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    width: 100%;
    min-width: 0;
    font-size: 0.9375rem;
    line-height: 1.4;
  }

  .body {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .note {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The grid-rows fold: the row's height animates in every supported
     browser, nothing measured in script */
  .record-clip {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 200ms var(--ease-in-out);
  }

  .record-clip.open {
    grid-template-rows: 1fr;
    transition: grid-template-rows var(--dur-4) var(--ease-out);
  }

  .record-inner {
    min-height: 0;
    overflow: hidden;
  }

  /* Nothing focused in it lands under its held row (WCAG 2.4.11); :is,
     to outweigh the sections' own margin (settings.css) */
  .record :global(:is(a, button, input, [tabindex])) {
    scroll-margin-top: calc(
      var(--head-top, 0px) + var(--title-h, 0px) + var(--section-h, 0px) + 4rem
    );
  }

  .record {
    padding: 0 1rem 0.5rem;
    transition: opacity 120ms var(--ease-in);
    animation: fx-fade-in 200ms var(--ease-out) 60ms backwards;
  }

  .record-clip:not(.open) .record {
    opacity: 0;
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
