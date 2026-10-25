<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The check-in: 9 screens driven by the pure machine (lib/machine.ts).
   * Every change is written to the encrypted draft, so the form resumes on
   * the same screen after a reload. Steps 2–9 end their hint with a help link
   * to a read-only sheet of the step's terms, which is not part of the draft.
   * A new step is on screen and interactive at once; its heading block then
   * settles 16 px and its answers 8 px sideways in 180 ms, transform only,
   * with the step's footer pieces (the pinned null pair) moving as its
   * answers do (ui.md §5.1). Nothing waits for it.
   * Specification: ui.md §6.2–§6.5, §5.1, §6–§7.
   */
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import type { DraftV2, TriggerType } from "../../../../shared/entry.ts";
  import { BODY_ZONES, forInput, QUALITIES, URGES } from "../../../../shared/dictionaries.ts";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import * as m from "../../lib/machine.ts";
  import {
    closeCheckIn,
    finalizeIfAbandoned,
    openCheckIn,
    saveCheckIn,
    stopCheckIn,
    undoCheckIn,
  } from "../../lib/checkin.ts";
  import { saveDraft } from "../../lib/draft.ts";
  import { hasAnyEntry } from "../../lib/db.ts";
  import { broadcast } from "../../lib/channel.ts";
  import { isApplePlatform } from "../../lib/platform.ts";
  import { holdDraftLock } from "../../lib/draftLock.ts";
  import { linkRecentReminder } from "../../lib/reminderLink.ts";
  import { recordDiag } from "../../lib/diag.ts";
  import { validateNote } from "../../../../shared/entry.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import { currentEntryUi, currentLayout, getTheme, onThemeChange } from "../../lib/theme.ts";
  import { layout } from "../../lib/layout.svelte.ts";
  import { arrive, EASE, play, reveal } from "../../lib/motion.ts";
  import Slider from "../common/Slider.svelte";
  import OptionGrid from "./OptionGrid.svelte";
  import BodyMap from "./BodyMap.svelte";
  import { ZONE_ORDER } from "../../lib/bodyFigure.ts";
  import StepWord from "./StepWord.svelte";
  import StepContext from "./StepContext.svelte";
  import StepNote from "./StepNote.svelte";
  import SavedScreen from "./SavedScreen.svelte";
  import NullPair from "./NullPair.svelte";
  import ConfirmSheet from "../common/ConfirmSheet.svelte";
  import TermList from "../common/TermList.svelte";
  import { HELP_OF, helpContent, type HelpContent, loadGlossary } from "../../lib/help.ts";
  import { keepReach, type Reach } from "../../lib/reach.ts";

  interface Props {
    accountId: string;
    keyVersion: number;
    trigger?: TriggerType;
    reminderId?: string | null;
    /**
     * Back home after Saved; the entry id and when it was saved feed Home's
     * Undo (`fromSaved`, lib/lastSaved.ts): null when the page was hidden
     * since, which ends it.
     */
    onsaved: (entryId: string, savedTime: number | null) => void;
    /** Leave the form (Close, another window, abandoned). */
    onexit: () => void;
    /** Opened by the Home toast's Undo: confirm it (ui.md §6.5). */
    undone?: boolean;
  }

  let {
    accountId,
    keyVersion,
    trigger = "manual",
    reminderId = null,
    onsaved,
    onexit,
    undone = false,
  }: Props = $props();

  /** "Check-in undone", for a few seconds after an Undo. */
  let undoneNotice = $state(false);
  let undoneTimer: ReturnType<typeof setTimeout> | null = null;
  function showUndone() {
    undoneNotice = true;
    if (undoneTimer) clearTimeout(undoneTimer);
    undoneTimer = setTimeout(() => (undoneNotice = false), 4000);
  }

  const locale = $derived(getLocale());

  // The theme's variants (ui.md §14.4); controls are fixed in v1
  let theme = $state(getTheme());
  const stopTheme = onThemeChange((next) => (theme = next));
  onDestroy(stopTheme);
  // ui.layout (data.md §3.6): a phone turned sideways or a window
  // resized while the form is open makes the draft's layout `mixed`; not an
  // interaction, and the save merges the layout at that moment too. Once
  // saved (Saved on screen) the draft is gone: nothing is written back
  $effect(() => {
    void layout.phone;
    void layout.short;
    untrack(() => {
      if (!savedEntryId) update((d) => m.recordLayout(d, currentLayout()));
    });
  });
  const v = $derived(theme.v);
  const monoLabels = $derived(theme.f.labels === "mono");
  let draft = $state<DraftV2 | null>(null);
  let savedEntryId = $state<string | null>(null);
  /** When it was saved, and whether the page was hidden since (Home's Undo) */
  let savedTime = 0;
  let hiddenSinceSave = false;
  let busy = $state(false);
  /** A save past 250 ms: Save shows the busy light (under it nothing flashes) */
  let slowSave = $state(false);
  /** Save or Stop here failed (a storage error): said until the next try */
  let saveFailed = $state(false);
  let heading = $state<HTMLHeadingElement | null>(null);
  /** The step's content; `scrollEl` is its scroller, `main` */
  let bodyEl = $state<HTMLElement | null>(null);
  let scrollEl = $state<HTMLElement | null>(null);
  let roomEl = $state<HTMLElement | null>(null);
  let footStepEl = $state<HTMLElement | null>(null);
  let headEl = $state<HTMLElement | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  const step = $derived(draft ? m.STEPS[draft.step] : null);
  /**
   * Answers that never grow on their screen (a slider, the urges): the
   * question sits with them, low on the screen (ui.md §6.5)
   */
  const lowStep = $derived(
    step === "intensity" || step === "valence" || step === "arousal" || step === "head_mode" ||
      step === "urge",
  );

  /**
   * The reach room above the step (lib/reach.ts, ui.md §4.5): a
   * pull down brings its topmost answers into the bottom third; each step
   * opens with the room out of view
   */
  let reach: Reach | null = null;
  $effect(() => {
    if (!scrollEl || !roomEl) return;
    const r = keepReach(scrollEl, { spacer: roomEl });
    reach = r;
    return () => {
      r.stop();
      reach = null;
    };
  });
  /** The bar and the rule: done fraction, drawn as a scale (compositor only) */
  const progress = $derived(draft ? (draft.step + 1) / m.STEPS.length : 0);
  const valid = $derived(draft ? m.isStepValid(draft) : false);
  /**
   * Step 6 with a word but no certainty yet: Next looks disabled but still
   * answers a tap by showing the certainty (ui.md §6.10).
   */
  const needsCertainty = $derived(
    !!draft && step === "word" && draft.answers.word !== null &&
      draft.answers.word_confidence === null,
  );
  let certaintyAsked = $state(false);
  $effect(() => {
    if (!needsCertainty) certaintyAsked = false;
  });

  /** When the step last changed: forward actions wait 350 ms after it (ui.md §5.1). */
  let stepChangedAt = 0;
  /** Step 1: the zones Whole body / Nowhere set aside (ui.md §7.4). */
  let keptZones: string[] | null = null;
  const qualityLabel = (key: string) =>
    QUALITIES.find((q) => q.key === key)?.label[locale] ?? key;

  // Writes are chained so an older draft never overwrites a newer one.
  let writing: Promise<void> = Promise.resolve();
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDraft: DraftV2 | null = null;

  function flushPersist() {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (pendingDraft) {
      const d = pendingDraft;
      pendingDraft = null;
      writing = writing
        .then(() => saveDraft(accountId, d))
        .catch((err) => console.warn("Draft not saved:", err));
    }
  }

  function persist(d: DraftV2, immediate = false) {
    pendingDraft = d;
    if (immediate) {
      flushPersist();
      return;
    }
    if (persistTimer === null) {
      persistTimer = setTimeout(() => {
        persistTimer = null;
        flushPersist();
      }, 150);
    }
  }

  function update(fn: (d: DraftV2, now: number) => DraftV2) {
    if (!draft || busy) return;
    const nextDraft = fn(draft, Date.now());
    if (nextDraft === draft) return;
    const stepChanged = nextDraft.step !== draft.step;
    const forward = nextDraft.step > draft.step;
    draft = nextDraft;
    persist(nextDraft, stepChanged);
    if (stepChanged) {
      stepChangedAt = Date.now();
      keptZones = null;
      saveFailed = false;
      void arriveStep(forward ? "fwd" : "back");
      focusHeading();
    }
  }

  /** The step's heading block: carry line, eyebrow, title, hint */
  const LEAD = ".carry, .eyebrow, .title, .hint";

  /**
   * ui.md §5.1: the new step, already final and interactive, settles in from the
   * side it came from: the heading block 16 px, the answers and the step's
   * footer pieces 8 px, 180 ms, transform only (text never fades). Header,
   * Close, progress and the Back / Next row stay still. After Svelte's
   * flush (a microtask), so before the first frame.
   */
  async function arriveStep(dir: "fwd" | "back") {
    await tick();
    reach?.rest();
    if (!bodyEl) return;
    for (const el of bodyEl.children) {
      arrive(el, dir, { offset: el.matches(LEAD) ? 16 : 8, from: 1 });
    }
    arrive(footStepEl, dir, { offset: 8, from: 1 });
  }

  /**
   * ui.md §5.1 "going in": step 1 is complete and interactive in the first frame;
   * it rises 6 px from .985 in 220 ms (transform only) and the progress
   * fills from empty.
   */
  async function arriveOpen() {
    await tick();
    reach?.rest();
    const going = { offset: 6, from: 1, scale: 0.985, duration: 220 };
    arrive(bodyEl, "up", going);
    arrive(footStepEl, "up", going);
    const fill = (el: Element, to: string, pseudoElement?: string) =>
      play(el, [{ transform: "scaleX(0)" }, { transform: to }], {
        duration: 240,
        easing: EASE.out,
        id: "fill",
        ...(pseudoElement ? { pseudoElement } : {}),
      });
    for (const span of headEl?.querySelectorAll(".segments span.done") ?? []) {
      fill(span, "scaleX(1)", "::after");
    }
    for (const el of headEl?.querySelectorAll(".bar-fill, .rule-fill") ?? []) {
      fill(el, `scaleX(${progress})`);
    }
  }

  function toggleLocation(key: string) {
    update((d, now) => {
      const r = m.toggleLocationKeeping(d, key, now, keptZones);
      keptZones = r.kept;
      return r.draft;
    });
  }

  /** A tap on the greyed Next of step 6: bring the certainty into view. */
  async function askCertainty() {
    certaintyAsked = true;
    await tick();
    document.getElementById("certainty-title")?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  /**
   * Step change: focus the question so it is announced (ui.md §5.5) — on every
   * screen, the last one with the note too (no keyboard
   * opening by itself, PSY-21); only the context "other" field, when it is
   * already selected, takes focus itself (D14).
   */
  async function focusHeading() {
    await tick();
    if (!draft) return;
    const s = m.STEPS[draft.step];
    if (s === "context" && draft.answers.context_tag === "other") return;
    heading?.focus({ preventScroll: true });
  }

  async function abandonIfStale() {
    if (!draft || savedEntryId || !m.isAbandoned(draft, Date.now())) return;
    await writing;
    if (await finalizeIfAbandoned(accountId, keyVersion)) {
      draft = null;
      onexit();
    }
  }

  async function onVisibility() {
    if (savedEntryId) {
      // Saved is showing: hidden, the Undo on Home is over (lib/lastSaved.ts)
      if (document.visibilityState === "hidden") hiddenSinceSave = true;
      return;
    }
    if (!draft) return;
    if (document.visibilityState === "hidden") {
      draft = m.hide(draft, Date.now());
      persist(draft);
    } else {
      await abandonIfStale();
      if (draft) {
        draft = m.show(draft, Date.now());
        persist(draft);
      }
    }
  }

  /** The `emo-draft` lock; null in a second tab (ui.md §6.2). */
  let releaseLock: (() => void) | null = null;
  let otherWindow = $state(false);

  /** Before the first saved or skipped check-in: the orientation hint (PSY-02) */
  let firstCheckIn = $state(false);

  /** ≥ 900 px: step 1 in two columns, its summary beside the figure (ui.md §9) */
  const wide = $derived(!layout.phone);
  /** The keyboard legend says ⌘ on Apple platforms (UX-16) */
  const apple = isApplePlatform();

  onMount(async () => {
    hasAnyEntry().then((any) => (firstCheckIn = !any)).catch(() => {});
    releaseLock = await holdDraftLock();
    if (!releaseLock) {
      otherWindow = true;
      return;
    }
    // A self-started one answers a reminder still showing (reminderLink.ts)
    draft = await openCheckIn(
      accountId,
      keyVersion,
      trigger,
      reminderId,
      Date.now(),
      await currentEntryUi(),
      linkRecentReminder,
    );
    void arriveOpen();
    focusHeading();
    if (undone) showUndone();
    document.addEventListener("visibilitychange", onVisibility);
    timer = setInterval(abandonIfStale, 30_000);
  });

  onDestroy(() => {
    flushPersist();
    // The browser's (or Android's) Back left the form for another route:
    // like Close, after any pending write. A lock keeps the route (/now)
    // and leaves the draft as it was, so it resumes after the unlock.
    if (draft && !savedEntryId && location.pathname !== "/now") {
      const leaving = draft;
      void writing
        .then(() => closeCheckIn(accountId, leaving))
        .catch((err) => console.warn("Draft not closed:", err));
    }
    releaseLock?.();
    document.removeEventListener("visibilitychange", onVisibility);
    if (timer) clearInterval(timer);
    if (undoneTimer) clearTimeout(undoneTimer);
  });

  /**
   * The note validator's three counters (ui.md §8.2, reliability.md §1.8):
   * rejected once per check-in; then saved with an edited note
   * (resolved), or saved without one / skipped (cleared).
   */
  let noteRejected = false;
  $effect(() => {
    if (!draft || noteRejected) return;
    if (validateNote(draft.answers.note).error === "stop_phrase_detected") {
      noteRejected = true;
      void recordDiag("note.rejected", "checkin");
    }
  });

  async function finish(kind: "save" | "skip") {
    if (!draft || busy) return;
    if (noteRejected) {
      const kept = kind === "save" && draft.answers.note.trim() !== "";
      void recordDiag(kept ? "note.rejected_resolved" : "note.rejected_cleared", "checkin");
      noteRejected = false;
    }
    busy = true;
    saveFailed = false;
    const slow = setTimeout(() => (slowSave = true), 250);
    try {
      flushPersist();
      await writing;
      const entry = kind === "save"
        ? await saveCheckIn(accountId, keyVersion, draft, await currentEntryUi())
        : await stopCheckIn(accountId, keyVersion, draft);
      savedEntryId = entry.id;
      savedTime = Date.now();
      hiddenSinceSave = false;
    } catch (err) {
      // The answers stay on screen and the draft as it was: the person can
      // try again (the line above the nav says so)
      console.error("Check-in not saved:", err);
      saveFailed = true;
      void recordDiag("checkin.save_failed", "checkin");
    } finally {
      clearTimeout(slow);
      slowSave = false;
      busy = false;
    }
  }

  /**
   * Undo on Saved (ui.md §6.5): the form comes back, and true.
   * False when the check-in could not be deleted here (a storage error):
   * the tombstone and its `delete` are one write (`writeTombstone`), so it
   * is still saved, and Saved stays and says so. A failure after the
   * deletion (the draft's write) still brings the form back, from the
   * answers in memory (`undoCheckIn`).
   */
  async function undo(): Promise<boolean> {
    if (!savedEntryId) return false;
    const entryId = savedEntryId;
    try {
      await undoCheckIn(accountId, entryId);
    } catch (err) {
      console.error("Check-in not undone:", err);
      void recordDiag("checkin.undo_failed", "checkin");
      return false;
    }
    savedEntryId = null;
    try {
      draft = await openCheckIn(accountId, keyVersion, trigger, reminderId, Date.now(), await currentEntryUi());
    } catch (err) {
      console.warn("Draft not reopened:", err);
    }
    // Back to the last step: it comes from the left, as a Back does
    void arriveStep("back");
    focusHeading();
    showUndone();
    return true;
  }

  /** "Save without the note" (ui.md §8): note = null, saved now */
  /** "Save without the note": saves at once when a situation is chosen */
  async function saveWithoutNote() {
    if (!draft || busy) return;
    update((d, now) => m.setNote(d, "", now));
    if (draft && m.isStepValid(draft)) await finish("save");
  }

  /**
   * Close (×): the draft stays, marked as closed by the person, so it waits
   * on Home ("Continue") instead of reopening by itself; a self-started form
   * never touched leaves nothing (ui.md §6.2).
   */
  async function close() {
    if (!draft || busy) return;
    busy = true;
    try {
      flushPersist();
      await writing;
      await closeCheckIn(accountId, draft);
    } catch (err) {
      console.warn("Draft not closed:", err);
    } finally {
      busy = false;
    }
    onexit();
  }

  /**
   * The help sheet (ui.md §6.5): read-only and not an
   * interaction, so opening and closing it call no machine function, never
   * re-save the draft and leave `last_interaction_at` and every timing field
   * as they were. Not part of the draft: a reload starts with it closed.
   */
  let helpOpen = $state(false);
  let help = $state<HelpContent | null>(null);
  /** For 350 ms after the sheet closes, a transparent shield takes every tap */
  let shielded = $state(false);
  let shieldTimer: ReturnType<typeof setTimeout> | null = null;
  onDestroy(() => {
    if (shieldTimer) clearTimeout(shieldTimer);
  });

  async function openHelp() {
    if (!draft || !step || busy) return;
    const at = step;
    try {
      const glossary = await loadGlossary();
      if (!draft || step !== at) return;
      help = helpContent(at, draft.answers.word, locale, glossary, (k) => t(k));
      helpOpen = help !== null;
    } catch (err) {
      console.warn("Descriptions not loaded:", err);
    }
  }

  /** A double tap on Close never lands on an option, a slider or Next */
  function closeHelp() {
    helpOpen = false;
    shielded = true;
    if (shieldTimer) clearTimeout(shieldTimer);
    shieldTimer = setTimeout(() => (shielded = false), m.STEP_SETTLE_MS);
  }

  function goNext() {
    if (!draft || busy || !m.settled(stepChangedAt, Date.now())) return;
    if (needsCertainty) {
      void askCertainty();
      return;
    }
    if (!valid) return;
    if (draft.step === m.LAST_STEP) finish("save");
    else update(m.next);
  }

  /**
   * ui.md §5.4, only while the check-in is open: → / PageDown
   * next and ← / PageUp back when focus is not in a field (a slider keeps
   * its arrows); Ctrl/⌘ + Enter in the note saves.
   */
  function onKeydown(e: KeyboardEvent) {
    // The step behind the help sheet never changes; its Esc closes it
    if (helpOpen) return;
    if (!draft || savedEntryId || busy || e.defaultPrevented) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const target = e.target as HTMLElement | null;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      goNext();
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && target?.matches("input[type='range']")) {
      const nextBtn = document.querySelector(".next.btn-primary") as HTMLElement | null;
      if (nextBtn) {
        e.preventDefault();
        nextBtn.focus();
        return;
      }
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      goNext();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      update(m.back);
    }
  }

  // Step 2: the sensation words in the grid, the two null answers pinned
  const NULL_QUALITIES = ["nothing", "cant_tell"];
  const sensations = forInput(QUALITIES).filter((q) => !NULL_QUALITIES.includes(q.key));
  const nullQualities = forInput(QUALITIES).filter((q) => NULL_QUALITIES.includes(q.key));

  // Step 1: summary (ui.md §7.5) and the Next label (ui.md §7.6)
  const zones = BODY_ZONES.filter((z) => z.key !== "whole_body" && z.key !== "nowhere");
  const locations = $derived(draft?.answers.locations ?? []);
  // ui.md §7.5: the summary lists zones in this order
  const zoneList = $derived(
    ZONE_ORDER.filter((k) => locations.includes(k))
      .map((k) => zones.find((z) => z.key === k)?.label[locale] ?? k),
  );
  // A null answer is validated where it is given (PSY-08): "“Nowhere” is
  // an answer too."
  const locationSummary = $derived(
    locations[0] === "whole_body"
      ? t("checkin.step.1.summary.wholeBody")
      : locations[0] === "nowhere"
      ? t("checkin.null.nowhere")
      : zoneList.length > 0
      ? t("checkin.step.1.summary.selected", { list: zoneList.join(", ") })
      : t("checkin.step.1.summary.empty"),
  );
  const qualitySummary = $derived.by(() => {
    const q = draft?.answers.qualities ?? [];
    if (q.length === 0) return t("checkin.step.2.summary.none");
    if (q[0] === "nothing") return t("checkin.null.nothing");
    if (q[0] === "cant_tell") return t("checkin.null.cantTell");
    return t("checkin.step.2.summary.chosen", { list: q.map(qualityLabel).join(", ") });
  });

  /**
   * Steps 2–3 carry the "where" (and on 3 the "what it is like") above the
   * title, so the felt sense stays in view (PSY-07): context, not data.
   */
  const carry = $derived.by(() => {
    if (!draft || (step !== "qualities" && step !== "intensity")) return null;
    const where = locations[0] === "whole_body" || locations[0] === "nowhere"
      ? BODY_ZONES.find((z) => z.key === locations[0])?.label[locale] ?? ""
      : zoneList.join(", ");
    if (step === "qualities") return where || null;
    const like = QUALITIES.filter((q) => draft!.answers.qualities.includes(q.key))
      .map((q) => q.label[locale]).join(", ");
    return [where, like].filter(Boolean).join(" — ") || null;
  });

  /** Nothing to rate: nowhere, or only "nothing" / "can't tell" (PSY-08) */
  const nothingToRate = $derived(
    !!draft && step === "intensity" &&
      (locations[0] === "nowhere" ||
        (draft.answers.qualities.length > 0 &&
          draft.answers.qualities.every((q) => q === "nothing" || q === "cant_tell"))),
  );

  const nextLabel = $derived.by(() => {
    if (!draft) return "";
    if (draft.step === m.LAST_STEP) return t("common.save");
    if (draft.step > 0) return t("common.next");
    if (locations[0] === "whole_body") return t("checkin.step.1.next.wholeBody");
    if (locations[0] === "nowhere") return t("checkin.step.1.next.nowhere");
    if (zoneList.length >= 3) return t("checkin.next.count", { n: zoneList.length });
    if (zoneList.length > 0) return t("checkin.next.list", { list: zoneList.join(", ") });
    return t("common.next");
  });

  const STEP_COPY: Record<m.StepId, { title: MessageKey; hint?: MessageKey }> = {
    locations: { title: "checkin.step.1.title", hint: "checkin.step.1.hint" },
    qualities: { title: "checkin.step.2.title", hint: "checkin.step.2.hint" },
    intensity: { title: "checkin.step.3.title" },
    valence: { title: "checkin.step.4.title" },
    arousal: { title: "checkin.step.5.title" },
    word: { title: "checkin.step.6.title", hint: "checkin.step.6.hint" },
    urge: { title: "checkin.step.7.title", hint: "checkin.step.7.hint" },
    head_mode: { title: "checkin.step.8.title", hint: "checkin.step.8.hint" },
    context: { title: "checkin.step.9.title", hint: "checkin.step.9.hint" },
  };
</script>

<svelte:window onkeydown={onKeydown} />

<!-- The help link at the end of the hint, steps 2–9 (ui.md §6.5);
     the separator is an expression, since Svelte trims an element's edge spaces -->
{#snippet helpLink(sep: boolean)}{#if step && HELP_OF[step]}{#if sep}<span class="sep" aria-hidden="true">{" · "}</span>{/if}<button
      type="button"
      class="help-link text-action"
      aria-haspopup="dialog"
      onclick={openHelp}>{t(HELP_OF[step] === "words" ? "checkin.help.words" : "checkin.help.question")}</button
    >{/if}{/snippet}

<!-- Whole body / Nowhere: in the footer on a phone, beside the figure on
     desktop (ui.md §7.1, §9) -->
{#snippet locationNulls()}
  <NullPair
    ariaLabel={t("checkin.step.1.title")}
    options={[
      { key: "whole_body", label: t("checkin.step.1.wholeBody") },
      { key: "nowhere", label: t("checkin.step.1.nowhere") },
    ]}
    selected={(k) => locations[0] === k}
    ontoggle={toggleLocation}
  />
{/snippet}

<!-- Step 1's summary beside the figure on desktop (ui.md §9) -->
{#snippet summarySide()}
  <p class="summary side" class:dot={v.summary === "dot"} class:mono={monoLabels} aria-live="polite">
    {locationSummary}
  </p>
{/snippet}

<div class="flow">
  {#if otherWindow}
    <!-- The form is open in another tab (reliability.md §1.3): "Go to it"
         asks that tab to come forward (App's draft-ping, as History's gate
         does); Close goes home. The footer's pair: the primary at the right,
         under the thumb, Close where Back is -->
    <main class="other-window">
      <p role="status">{t("checkin.otherWindow")}</p>
    </main>
    <footer class="foot">
      <div class="foot-row">
        <button type="button" class="go btn-primary" onclick={() => broadcast({ type: "draft-ping" })}>
          {t("checkin.otherWindow.focus")}
        </button>
        <button type="button" class="leave btn-secondary" onclick={onexit}>{t("common.close")}</button>
      </div>
    </footer>
  {:else if savedEntryId}
    <SavedScreen onundo={undo} ondone={() => onsaved(savedEntryId!, hiddenSinceSave ? null : savedTime)} />
  {:else if draft && step}
    <header class="head" class:mono={monoLabels} bind:this={headEl}>
      {#if v.progress === "counter"}
        <p class="counter-label" aria-hidden="true">
          {t("checkin.progress.counter", {
            nn: String(draft.step + 1).padStart(2, "0"),
            label: t(`checkin.eyebrow.${draft.step + 1}` as MessageKey),
          })}
        </p>
        <div class="rule" aria-hidden="true">
          <div class="rule-fill" style:--p={progress}></div>
        </div>
      {:else if v.progress === "bar"}
        <div class="bar" aria-hidden="true">
          <div class="bar-fill" style:--p={progress}></div>
        </div>
      {:else if v.progress === "dots"}
        <div class="dots" aria-hidden="true">
          {#each m.STEPS as id, i (id)}
            <span class:done={i < draft.step} class:current={i === draft.step}></span>
          {/each}
        </div>
      {:else}
        <div class="segments" aria-hidden="true">
          {#each m.STEPS as id, i (id)}
            <span class:done={i <= draft.step}></span>
          {/each}
        </div>
      {/if}
      <!-- Where it is, only: Close and Stop here are in the footer, under
           the thumb (ui.md §6.2, owner decision 2026-10-10).
           The step is always announced; shown when the theme has a label -->
      <p class="head-row">
        <span class="counter" class:sr-only={!v.stepLabel}>{t("checkin.stepLabel", { n: draft.step + 1 })}</span>
        {#if draft.trigger === "after_event"}
          <span class="badge">{t("checkin.afterEvent.badge")}</span>
        {/if}
      </p>
    </header>

    <p class="undone" class:shown={undoneNotice} role="status">
      {#if undoneNotice}<span class="undone-text" use:reveal>{t("checkin.saved.undone")}</span>{/if}
    </p>

    <main class="body" bind:this={scrollEl}>
      <!-- The reach room (lib/reach.ts): on a phone, room above the step to
           pull its top down into the bottom third; out of view at rest -->
      <div class="room" aria-hidden="true" bind:this={roomEl}></div>
      <div class="page" class:low={lowStep} bind:this={bodyEl}>
      {#if carry}<p class="carry" id="step-carry">{carry}</p>{/if}
      {#if v.heading === "eyebrow"}
        <p class="eyebrow" aria-hidden="true">{t(`checkin.eyebrow.${draft.step + 1}` as MessageKey)}</p>
      {/if}
      <h1
        class="title"
        class:editorial={v.heading === "editorial"}
        tabindex="-1"
        aria-describedby={carry ? "step-carry" : undefined}
        bind:this={heading}
      >
        {#if v.heading === "editorial"}{t(`${STEP_COPY[step].title}.editorial.pre` as MessageKey)}<em
            >{t(`${STEP_COPY[step].title}.editorial.em` as MessageKey)}</em
          >{t(`${STEP_COPY[step].title}.editorial.post` as MessageKey)}{:else}{t(STEP_COPY[step].title)}{/if}
      </h1>
      {#if step === "locations" && firstCheckIn}
        <p class="hint" class:mono={monoLabels}>{t("checkin.step.1.hint.first")}</p>
      {:else if nothingToRate}
        <p class="hint" class:mono={monoLabels}>{t("checkin.step.3.hint.null")}{@render helpLink(true)}</p>
      {:else if STEP_COPY[step].hint}<p class="hint" class:mono={monoLabels}>
          {t(STEP_COPY[step].hint!)}{@render helpLink(true)}
        </p>
      {:else if HELP_OF[step]}<p class="hint" class:mono={monoLabels}>{@render helpLink(false)}</p>{/if}

      {#if step === "locations"}
        <BodyMap
          side={wide ? summarySide : undefined}
          tabs={v.tabs}
          {locations}
          labelOf={(k) => zones.find((z) => z.key === k)?.label[locale] ?? k}
          ontoggle={toggleLocation}
          controls={wide ? locationNulls : undefined}
        />
      {:else if step === "qualities"}
        <!-- The sensation words; "nothing" / "can't tell" are pinned above
             the footer (ui.md §6.8) -->
        <OptionGrid
          ariaLabel={t("checkin.step.2.title")}
          options={sensations.map((q) => ({ key: q.key, label: q.label[locale] }))}
          selected={(k) => draft!.answers.qualities.includes(k)}
          ontoggle={(k) => update((d, now) => m.toggleQuality(d, k, now))}
          oninspect={() => openHelp()}
        />
      {:else if step === "intensity"}
        <div class="slider-zone">
          <Slider
            min={0}
            max={10}
            value={draft.answers.intensity}
            touched={draft.touched.includes("intensity")}
            ariaLabel={t("checkin.step.3.title")}
            poleLow={t("checkin.step.3.pole.low")}
            poleHigh={t("checkin.step.3.pole.high")}
            oninput={(v) => update((d, now) => m.setSlider(d, "intensity", v, now))}
          />
        </div>
      {:else if step === "valence"}
        <div class="slider-zone">
          <Slider
            min={-3}
            max={3}
            value={draft.answers.valence}
            touched={draft.touched.includes("valence")}
            ariaLabel={t("checkin.step.4.title")}
            poleLow={t("checkin.step.4.pole.low")}
            poleCenter={t("checkin.step.4.pole.center")}
            poleHigh={t("checkin.step.4.pole.high")}
            oninput={(v) => update((d, now) => m.setSlider(d, "valence", v, now))}
          />
        </div>
      {:else if step === "arousal"}
        <div class="slider-zone">
          <Slider
            min={0}
            max={10}
            value={draft.answers.arousal}
            touched={draft.touched.includes("arousal")}
            ariaLabel={t("checkin.step.5.title")}
            poleLow={t("checkin.step.5.pole.low")}
            poleHigh={t("checkin.step.5.pole.high")}
            oninput={(v) => update((d, now) => m.setSlider(d, "arousal", v, now))}
          />
        </div>
      {:else if step === "word"}
        <StepWord
          word={draft.answers.word}
          confidence={draft.answers.word_confidence}
          asked={certaintyAsked}
          onl1={(k) => update((d, now) => m.chooseWordL1(d, k, now))}
          onl2={(k) => update((d, now) => m.chooseWordL2(d, k, now))}
          onconfidence={(c) => update((d, now) => m.setConfidence(d, c, now))}
        />
      {:else if step === "urge"}
        <OptionGrid
          ariaLabel={t("checkin.step.7.title")}
          options={forInput(URGES).map((u) => ({ key: u.key, label: u.label[locale] }))}
          selected={(k) => draft!.answers.urge === k}
          ontoggle={(k) => update((d, now) => m.toggleUrge(d, k, now))}
          oninspect={() => openHelp()}
        />
      {:else if step === "head_mode"}
        <div class="slider-zone">
          <Slider
            min={0}
            max={10}
            value={draft.answers.head_mode}
            touched={draft.touched.includes("head_mode")}
            ariaLabel={t("checkin.step.8.title")}
            poleLow={t("checkin.step.8.pole.low")}
            poleHigh={t("checkin.step.8.pole.high")}
            oninput={(v) => update((d, now) => m.setSlider(d, "head_mode", v, now))}
          />
        </div>
      {:else if step === "context"}
        <StepContext
          tag={draft.answers.context_tag}
          other={draft.answers.context_other}
          ontag={(k) => update((d, now) => m.toggleContext(d, k, now))}
          onother={(v) => update((d, now) => m.setContextOther(d, v, now))}
        />
        <!-- The optional note under the situation, one screen (ui.md §6.12);
             never focused by itself -->
        <StepNote
          note={draft.answers.note}
          onnote={(v) => update((d, now) => m.setNote(d, v, now))}
          onsavewithout={saveWithoutNote}
        />
      {/if}
      </div>
    </main>

    <footer class="foot">
      <!-- The step's own footer pieces move with its answers when a step
           arrives (ui.md §5.1), so the pinned null pair never stands still while
           the other answers move (principle 4) -->
      {#if (step === "locations" && !wide) || step === "qualities"}
        <div class="foot-step" bind:this={footStepEl}>
          {#if step === "locations"}
            <!-- In the footer, as on step 2: Whole body / Nowhere under the
                 thumb, the figure keeps the height (ui.md §7.1);
                 on desktop beside the figure (ui.md §9) -->
            {@render locationNulls()}
          {:else}
            <NullPair
              ariaLabel={t("checkin.step.2.title")}
              options={nullQualities.map((q) => ({ key: q.key, label: q.label[locale] }))}
              selected={(k) => draft!.answers.qualities.includes(k)}
              ontoggle={(k) => update((d, now) => m.toggleQuality(d, k, now))}
            />
          {/if}
        </div>
      {/if}
      <!-- Next comes first in the DOM, so Tab out of an answer lands on it;
           CSS keeps Back on the left (owner decision 2026-10-08) -->
      <div class="foot-row">
        <button
          type="button"
          class="next btn-primary"
          class:busy={busy && valid}
          disabled={(!valid && !needsCertainty) || busy}
          aria-disabled={needsCertainty ? "true" : undefined}
          aria-busy={slowSave ? "true" : undefined}
          onclick={goNext}
        >
          <span>{nextLabel}</span>
        </button>
        <button
          type="button"
          class="back btn-secondary"
          aria-label={t("common.back")}
          disabled={draft.step === 0 || busy}
          onclick={() => update(m.back)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
      </div>
      <!-- Save or Stop here failed: one line above the ways out and Back /
           Next, which stay where they are (the footer grows upward) -->
      {#if saveFailed}<p class="failed" role="alert" use:reveal>{t("checkin.save.failed")}</p>{/if}
      <!-- ui.md §6.2: the ways out, over the right end of Next,
           where the thumb is (owner decision 2026-10-10; they were at the
           top); after the buttons in the DOM, so Tab out of an answer still
           lands on Next. Never two look-alike links side by side: "Skip
           check-in" on step 1, "Stop here" from step 2 on, then × (Close,
           keeps the draft) in the corner. Steps 1–2 start the row with the
           summary of the answer, under the null pair: a phone shows it
           without scrolling (ui.md §6.8, §7.1) -->
      <div class="exits" class:mono={monoLabels}>
        {#if (step === "locations" && !wide) || step === "qualities"}
          <p class="summary" class:dot={v.summary === "dot"} class:mono={monoLabels} aria-live="polite">
            {step === "locations" ? locationSummary : qualitySummary}
          </p>
        {/if}
        <button
          type="button"
          class="link text-action"
          class:plain={v.progress === "bar"}
          onclick={() => finish("skip")}
          disabled={busy}
        >
          {draft.step > 0
            ? t("checkin.stopHere")
            : v.progress === "bar"
            ? t("common.skip")
            : t("common.skipCheckin")}
        </button>
        <button type="button" class="close" aria-label={t("checkin.close.aria")} onclick={close} disabled={busy}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <p class="legend" aria-hidden="true">
        {t(apple ? "a11y.keyboardLegend.mac" : "a11y.keyboardLegend")}
      </p>
    </footer>

    <!-- Fixed, so outside any stacking context; the plain title in every
         theme, Close only (ui.md §6.5) -->
    {#if helpOpen && help}
      <ConfirmSheet title={t(STEP_COPY[step].title)} oncancel={closeHelp}>
        {#if help.kind === "scale"}
          {#if help.text}<p class="help-text">{help.text}</p>{/if}
        {:else}
          {#each help.groups as group, i (i)}
            {#if group.heading}<h3 class="help-sub">{group.heading}</h3>{/if}
            <TermList terms={group.terms} />
          {/each}
        {/if}
      </ConfirmSheet>
    {/if}
    {#if shielded}<div class="tap-shield" aria-hidden="true"></div>{/if}
  {/if}
</div>

<style>
  .other-window {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 0 1.5rem;
    text-align: center;
  }

  /* Go to it / Close: the check-in footer's row (Next, Back) */
  .go {
    flex: 1;
    min-width: 0;
    height: 56px;
    font: inherit;
    font-size: 1.0625rem;
    font-weight: 600;
  }

  .leave {
    order: -1;
    flex: none;
    height: 56px;
    padding: 0 1.5rem;
    font: inherit;
  }

  /* ui.md §4: header · main (scrolls inside) · footer, one
     screen high, so the footer and the pinned null answers never move. The
     bottom inset is the footer's (.foot, Saved's .actions): counted once */
  .flow {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
    padding: 0 16px 1rem;
    box-sizing: border-box;
    background: var(--c-ground, #e4edf1);
    color: var(--c-ink, #1e2a26);
  }

  /* "Going in" quiets the page: while the form is open the whole viewport
     is the plain ground, the gradient and the moving light set aside (on a
     desktop the column no longer stands as a strip; ui.md §5.1, §9) */
  .flow::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    background: var(--c-ground, #e4edf1);
    pointer-events: none;
    animation: fx-fade-in var(--dur-4) var(--ease-out);
  }

  .head {
    flex: none;
    padding-top: calc(0.75rem + var(--safe-top, 0px));
    background: var(--c-ground, #e4edf1);
  }

  /* Progress variants (ui.md §14.4) */
  .segments {
    display: flex;
    gap: 4px;
  }

  /* Progress is information, not a reward: matte in every theme, nothing
     at 9/9. Fills are scales on the compositor (ui.md §5.1) */
  .segments span {
    position: relative;
    flex: 1;
    height: 4px;
    border-radius: 2px;
    overflow: hidden;
    background: var(--c-track, #d3e0e6);
  }

  .segments span::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--c-accent, #4f46e5);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 160ms var(--ease-in);
  }

  .segments span.done::after {
    transform: scaleX(1);
    transition: transform 240ms var(--ease-out);
  }

  .dots span.done,
  .dots span.current {
    background: var(--c-accent, #4f46e5);
  }

  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--c-track, #d3e0e6);
    overflow: hidden;
  }

  .bar-fill {
    width: 100%;
    height: 100%;
    background: var(--c-accent, #4f46e5);
    transform: scaleX(var(--p, 0));
    transform-origin: left;
    transition: transform 280ms var(--ease-out);
  }

  /* The current dot is a pill: its width springs (nine 6 px items) */
  .dots {
    display: flex;
    gap: 6px;
    contain: layout;
  }

  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: var(--c-line, #b3bdb7);
    transition:
      width var(--dur-4) var(--ease-spring-soft),
      background-color var(--dur-2) var(--ease-standard);
  }

  .dots span.current {
    width: 18px;
  }

  .counter-label {
    margin: 0 0 6px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--c-ink, #1e2a26);
  }

  .rule {
    height: 2px;
    background: var(--c-line, #b3bdb7);
  }

  .rule-fill {
    width: 100%;
    height: 100%;
    background: var(--c-ink, #1e2a26);
    transform: scaleX(var(--p, 0));
    transform-origin: left;
    transition: transform 280ms var(--ease-out);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .head.mono .counter,
  .exits.mono .link {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .link.plain {
    text-decoration: none;
  }

  /* The "where" carried into steps 2–3: muted, above the title */
  .carry {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--c-muted, #5c6670);
  }

  .eyebrow {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--c-muted, #4e5853);
  }

  .title.editorial {
    font-size: 2.5rem;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }

  .title.editorial em {
    font-style: italic;
    color: var(--c-accent-text, #4f46e5);
  }

  .hint.mono {
    padding-bottom: 12px;
    border-bottom: 1px solid var(--c-ink, #1e2a26);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .summary.dot::before {
    content: "";
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 8px;
    border-radius: 50%;
    vertical-align: middle;
    background: var(--c-figure-sel, #4f46e5);
  }

  .summary.mono {
    text-align: left;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* The step label (themes that show one) and the "after an event" badge */
  .head-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 0.375rem 0 0;
  }

  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-right: -10px;
    padding: 0;
    border: none;
    border-radius: 22px;
    background: none;
    color: var(--c-ink, #1e2a26);
    cursor: pointer;
    transition: scale var(--dur-spring) var(--ease-spring);
  }

  .close:not(:disabled):active {
    scale: 0.94;
    transition-duration: var(--dur-1);
    transition-timing-function: var(--ease-out);
  }

  .close svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .counter,
  .badge {
    font-size: 0.8125rem;
    color: var(--c-muted, #5c6670);
  }

  .link {
    min-height: 44px;
    padding: 0 0.5rem;
    border: none;
    background: none;
    color: var(--c-muted, #5c6670);
    font: inherit;
    font-size: 0.9375rem;
    text-decoration-line: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  /* The side padding lives inside the scroll box, so focus rings at the
     edges are not clipped */
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    margin: 0 -16px;
    padding: 1rem 16px 1.5rem;
  }

  /* Its height lands at once (lib/reach.ts) */
  .room {
    transition-property: none;
  }

  /* At least the scroller's height, so the step lays out as without the
     room and the room is always there to pull */
  .page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 100%;
  }

  /* A slider or the urges and their question are one group at the bottom,
     just above the footer, where the thumb rests: the space left is above
     them (owner decision 2026-10-10; UX-07 had the slider in the middle, the
     question at the top). An auto margin, not flex-end, so a long question
     on a short screen still scrolls from its top */
  .page.low > :first-child {
    margin-top: auto;
  }

  .slider-zone {
    padding-top: 1rem;
  }

  .title {
    margin: 0;
    font-family: var(--font-display, inherit);
    font-weight: var(--display-weight, 600);
    font-size: 1.75rem;
    line-height: 1.2;
    outline: none;
  }

  .hint,
  .summary {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--c-muted, #5c6670);
  }

  .summary {
    text-align: center;
    color: var(--c-ink, #1e2a26);
  }

  /* Takes no room until it has something to say */
  .undone {
    margin: 0;
    font-size: 0.875rem;
    color: var(--c-muted, #5c6670);
  }

  .undone.shown {
    margin-top: 0.25rem;
  }

  /* Rises into place (a transform needs a box) */
  .undone-text {
    display: inline-block;
  }

  /* Plain words, no alarm colour: above the ways out (they are order 1,
     later in the DOM) */
  .failed {
    order: 1;
    margin: 0;
    font-size: 0.9375rem;
    color: var(--c-ink, #1e2a26);
  }

  .foot {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 0 calc(0.5rem + var(--safe-bottom, 0px));
    background: var(--c-ground, #e4edf1);
  }

  .foot-step {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* On screen: the step's pieces, the ways out, then Back / Next */
  .foot-row {
    order: 2;
    display: flex;
    gap: 0.75rem;
  }

  :global(html[data-handed="left"]) .foot-row {
    flex-direction: row-reverse;
  }

  /* Quiet, at the right edge over Next; the 44 px targets touch the row
     above Next, never Next itself */
  .exits {
    order: 1;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.25rem;
    margin: -0.25rem 0;
  }

  :global(html[data-handed="left"]) .exits {
    justify-content: flex-start;
  }

  /* The summary: the rest of the row, from the left edge */
  .exits .summary {
    flex: 1;
    min-width: 0;
    margin-right: auto;
    text-align: left;
  }

  /* Look, light and press: `.btn-secondary` (fx.css); a square icon
     button presses deeper */
  .back {
    --press: 0.94;
    order: -1;
    flex: 0 0 56px;
    height: 56px;
  }

  .back:disabled {
    opacity: 0.35;
  }

  .back svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Look, light, press and the not-yet-lit disabled state: `.btn-primary`
     (fx.css). No sweep and no pulse when it lights up: answering is not
     rewarded over a null answer (principle 4) */
  .next {
    flex: 1;
    min-width: 0;
    height: 56px;
    font: inherit;
    font-size: 1.0625rem;
    font-weight: 600;
  }

  .next span {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    padding: 0 1rem;
  }

  /* ui.md §9: the keyboard legend, on desktop only */
  .legend {
    order: 3;
    display: none;
    margin: 0;
    font-size: 0.8125rem;
    color: var(--c-muted, #5c6670);
    text-align: center;
  }

  @media (hover: hover) and (pointer: fine) and (min-width: 900px) {
    .legend {
      display: block;
    }
  }

  /* The help link: the hint's own size, colour and case, never the accent;
     44 px high through padding and an equal negative margin, so the hint's
     line does not grow (ui.md §6.5) */
  .help-link {
    display: inline-block;
    min-height: 44px;
    margin: -12px 0;
    padding: 12px 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration-line: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .help-link:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  /* A phone: the help link at the right edge, on the hint's line when it
     fits, else under it; no separator (ui.md §6.5) */
  @media (max-width: 899px) {
    .hint {
      display: flex;
      flex-wrap: wrap;
      column-gap: 0.75rem;
    }

    .hint .help-link {
      margin-left: auto;
    }

    .hint .sep {
      display: none;
    }
  }

  .help-text {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--c-ink, #1e2a26);
  }

  /* Step 6's second and third lists: certainty, then the finer words */
  .help-sub {
    margin: 1.25rem 0 0.625rem;
    padding-top: 1rem;
    border-top: 1px solid var(--c-line, #d5dbe0);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--c-muted, #5c6670);
  }

  /* Takes the taps of a double tap on Close for 350 ms; transparent */
  .tap-shield {
    position: fixed;
    inset: 0;
    z-index: 45;
  }

  .link:focus-visible,
  .close:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }
</style>
