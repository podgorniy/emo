<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * An in-app confirmation sheet instead of `window.confirm()`
   * (ui.md §11, §10): a modal dialog that takes focus, keeps Tab
   * inside, and closes on Escape or Cancel. Without `confirmLabel` it only
   * informs, with one Close button. `cancelLabel` renames the secondary button;
   * `dismissable` lets a click on the backdrop close it (the default for an
   * information sheet, never for a confirmation). The body scrolls inside; the
   * title and the buttons stay (ui.md §4); on a phone it has a
   * reach room, so a pull down brings its first field into the bottom third
   * (ui.md §4.5) while the sheet keeps its height. It rises in over a
   * fading scrim in 280 ms and sinks away in 200 ms, inert from the moment
   * it starts leaving, so a tap never lands on it twice, and focus goes back
   * where it came from at that moment, not when it is gone (ui.md §5.1).
   *
   * It has a history entry of its own (lib/sheets.ts), so a system Back
   * cancels it like Esc (ui.md §2.2). Return in a field goes to the next field,
   * and in the last one confirms; a destructive sheet only takes focus to
   * its confirm, which also stays greyed for its first 350 ms, so a second
   * tap on the row that opened it never lands there (ui.md §5.1 settle).
   * `confirmDisabled` greys it while what it needs is missing.
   *
   * The one sheet primitive (ui.md §4.5 Reach v2): `children` is the body, and
   * `stage` goes above it, read-only (status, previews). `band` holds the
   * controls and rests at the sheet's bottom, right over the buttons, so it
   * needs no reach room; the body above it scrolls if it must. `aside` is
   * one quiet action at the left of the buttons; `size="tall"` takes all the
   * height a sheet may have. On a phone it stands on the on-screen keyboard
   * (lib/viewport.ts), no taller than what is left above it, and the field
   * typed in is kept right over the buttons. Stacked sheets are siblings in
   * the DOM, a layer higher for each one under them (lib/sheets.ts); only the
   * top one takes Esc, a backdrop tap and Tab.
   */
  import { onMount, type Snippet } from "svelte";
  import { cubicIn, expoOut } from "svelte/easing";
  import Button from "./Button.svelte";
  import { t } from "../../lib/i18n.svelte.ts";
  import { DUR, motionOK } from "../../lib/motion.ts";
  import { keepReach, PHONE, type Reach } from "../../lib/reach.ts";
  import { openSheet, type SheetHandle } from "../../lib/sheets.ts";
  import { aboveKeyboard } from "../../lib/viewport.ts";

  interface Props {
    title: string;
    /** Without it the sheet only informs, with a Close button. */
    confirmLabel?: string;
    /** The secondary button's text: Cancel with `confirmLabel`, Close without */
    cancelLabel?: string;
    /** Red only for what cannot be undone */
    destructive?: boolean;
    /** The confirm stays greyed (a field it needs is still empty) */
    confirmDisabled?: boolean;
    busy?: boolean;
    /** A backdrop click calls `oncancel` (not while busy); default `!confirmLabel` */
    dismissable?: boolean;
    onconfirm?: () => void;
    oncancel: () => void;
    children?: Snippet;
    /** Read-only, above the body: status, previews */
    stage?: Snippet;
    /** The controls: at the bottom, right over the buttons; no reach room */
    band?: Snippet;
    /** One quiet action, at the left of the buttons */
    aside?: Snippet;
    /** `tall` takes all the height a sheet may have; `content` (default) its content's */
    size?: "content" | "tall";
  }

  let {
    title,
    confirmLabel,
    cancelLabel,
    destructive = false,
    confirmDisabled = false,
    busy = false,
    dismissable,
    onconfirm,
    oncancel,
    children,
    stage,
    band,
    aside,
    size = "content",
  }: Props = $props();

  /** Fields that can take focus: not hidden ones */
  const FIELDS = "input:not([hidden]):not([type=hidden]), textarea, select";
  /** The fields Return moves between: one line of text */
  const LINES = new Set(["text", "password", "email", "search", "tel", "url", "number"]);
  /** How long a destructive confirm stays greyed after the sheet opens */
  const SETTLE_MS = 350;

  let backdrop = $state<HTMLDivElement | null>(null);
  let sheet = $state<HTMLDivElement | null>(null);
  let body = $state<HTMLDivElement | null>(null);
  let content = $state<HTMLDivElement | null>(null);
  let actions = $state<HTMLDivElement | null>(null);
  /** The destructive settle is over */
  let settled = $state(false);
  /** Its history entry (lib/sheets.ts), given up as it starts leaving */
  let entry: SheetHandle | null = null;
  /** The body's reach room; none with a band */
  let reach: Reach | null = null;
  /**
   * Whether the content overflows (the reach room aside). The body's own
   * size changes whenever that can flip (content growing to the sheet's max
   * height, shrinking below it, a resize), so a ResizeObserver on it is
   * enough
   */
  let scrolls = $state(false);
  $effect(() => {
    const el = body;
    const fit = content;
    if (!el || !fit) return;
    // A band rests low by construction: no room (ui.md §4.5)
    const room = band ? null : keepReach(el, { fit });
    reach = room;
    const observer = new ResizeObserver(() => {
      scrolls = fit.offsetHeight > el.clientHeight + 1;
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      room?.stop();
      reach = null;
    };
  });

  /**
   * The on-screen keyboard on a phone, as lib/viewport.ts says it on <html>:
   * its inset (`--kb`) and whether it is up (`data-kb`)
   */
  let kb = $state(0);
  let kbUp = $state(false);
  /** The field in the body that has focus */
  let focused = $state<HTMLElement | null>(null);
  /**
   * Typing on a phone: the sheet takes its full height on the keyboard, with
   * room above the body's content so the field comes down right over the
   * buttons. A band is there already
   */
  const typing = $derived(kbUp && focused !== null && !band);
  /** Typing at the last look: only the change matters */
  let wasTyping = false;
  $effect(() => {
    const field = focused;
    const on = typing;
    void kb; // A keyboard of another height: the field is placed again
    if (on && field) aboveKeyboard(field);
    else if (wasTyping) {
      // The keyboard went: the body rests again, the field still in view
      reach?.rest();
      if (field) aboveKeyboard(field);
    }
    wasTyping = on;
  });

  function onFocusin(e: FocusEvent) {
    const el = e.target as HTMLElement;
    focused = body?.contains(el) && el.matches(FIELDS) ? el : null;
  }

  function onFocusout(e: FocusEvent) {
    const next = e.relatedTarget;
    if (!(next instanceof Node) || !sheet?.contains(next)) focused = null;
  }

  // Svelte transitions run on WAAPI (CSP-safe) and obey the motion gate;
  // `translate` composes with the sheet's own centring transform
  const scrim = (_: Element, { out = false } = {}) => ({
    duration: motionOK() ? 200 : 0,
    easing: out ? cubicIn : expoOut,
    css: (k: number) => `opacity: ${k}`,
  });
  const rise = (_: Element, { out = false } = {}) => ({
    duration: motionOK() ? (out ? 200 : DUR[4]) : 0,
    easing: out ? cubicIn : expoOut,
    css: (k: number) => `translate: 0 ${(1 - k) * 100}%`,
  });
  /** Where focus was when it opened; given back once */
  let previous: HTMLElement | null = null;
  const giveBack = () => {
    const el = previous;
    previous = null;
    el?.focus?.();
  };
  /** Leaving: nothing in it takes a tap, a key or the focus any more */
  const leaving = (e: Event) => {
    const el = e.currentTarget as HTMLElement;
    el.inert = true;
    el.style.pointerEvents = "none";
    entry?.release();
    giveBack();
  };

  /** A layer higher for each open sheet under it (lib/sheets.ts) */
  function stackAt(depth: number) {
    for (const el of [backdrop, sheet]) {
      el?.style.setProperty("--sheet-depth", String(depth));
    }
  }

  /** An information sheet closes on a backdrop click; a confirmation does not */
  const dismiss = $derived(dismissable ?? !confirmLabel);
  const titleId = `sheet-${crypto.randomUUID()}`;
  const greyed = $derived(confirmDisabled || (destructive && !settled));

  onMount(() => {
    previous = document.activeElement as HTMLElement | null;
    // A field takes focus; otherwise the sheet itself, so it opens at its title
    // The first field a person can use (not a hidden username for password managers)
    const field = sheet?.querySelector<HTMLElement>(FIELDS);
    (field ?? sheet)?.focus({ preventScroll: true });
    const timer = setTimeout(() => (settled = true), SETTLE_MS);
    // Back cancels it, as Esc does; not while busy (it keeps its entry)
    const handle = openSheet(() => {
      if (busy) return false;
      oncancel();
    }, stackAt);
    entry = handle;
    stackAt(handle.depth);
    // The keyboard, each time lib/viewport.ts writes it
    const html = document.documentElement;
    const phone = matchMedia(PHONE);
    const keyboard = () => {
      kb = parseFloat(getComputedStyle(html).getPropertyValue("--kb")) || 0;
      kbUp = phone.matches && html.hasAttribute("data-kb");
    };
    keyboard();
    const watch = new MutationObserver(keyboard);
    watch.observe(html, { attributes: true, attributeFilter: ["style", "data-kb"] });
    return () => {
      clearTimeout(timer);
      watch.disconnect();
      handle.release();
      giveBack();
    };
  });

  /** Return in a one-line field: the next field, or the confirm */
  function onEnter(e: KeyboardEvent) {
    const target = e.target;
    if (
      !sheet || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey ||
      e.metaKey || e.shiftKey || !(target instanceof HTMLInputElement) ||
      !LINES.has(target.type)
    ) {
      return;
    }
    const fields = [...sheet.querySelectorAll<HTMLInputElement>(FIELDS)].filter((f) =>
      f instanceof HTMLInputElement && LINES.has(f.type) && !f.disabled && !f.readOnly
    );
    const at = fields.indexOf(target);
    if (at < 0) return;
    const next = fields[at + 1];
    if (next) {
      e.preventDefault();
      next.focus({ preventScroll: true });
      aboveKeyboard(next);
    } else if (confirmLabel) {
      e.preventDefault();
      // What cannot be undone is never one keystroke away: focus only
      const confirm = actions?.lastElementChild as HTMLElement | null;
      if (destructive) confirm?.focus({ preventScroll: true });
      else if (!busy && !greyed) onconfirm?.();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    // A sheet under another one leaves every key to it
    if (!entry?.top) return;
    if (e.key === "Escape") {
      // Never on to the pane, or to a sheet under it
      e.stopPropagation();
      if (busy) return;
      e.preventDefault();
      oncancel();
    } else if (e.key === "Enter") {
      onEnter(e);
    } else if (e.key === "Tab" && sheet) {
      // In document order: a scrolling body comes before the buttons
      const focusable = [
        ...sheet.querySelectorAll<HTMLElement>(
          `.body[tabindex="0"], button:not(:disabled), ${FIELDS}`,
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<!-- A click, not a pointerdown, so the release never lands on what is under it -->
<div
  class="backdrop"
  aria-hidden="true"
  bind:this={backdrop}
  in:scrim
  out:scrim={{ out: true }}
  onoutrostart={leaving}
  onclick={() => {
    if (dismiss && !busy && entry?.top) oncancel();
  }}
></div>
<div
  class="sheet"
  class:tall={size === "tall"}
  class:banded={!!band}
  class:typing
  in:rise
  out:rise={{ out: true }}
  onoutrostart={leaving}
  role="dialog"
  aria-modal="true"
  aria-labelledby={titleId}
  tabindex="-1"
  bind:this={sheet}
  onkeydown={onKeydown}
  onfocusin={onFocusin}
  onfocusout={onFocusout}
>
  <h2 id={titleId} class="title">{title}</h2>
  <!-- A Tab stop only while it scrolls, so a keyboard can scroll it (WCAG
       2.1.1; read-only content such as the help sheet has nothing else to
       focus); a static tabindex would add a stop to every short confirmation -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="body" bind:this={body} tabindex={scrolls ? 0 : undefined}>
    <div class="content" bind:this={content}>
      {#if stage}<div class="stage">{@render stage()}</div>{/if}
      {@render children?.()}
    </div>
  </div>
  {#if band}<div class="band">{@render band()}</div>{/if}
  <div class="actions" bind:this={actions}>
    {#if aside}<div class="aside">{@render aside()}</div>{/if}
    <Button variant="secondary" onclick={oncancel} disabled={busy}>
      {cancelLabel ?? (confirmLabel ? t("common.cancel") : t("common.close"))}
    </Button>
    {#if confirmLabel}
      <Button
        variant={destructive ? "danger" : "primary"}
        onclick={onconfirm}
        disabled={greyed}
        loading={busy}
      >
        {confirmLabel}
      </Button>
    {/if}
  </div>
</div>

<style>
  /* Stacked sheets: two layers up for each one under it (lib/sheets.ts) */
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--c-scrim, rgb(0 0 0 / 0.35));
    z-index: calc(38 + 2 * var(--sheet-depth, 1));
  }

  .sheet {
    position: fixed;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: min(100%, 520px);
    /* A flex column: only the body scrolls, so the title and the buttons stay */
    display: flex;
    flex-direction: column;
    max-height: 90vh;
    max-height: 90dvh;
    overflow: hidden;
    overscroll-behavior: contain;
    padding: 1.5rem 1.25rem calc(1.25rem + var(--safe-bottom, 0px));
    background: var(--c-surface, #ffffff);
    color: var(--c-ink, #1c1c1a);
    border-radius: var(--r-card, 16px) var(--r-card, 16px) 0 0;
    /* A lit top edge on dark themes, a soft shadow up on light ones */
    box-shadow: var(--fx-rim), var(--fx-lift-up);
    z-index: calc(39 + 2 * var(--sheet-depth, 1));
    /* On the keyboard and off it at once, also under reduced motion (its
       0.01 ms transitions land a frame late), so the field is placed in the
       sheet's new box */
    transition-property: none;
  }

  .sheet.tall {
    height: 90vh;
    height: 90dvh;
  }

  .sheet:focus {
    outline: none;
  }

  .title {
    flex: none;
    margin: 0 0 0.75rem;
    font-size: 1.25rem;
  }

  /* The only scroller; the negative margin keeps focus rings and the
     scrollbar off the content (ui.md §4) */
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    margin: 0 -1.25rem 1.25rem;
    padding: var(--reach, 0px) 1.25rem 0;
    line-height: 1.5;
    /* The room and the kept height land at once (lib/reach.ts) */
    transition-property: none;
  }

  /* Its own formatting context: a first child's top margin stays inside,
     so the reach fit measures all of it (lib/reach.ts) */
  .content,
  .stage {
    display: flow-root;
  }

  /* The typing room lands at once, as the reach room does */
  .content {
    transition-property: none;
  }

  .stage:not(:last-child) {
    margin-bottom: 0.75rem;
  }

  /* With a band, the body's content rests on it when there is room to spare */
  .banded .body {
    display: flex;
    flex-direction: column;
  }

  .banded .content {
    margin-top: auto;
  }

  .band {
    flex: none;
    margin-bottom: 1.25rem;
  }

  /* Inset: the sheet clips anything outside the body's box */
  .body:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: -3px;
  }

  .actions {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  /* The quiet action at the left; the buttons stay at the right */
  .aside {
    display: flex;
    align-items: center;
    margin-inline-end: auto;
  }

  /* A phone (ui.md §4.5): it stands on the on-screen keyboard (lib/viewport.ts),
     never taller than what is left above it; with no keyboard as high as
     ever */
  @media (max-width: 899px) {
    .sheet {
      --sheet-max: min(90dvh, calc(var(--vvh, 100dvh) - var(--safe-top, 0px) - 8px));
      bottom: var(--kb, 0px);
      max-height: var(--sheet-max);
    }

    /* The keyboard covers the home indicator */
    :global(html[data-kb]) .sheet {
      --safe-bottom: 0px;
    }

    .sheet.tall,
    .sheet.typing {
      height: var(--sheet-max);
    }

    /* Room above the content, so the field typed in comes down right over
       the buttons (aboveKeyboard). A margin, not the body's padding: the
       body shrinks to what is left above the keyboard, padding never does */
    .typing .body {
      padding-top: 0;
    }

    .typing .content {
      margin-top: calc(var(--reach, 0px) + var(--vvh, 100dvh));
    }
  }
</style>
