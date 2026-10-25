<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * An open History record: the answers in the order they were recorded
   * (body before every word), read-only, null answers at full weight, the
   * sliders as the instrument drew them, then the metadata line and Delete.
   * Specification: ui.md §15.7–§15.8, §15.10, §15.16.
   */
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import type { HistoryItem } from "../../lib/history.ts";
  import { metaText, recordFields } from "../../lib/historyRecord.ts";
  import TrackView from "./TrackView.svelte";
  import BodyGlyph from "./BodyGlyph.svelte";

  let { item, ondelete }: { item: HistoryItem; ondelete: () => void } = $props();

  const fields = $derived(recordFields(item.entry, getLocale(), t));
</script>

<!-- A skipped record keeps its label when open, its kept answers under it -->
{#if item.entry.skipped}
  <p class="status">{item.entry.abandoned ? t("history.item.leftOpen") : t("history.item.skipped")}</p>
{/if}
{#if fields.length > 0}
  <dl>
    {#each fields as f (f.label)}
      <div class="field" class:track={f.kind === "track"}>
        <dt>
          {f.label}
          {#if f.kind === "track" && f.untouched}
            <span class="not-moved" aria-hidden="true">{t("history.item.notMoved")}</span>
          {/if}
        </dt>
        <dd class:with-figure={f.kind === "text" && !!f.locations}>
          {#if f.kind === "track"}
            <TrackView field={f} />
          {:else if f.kind === "word"}
            <span class="text">{#if f.l1}<span class="l1">{`${f.l1} · `}</span>{/if}{f.text}</span>
          {:else}
            <span class="text">{f.text}</span>
            {#if f.locations}<BodyGlyph locations={f.locations} uid={item.entry.id} />{/if}
          {/if}
        </dd>
      </div>
    {/each}
  </dl>
{/if}
<p class="meta">{metaText(item, t)}</p>
<button type="button" class="settings-link delete text-action" onclick={ondelete}>
  {t("history.item.delete")}
</button>

<style>
  .status {
    margin: 0;
    padding: 0.75rem 0 0;
    border-top: 1px solid var(--c-line, #e2e8f0);
    font-size: 0.9375rem;
    color: var(--c-ink, #1c1c1a);
  }

  .status + dl {
    border-top: none;
  }

  /* The record's own width decides the BODY layout below, so a narrow
     window and large text stack too (ui.md §15.7) */
  dl {
    container: record / inline-size;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    margin: 0;
    padding: 0.75rem 0 0.25rem;
    border-top: 1px solid var(--c-line, #e2e8f0);
  }

  dt {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--c-muted, #5c6670);
  }

  .not-moved {
    font-size: 0.8125rem;
    font-weight: 400;
    letter-spacing: normal;
    text-transform: none;
  }

  dd {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin: 0;
    font-size: 1rem;
    line-height: 1.4;
  }

  /* BODY: the zone text across the full width, the figure under it,
     left-aligned (ui.md §15.7) */
  dd.with-figure {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  /* A record at least 32rem wide: the figure beside the text, on the right (stacked on mobile) */
  @container record (min-width: 32rem) {
    dd.with-figure {
      flex-direction: row;
      justify-content: space-between;
      gap: 0.75rem;
    }
  }

  .text {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .l1 {
    color: var(--c-muted, #5c6670);
  }

  .meta {
    margin: 0.875rem 0 0;
    font-size: 0.8125rem;
    color: var(--c-muted, #5c6670);
  }

  .delete:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  /* Desktop (ui.md §9): labels 140 px beside the values */
  @media (min-width: 900px) {
    .field {
      display: grid;
      grid-template-columns: 140px minmax(0, 1fr);
      align-items: baseline;
      gap: 0.75rem;
    }

    .field.track {
      align-items: start;
    }

    /* "not moved" goes under the label */
    dt {
      flex-direction: column;
      justify-content: flex-start;
      margin: 0;
    }

    .meta,
    .delete {
      margin-left: calc(140px + 0.75rem);
    }
  }
</style>
