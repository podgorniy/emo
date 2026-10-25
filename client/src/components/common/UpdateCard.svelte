<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The update notice (ui.md §3, reliability.md §3): an inline
   * card that App mounts once, right under the pane bar on Home, History and
   * Settings — never in the check-in or on Saved — and that stays until the
   * person acts. "Ready": a new version is waiting; Restart now or Later
   * (this version, 24 h, this device). "Update needed to sync" (the server
   * answered 426): no Later; the button waits for the new version to arrive.
   * Hidden while a check-in form is open in another tab (the `emo-draft`
   * lock), where "needed" stays but cannot restart. Never takes focus; title
   * and body are announced once per state through a polite live region.
   * Theme tokens only: no red, no icon, no pulsing. A `<section>` with a
   * label is a `region` landmark already.
   */
  import { onDestroy, onMount } from "svelte";
  import type { CompatState } from "../../lib/api.ts";
  import { draftHeldElsewhere } from "../../lib/draftLock.ts";
  import { whenSyncIdle } from "../../lib/sync.ts";
  import {
    applyUpdate,
    didRestartFail,
    isSnoozed,
    onUpdateState,
    snoozeUpdate,
    type UpdateState,
  } from "../../lib/update.ts";
  import { t } from "../../lib/i18n.svelte.ts";

  interface Props {
    compat: CompatState;
    offline: boolean;
  }

  let { compat, offline }: Props = $props();

  let update = $state<UpdateState>("none");
  let snoozed = $state(false);
  let failed = $state(false);
  let lockedElsewhere = $state(false);
  let restarting = $state(false);
  const stop = onUpdateState((s) => {
    update = s;
    snoozed = isSnoozed();
    failed = didRestartFail();
  });
  onDestroy(stop);

  // The form open in another tab hides the card (it is never in /now here)
  async function checkLock() {
    lockedElsewhere = await draftHeldElsewhere();
  }
  let poll: ReturnType<typeof setInterval> | null = null;
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      snoozed = isSnoozed();
      void checkLock();
    }
  };
  onMount(() => {
    void checkLock();
    poll = setInterval(checkLock, 5000);
    document.addEventListener("visibilitychange", onVisible);
  });
  onDestroy(() => {
    if (poll) clearInterval(poll);
    document.removeEventListener("visibilitychange", onVisible);
  });

  const required = $derived(compat === "update_required");
  const ready = $derived(update === "ready");
  const shown = $derived(required || (ready && !snoozed && !lockedElsewhere));

  const title = $derived(
    required ? t("common.update.required.title") : t("common.update.ready.title"),
  );
  const body = $derived(
    [
      required ? t("common.update.required.body") : t("common.update.ready.body"),
      required && !ready && offline ? t("common.update.offline") : null,
      required && lockedElsewhere ? t("common.update.draftOpen") : null,
      failed ? t("common.update.failed") : null,
    ].filter(Boolean).join(" "),
  );
  const action = $derived(
    restarting
      ? t("common.update.restarting")
      : required && !ready
      ? t("common.update.getting")
      : required
      ? t("common.update.required.restart")
      : t("common.update.ready.restart"),
  );
  const disabled = $derived(restarting || !ready || (required && lockedElsewhere));

  // Announced once per state change, never as an alert
  let announced = $state("");
  let lastKey = "";
  $effect(() => {
    const key = shown ? `${title}|${body}` : "";
    if (key === lastKey) return;
    lastKey = key;
    if (shown) announced = `${title}. ${body}`;
  });

  let card = $state<HTMLElement | null>(null);

  async function restart() {
    if (disabled) return;
    restarting = true;
    await applyUpdate(() => whenSyncIdle());
  }

  /** Later: gone for 24 h; focus moves on to the pane, never lost */
  function later() {
    const hadFocus = card?.contains(document.activeElement) ?? false;
    snoozeUpdate();
    snoozed = true;
    if (!hadFocus || !card) return;
    const all = [...document.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex='-1'])",
    )];
    const after = all.find((el) =>
      !card!.contains(el) &&
      (card!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
    after?.focus();
  }
</script>

<p class="sr-only update-live" aria-live="polite">{announced}</p>
{#if shown}
  <div class="wrap">
    <section class="card" class:required bind:this={card} aria-labelledby="update-title">
      <h2 class="title" id="update-title">{title}</h2>
      <p class="body update-body">{body}</p>
      <div class="actions">
        <button
          type="button"
          class="restart update-restart btn-primary"
          class:busy={restarting}
          aria-busy={restarting ? "true" : undefined}
          {disabled}
          onclick={restart}
        >
          {#if restarting}<span class="spinner" aria-hidden="true"></span>{/if}
          {action}
        </button>
        {#if !required}
          <button type="button" class="later update-later" disabled={restarting} onclick={later}>
            {t("common.update.later")}
          </button>
        {/if}
      </div>
    </section>
  </div>
{/if}

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* The content column under the pane bar: 8 px below it, 680 px wide with
     16 px gutters; a 200 ms fade and height expansion on arrival */
  .wrap {
    flex: none;
    width: 100%;
    max-width: 680px;
    margin: 8px auto 0;
    padding: 0 16px;
    animation: arrive 200ms ease-out;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      max-height: 0;
    }
    to {
      opacity: 1;
      max-height: 320px;
    }
  }

  /* A card like Settings' (ui.md §14.4): a lit rim, a soft lift; no glow and no
     pulse, even when the update is needed */
  .card {
    padding: 14px 16px;
    border: 1px solid var(--c-line, #e2e8f0);
    border-radius: var(--r-card, 16px);
    background: var(--c-surface, #ffffff);
    box-shadow: var(--fx-rim), var(--fx-lift-1);
    transition: opacity 200ms ease-out;
  }

  /* "Needed": only a rule at the left, in the accent */
  .card.required {
    border-left: 3px solid var(--c-accent, #4f46e5);
  }

  .title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--c-ink, #1c1c1a);
  }

  .body {
    margin: 0.25rem 0 0;
    font-size: 14px;
    line-height: 1.4;
    color: var(--c-muted, #5c6670);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  /* A phone: Restart at the right edge, Later beside it (ui.md §4.5; owner decision 2026-10-10) */
  @media (max-width: 899px) {
    .actions {
      flex-direction: row-reverse;
    }
  }

  /* Looks: `.btn-primary` (fx.css); while getting the update it stays lit */
  .restart {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
    padding: 0 1rem;
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .later {
    min-height: 44px;
    padding: 0 0.75rem;
    border: none;
    background: none;
    color: var(--c-ink, #1c1c1a);
    font: inherit;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .later:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  /* Reduced motion: instant (boot.css slows everything to 0.01 ms; here 0) */
  @media (prefers-reduced-motion: reduce) {
    .wrap,
    .spinner {
      animation: none !important;
    }

    .card {
      transition-duration: 0s !important;
    }
  }
</style>
