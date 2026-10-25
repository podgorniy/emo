<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Step 3 of 3 — install and reminders. iPhone Safari outside the Home
   * Screen gets the install steps first (push needs the installed app). Then
   * notifications, asked for only from an explicit tap, and the awake window.
   * Specification: ui.md §12.8, architecture.md §4.1,
   * §7.2, §9.4; reliability.md §2.4, §5.1.
   */
  import "./auth.css";
  import { onDestroy, onMount } from "svelte";
  import { install, onInstallOffer } from "../../lib/install.ts";
  import type { SettingsGetRes } from "../../../../shared/protocol.ts";
  import { apiGetSettings, apiPutSettings } from "../../lib/api.ts";
  import { enablePush, type PushState, pushState, recordPushChoice } from "../../lib/push.ts";
  import { rememberSettings } from "../../lib/sync.ts";
  import { requestPersistence } from "../../lib/storage.ts";
  import { getLocale, t, tn } from "../../lib/i18n.svelte.ts";
  import Button from "../common/Button.svelte";

  interface Props {
    onDone: () => void;
  }

  let { onDone }: Props = $props();

  let push = $state<PushState>("off");
  /** "Not now": no request; Settings → Reminders can turn them on later */
  let skipped = $state(false);
  let settings = $state<SettingsGetRes | null>(null);
  let wakeStart = $state("09:00");
  let wakeEnd = $state("22:00");
  let busy = $state(false);
  /** The browser offers installing (Chrome, Edge, Android): "Install Emo" */
  let canInstall = $state(false);
  onDestroy(onInstallOffer((available) => (canInstall = available)));

  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const perDay = $derived(settings?.reminders_per_day ?? 3);
  const gap = $derived(settings?.min_gap_min ?? 120);
  const minWindow = $derived((perDay - 1) * gap + 60);
  const tooShort = $derived(toMin(wakeEnd) - toMin(wakeStart) < minWindow);

  onMount(async () => {
    push = await pushState().catch(() => "unsupported" as PushState);
    try {
      settings = await apiGetSettings();
      wakeStart = settings.wake_start;
      wakeEnd = settings.wake_end;
    } catch {
      // Offline: the defaults stand; Settings can change them later
    }
  });

  async function allow() {
    push = await enablePush().catch(() => "unsupported" as PushState);
    if (push === "on") await recordPushChoice(false).catch(() => {});
  }

  /** "Not now" is a choice: Home will not say reminders are not reaching */
  function notNow() {
    skipped = true;
    void recordPushChoice(true).catch(() => {});
  }

  async function finish() {
    busy = true;
    try {
      if (settings && (wakeStart !== settings.wake_start || wakeEnd !== settings.wake_end)) {
        const { receiving_reminders: _r, ...rest } = settings;
        await rememberSettings(
          await apiPutSettings({
            ...rest,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || settings.tz,
            locale: getLocale(),
            wake_start: wakeStart,
            wake_end: wakeEnd,
          }),
        );
      }
    } catch {
      // Not saved now: Settings → Reminders shows the stored window
    }
    await requestPersistence();
    busy = false;
    onDone();
  }
</script>

<main class="auth-screen">
  <div class="auth-card">
    <p class="auth-step">{t("auth.step", { n: 3 })}</p>

    {#if push === "needs_install"}
      <h1 class="auth-title">{t("auth.install.ios.title")}</h1>
      <p class="auth-body">{t("auth.install.ios.body")}</p>
      <ol class="steps">
        <li>{t("auth.install.ios.step1")}</li>
        <li>{t("auth.install.ios.step2")}</li>
        <li>{t("auth.install.ios.step3")}</li>
      </ol>
    {:else}
      <!-- "Install & reminders" only where there is something to install -->
      <h1 class="auth-title">{canInstall ? t("auth.install.title") : t("auth.reminders.title")}</h1>
      <!-- What a check-in is, before the first one (PSY-02) -->
      <p class="auth-body">{t("auth.orientation")}</p>
      {#if canInstall}
        <p class="auth-body">{t("auth.install.android.body")}</p>
        <div class="row">
          <Button variant="secondary" onclick={() => void install()}>{t("auth.install.button")}</Button>
        </div>
      {/if}
      <h2 class="sub">{t("auth.notifications.title")}</h2>
      <p class="auth-body">{tn("auth.notifications.body", perDay)}</p>
      {#if push === "on"}
        <p class="auth-hint" role="status">✓</p>
      {:else if push === "denied"}
        <p class="auth-hint" role="status">{t("auth.notifications.denied")}</p>
      {:else if push !== "unsupported" && !skipped}
        <div class="row">
          <Button variant="primary" onclick={allow}>{t("auth.notifications.allow")}</Button>
          <button type="button" class="auth-link text-action" onclick={notNow}>
            {t("auth.notifications.later")}
          </button>
        </div>
      {/if}
    {/if}

    <h2 class="sub">{t("auth.window.title")}</h2>
    <p class="auth-body">{t("auth.window.body")}</p>
    <div class="window">
      <label>
        <span>{t("settings.reminders.window.from")}</span>
        <input type="time" class="auth-input fx-field" bind:value={wakeStart} />
      </label>
      <label>
        <span>{t("settings.reminders.window.to")}</span>
        <input type="time" class="auth-input fx-field" bind:value={wakeEnd} />
      </label>
    </div>
    {#if tooShort}
      <p class="auth-hint" role="status">
        {t("settings.reminders.windowTooShort", { h: Math.ceil(minWindow / 60), n: perDay })}
      </p>
    {/if}

    <div class="done">
      <Button variant="primary" size="large" loading={busy} disabled={tooShort} onclick={finish}>
        {t("auth.finish")}
      </Button>
    </div>
  </div>
</main>

<style>
  .sub {
    margin: 1.25rem 0 0.375rem;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--c-ink, #1c1c1a);
  }

  .steps {
    margin: 0 0 1rem;
    padding-left: 1.25rem;
    line-height: 1.6;
    color: var(--c-ink, #1c1c1a);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .window {
    display: flex;
    gap: 0.75rem;
  }

  .window label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
    color: var(--c-muted, #5c6670);
  }

  .done {
    display: flex;
    flex-direction: column;
    margin-top: 1.5rem;
  }

  /* A phone: Allow in the corner, "Not now" beside it (auth.css) */
  @media (max-width: 899px) {
    .row {
      flex-direction: row-reverse;
    }

    .row .auth-link {
      margin-left: 0;
    }
  }
</style>
