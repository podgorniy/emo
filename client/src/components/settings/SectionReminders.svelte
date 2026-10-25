<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Reminders: the awake window, reminders per day (a 1–6 stepper), this
   * device's notification switch and a pause (1 day, 3 days, 1 week; while it
   * runs, "Paused until …" and Resume). Changes are saved as they are made and
   * apply from tomorrow; a window too short for the count is explained under
   * the card, with one-tap fixes, instead of being sent. Before this device
   * has a copy of the settings, the controls wait and say why.
   * Specification: ui.md §11.3, reliability.md §2.4,
   * architecture.md §9.1, §9.4; api.md §2.5.
   */
  import "./settings.css";
  import { onDestroy, onMount } from "svelte";
  import type { SettingsGetRes } from "../../../../shared/protocol.ts";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { apiGetSettings, apiPutSettings } from "../../lib/api.ts";
  import { getMeta } from "../../lib/db.ts";
  import { onOfflineChange } from "../../lib/network.ts";
  import { rememberSettings } from "../../lib/sync.ts";
  import { userError } from "../../lib/errors.ts";
  import {
    disablePush,
    enablePush,
    type PushState,
    pushState,
    recordPushChoice,
  } from "../../lib/push.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import { activePause, pauseLabel, pauseReminders, resumeReminders } from "../../lib/pause.ts";
  import ConfirmSheet from "../common/ConfirmSheet.svelte";
  import Switch from "../common/Switch.svelte";

  const MIN_PER_DAY = 1;
  const MAX_PER_DAY = 6;
  /** The server's rule: (end − start) ≥ (n − 1) × min_gap + 60 min. */
  const minWindowMin = (n: number, gap: number) => (n - 1) * gap + 60;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  let settings = $state<SettingsGetRes | null>(null);
  let wakeStart = $state("09:00");
  let wakeEnd = $state("22:00");
  let perDay = $state(3);
  let saved = $state(false);
  let errorKey = $state<MessageKey | null>(null);
  let push = $state<PushState>("off");
  let pushBusy = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The first copy of the settings: the cache is read first, then the server
   * is asked. With none cached and the server not reached, the window, the
   * stepper and the pause wait instead of taking edits that could never be
   * sent, and the note says why (SET-20); a device with a copy never sees
   * them wait.
   */
  let load = $state<"cache" | "server" | "unreachable">("cache");
  const waiting = $derived(settings === null && load !== "cache");
  const unreachable = $derived(settings === null && load === "unreachable");

  const gap = $derived(settings?.min_gap_min ?? 120);
  const tooShort = $derived(toMin(wakeEnd) - toMin(wakeStart) < minWindowMin(perDay, gap));

  function show(s: SettingsGetRes) {
    settings = s;
    wakeStart = s.wake_start;
    wakeEnd = s.wake_end;
    perDay = s.reminders_per_day;
  }

  /**
   * The window or the count was changed here: the server's first answer,
   * still on its way with a cached copy on screen, no longer puts the old
   * values back over the edit (its save is pending, and wins)
   */
  let edited = false;
  /**
   * Writes from here (a save, a pause, a resume), counted as each starts and
   * as it ends: a GET asked before one of them answers with what the server
   * had before it, so that answer is dropped, from the cache too
   */
  let writes = 0;

  async function fetchSettings() {
    const asked = writes;
    try {
      const fresh = await apiGetSettings();
      if (writes !== asked) return;
      await rememberSettings(fresh);
      if (writes !== asked) return;
      if (edited) settings = fresh;
      else show(fresh);
    } catch {
      // Offline: the cached copy stays
      load = "unreachable";
    }
  }

  onMount(async () => {
    const cached = await getMeta<SettingsGetRes>("settings");
    if (cached) show(cached);
    load = "server";
    await fetchSettings();
    push = await pushState().catch(() => "unsupported" as PushState);
  });

  // Emo in reach again (network.ts hears `online` and a server back up) with
  // no copy yet: ask once more
  onDestroy(
    onOfflineChange((offline) => {
      if (offline || !unreachable) return;
      load = "server";
      void fetchSettings();
    }),
  );

  // Leaving Settings by any route within the debounce still saves a valid
  // window, once (ui.md §11.3); an invalid one is never sent
  onDestroy(() => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    if (!tooShort && settings) void save();
  });

  /** Saves a moment after the last change, unless the window cannot hold it. */
  function changed() {
    edited = true;
    saved = false;
    errorKey = null;
    if (timer) clearTimeout(timer);
    timer = null;
    if (tooShort || !settings) return;
    // `timer` is set only while a save is pending
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, 600);
  }

  async function save() {
    if (!settings) return;
    writes++;
    try {
      const res = await apiPutSettings({
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || settings.tz,
        locale: getLocale(),
        wake_start: wakeStart,
        wake_end: wakeEnd,
        reminders_per_day: perDay,
        min_gap_min: gap,
      });
      await rememberSettings(res);
      settings = res;
      saved = true;
    } catch (err) {
      errorKey = userError(err).key;
    } finally {
      writes++;
    }
  }

  // The window too short for the count (ui.md §11.3): one tap fixes it,
  // either by a longer window from the same start (or to the same end) or
  // by fewer reminders a day
  const fmt = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const windowFix = $derived.by(() => {
    const need = minWindowMin(perDay, gap);
    const start = toMin(wakeStart);
    const end = toMin(wakeEnd);
    if (start + need <= 23 * 60 + 59) return { from: wakeStart, to: fmt(start + need) };
    if (end - need >= 0) return { from: fmt(end - need), to: wakeEnd };
    return null;
  });
  const perDayFix = $derived.by(() => {
    const span = toMin(wakeEnd) - toMin(wakeStart);
    const n = Math.floor((span - 60) / gap) + 1;
    return n >= MIN_PER_DAY && n < perDay ? n : null;
  });
  function useWindow() {
    if (!windowFix) return;
    wakeStart = windowFix.from;
    wakeEnd = windowFix.to;
    changed();
  }
  function usePerDay() {
    if (perDayFix === null) return;
    perDay = perDayFix;
    changed();
  }

  // "How to allow": this browser's steps first, the others under them
  let helpOpen = $state(false);
  type HelpKey =
    | "settings.reminders.help.chrome"
    | "settings.reminders.help.android"
    | "settings.reminders.help.safari"
    | "settings.reminders.help.ios"
    | "settings.reminders.help.firefox";
  const HELP: HelpKey[] = [
    "settings.reminders.help.chrome",
    "settings.reminders.help.android",
    "settings.reminders.help.safari",
    "settings.reminders.help.ios",
    "settings.reminders.help.firefox",
  ];
  const thisBrowser = $derived.by((): HelpKey => {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (/iPad|iPhone|iPod/.test(ua)) return "settings.reminders.help.ios";
    if (/Firefox\//.test(ua)) return "settings.reminders.help.firefox";
    if (/Android/.test(ua)) return "settings.reminders.help.android";
    if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) {
      return "settings.reminders.help.safari";
    }
    return "settings.reminders.help.chrome";
  });

  function step(delta: number) {
    perDay = Math.min(MAX_PER_DAY, Math.max(MIN_PER_DAY, perDay + delta));
    changed();
  }

  async function togglePush() {
    pushBusy = true;
    try {
      const turningOff = push === "on";
      push = turningOff ? await disablePush() : await enablePush();
      // Off by the switch is a choice; on clears it (ui.md §3)
      if (turningOff) await recordPushChoice(true);
      else if (push === "on") await recordPushChoice(false);
    } catch {
      push = await pushState().catch(() => "unsupported" as PushState);
    } finally {
      pushBusy = false;
    }
  }

  // A pause (architecture.md §9.1): the server sends nothing until then
  const paused = $derived(activePause(settings));
  let pauseBusy = $state(false);
  async function setPause(days: 1 | 3 | 7 | null) {
    pauseBusy = true;
    errorKey = null;
    writes++;
    try {
      settings = days === null ? await resumeReminders() : await pauseReminders(days);
    } catch (err) {
      errorKey = userError(err).key;
    } finally {
      writes++;
      pauseBusy = false;
    }
  }

  const switchDisabled = $derived(
    pushBusy || push === "denied" || push === "needs_install" || push === "unsupported",
  );
  const pushLine = $derived(
    push === "needs_install"
      ? t("settings.reminders.needsInstall")
      : push === "default"
      ? t("settings.reminders.permissionDefault")
      : null,
  );
</script>

<section class="settings-section" id="reminders">
  <h2 class="section-header">{t("settings.reminders.header")}</h2>
  <div class="settings-card">
    {#if push === "denied"}
      <!-- First, in ink: why nothing arrives, and the way out (ui.md §11.3) -->
      <div class="settings-row stacked blocked">
        <span>{t("settings.reminders.blocked")}</span>
        <button type="button" class="settings-link text-action" onclick={() => (helpOpen = true)}>
          {t("settings.reminders.howToAllow")}
        </button>
      </div>
    {/if}
    <div class="settings-row">
      <span class="window-row">
        <span id="window-label">{t("settings.reminders.window")}</span>
        <span class="window" role="group" aria-labelledby="window-label">
          <input
            type="time"
            class="fx-field"
            aria-label={t("settings.reminders.window.from")}
            aria-invalid={tooShort}
            aria-describedby={tooShort ? "reminders-note" : undefined}
            disabled={waiting}
            bind:value={wakeStart}
            onchange={changed}
          />
          <span aria-hidden="true">–</span>
          <input
            type="time"
            class="fx-field"
            aria-label={t("settings.reminders.window.to")}
            aria-invalid={tooShort}
            aria-describedby={tooShort ? "reminders-note" : undefined}
            disabled={waiting}
            bind:value={wakeEnd}
            onchange={changed}
          />
        </span>
      </span>
    </div>

    <div class="settings-row">
      <span id="perday-label">{t("settings.reminders.perDay")}</span>
      <span class="stepper" role="group" aria-labelledby="perday-label">
        <button
          type="button"
          aria-label={t("settings.reminders.perDay.decrease")}
          disabled={waiting || perDay <= MIN_PER_DAY}
          onclick={() => step(-1)}
        >−</button>
        <output aria-live="polite">{perDay}</output>
        <button
          type="button"
          aria-label={t("settings.reminders.perDay.increase")}
          disabled={waiting || perDay >= MAX_PER_DAY}
          onclick={() => step(1)}
        >+</button>
      </span>
    </div>

    <div class="settings-row">
      <span id="push-label">{t("settings.reminders.thisDevice")}</span>
      <Switch
        checked={push === "on"}
        labelledby="push-label"
        disabled={switchDisabled}
        onclick={togglePush}
      />
    </div>

    <div class="settings-row pause-row">
      {#if paused}
        <span>{t("settings.reminders.pausedUntil", { date: pauseLabel(paused, getLocale()) })}</span>
        <button type="button" class="pause-btn" disabled={pauseBusy} onclick={() => setPause(null)}>
          {t("settings.reminders.resume")}
        </button>
      {:else}
        <span id="pause-label">{t("settings.reminders.pause")}</span>
        <span class="pause-choices" role="group" aria-labelledby="pause-label">
          <button
            type="button"
            class="pause-btn"
            disabled={waiting || pauseBusy}
            onclick={() => setPause(1)}
          >
            {t("settings.reminders.pause.day")}
          </button>
          <button
            type="button"
            class="pause-btn"
            disabled={waiting || pauseBusy}
            onclick={() => setPause(3)}
          >
            {t("settings.reminders.pause.days")}
          </button>
          <button
            type="button"
            class="pause-btn"
            disabled={waiting || pauseBusy}
            onclick={() => setPause(7)}
          >
            {t("settings.reminders.pause.week")}
          </button>
        </span>
      {/if}
    </div>
  </div>

  <!-- Under the card, so a reveal never moves what was just tapped (ui.md §4.5): a
       "+" that makes the window too short leaves the stepper where it was.
       The reason nothing is sent takes the note's place, in ink -->
  <p
    class="settings-note"
    class:saved
    class:problem={unreachable || tooShort}
    id="reminders-note"
    role="status"
  >
    {#if unreachable}
      {t("settings.reminders.offline")}
    {:else if tooShort}
      {t("settings.reminders.windowTooShort", {
        h: Math.ceil(minWindowMin(perDay, gap) / 60),
        n: perDay,
      })}
    {:else if errorKey}
      {t(errorKey, errorKey === "settings.reminders.windowTooShort"
        ? { h: Math.ceil(minWindowMin(perDay, gap) / 60), n: perDay }
        : undefined)}
    {:else if saved}
      {t("settings.reminders.appliesTomorrow")}
    {:else}
      {t("settings.reminders.note")}
    {/if}
  </p>
  {#if tooShort && (windowFix || perDayFix !== null)}
    <div class="fixes">
      {#if windowFix}
        <button type="button" class="fix" onclick={useWindow}>
          {t("settings.reminders.useWindow", { from: windowFix.from, to: windowFix.to })}
        </button>
      {/if}
      {#if perDayFix !== null}
        <button type="button" class="fix" onclick={usePerDay}>
          {t("settings.reminders.usePerDay", { n: perDayFix })}
        </button>
      {/if}
    </div>
  {/if}
  {#if pushLine}<p class="settings-note">{pushLine}</p>{/if}
  {#if settings && !settings.receiving_reminders && push !== "on"}
    <p class="settings-note">{t("settings.reminders.noDevice")}</p>
  {/if}
</section>

{#if helpOpen}
  <ConfirmSheet title={t("settings.reminders.help.title")} oncancel={() => (helpOpen = false)}>
    <p>{t(thisBrowser)}</p>
    <ul class="help-other">
      {#each HELP.filter((k) => k !== thisBrowser) as key (key)}
        <li>{t(key)}</li>
      {/each}
    </ul>
  </ConfirmSheet>
{/if}

<style>
  .window-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
  }

  /* The offending field: 2 px ink (`.fx-field[aria-invalid]`), never a colour;
     the message in ink under the card, in the note's place */

  .settings-note.problem {
    font-weight: 500;
    color: var(--c-ink, #1c1c1a);
  }

  .fixes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0 0.25rem;
  }

  .fix {
    min-height: 44px;
    padding: 0 0.875rem;
    border: 1px solid var(--c-line, #e2e8f0);
    border-radius: 12px;
    background: var(--c-ground, #f7f6f2);
    color: var(--c-ink, #1c1c1a);
    font: inherit;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .fix:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  .blocked {
    color: var(--c-ink, #1c1c1a);
    font-weight: 500;
  }

  .settings-note.saved {
    color: var(--c-ink, #1c1c1a);
  }

  .help-other {
    margin: 0.75rem 0 0;
    padding-left: 1.1rem;
    color: var(--c-muted, #5c6670);
    font-size: 0.875rem;
  }

  .window {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  /* With `.fx-field` (fx.css): recessed into the card */
  input[type="time"] {
    min-height: 44px;
    padding: 0 0.5rem;
    font: inherit;
  }

  .pause-row {
    flex-wrap: wrap;
  }

  .pause-choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  /* A phone: the one-tap fixes and the pause choices end at the right edge,
     on their row or on a line of their own (ui.md §4.5) */
  @media (max-width: 899px) {
    .fixes {
      align-self: flex-end;
      justify-content: flex-end;
    }

    .pause-choices {
      margin-left: auto;
      justify-content: flex-end;
    }
  }

  .pause-btn {
    min-height: 44px;
    padding: 0 0.75rem;
    border: 1px solid var(--c-line, #e2e8f0);
    border-radius: 12px;
    background: var(--c-ground, #f7f6f2);
    color: var(--c-ink, #1c1c1a);
    font: inherit;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .pause-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .pause-btn:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .stepper button {
    width: 44px;
    height: 44px;
    border: 1px solid var(--c-line, #e2e8f0);
    border-radius: 12px;
    background: var(--c-ground, #f7f6f2);
    color: var(--c-ink, #1c1c1a);
    font-size: 1.25rem;
    cursor: pointer;
  }

  .stepper button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .stepper output {
    min-width: 1.5rem;
    text-align: center;
    font-weight: 600;
  }

</style>
