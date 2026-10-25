<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * About: not a medical device, help when things are hard, what this server
   * can see, the source (AGPL §13) and the versions. Plain text and links,
   * never inside the check-in. Shared by Settings and the sign-in sheet;
   * works offline from `meta.instance`.
   * Specification: ui.md §11.10, api.md §2.11.
   */
  import { onDestroy, onMount } from "svelte";
  import { applyUpdate, onUpdateState, type UpdateState } from "../../lib/update.ts";
  import { whenSyncIdle } from "../../lib/sync.ts";
  import type { InstanceRes } from "../../../../shared/protocol.ts";
  import { cachedInstance, loadInstance } from "../../lib/instance.ts";
  import { CLIENT_VERSION } from "../../lib/version.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";

  let instance = $state<InstanceRes | null>(null);

  // A waiting version: "update ready — Restart" here too, also after "Later"
  // on the update card (ui.md §3)
  let update = $state<UpdateState>("none");
  onDestroy(onUpdateState((s) => (update = s)));
  let restarting = $state(false);
  async function restart() {
    restarting = true;
    await applyUpdate(() => whenSyncIdle());
  }

  onMount(async () => {
    instance = await cachedInstance();
    instance = (await loadInstance()) ?? instance;
  });

  const crisisUrl = $derived(instance?.crisis_url || "https://findahelpline.com");
  // The methodology (`/methodology`, built in, precached) opens in the
  // app's language, as does a notice on this server (`/privacy.html`, the
  // built-in one); an operator's own address is used as given
  const privacyUrl = $derived.by(() => {
    const url = instance?.privacy_notice_url;
    if (!url) return null;
    return /^\/[^/]/.test(url) && !url.includes("#") ? `${url}#${getLocale()}` : url;
  });
</script>

<div class="about">
  <section>
    <h3>{t("settings.about.medical.title")}</h3>
    <p>{t("settings.about.medical.body")}</p>
  </section>

  <section>
    <h3>{t("settings.about.methodology.title")}</h3>
    <p>{t("settings.about.methodology.body")}</p>
    <a href={`/methodology#${getLocale()}`} target="_blank" rel="noopener noreferrer">
      {t("settings.about.methodology.link")}
    </a>
  </section>

  <section>
    <h3>{t("settings.about.crisis.title")}</h3>
    <p>{t("settings.about.crisis.body")}</p>
    <a href={crisisUrl} target="_blank" rel="noopener noreferrer">{t("settings.about.crisis.link")}</a>
  </section>

  <section>
    <h3>{t("settings.about.privacy.title")}</h3>
    <p>{t("settings.about.privacy.body")}</p>
    {#if privacyUrl}
      <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
        {t("settings.about.privacy.notice")}
      </a>
    {/if}
    {#if instance?.operator_contact}
      <p>{t("settings.about.contact", { contact: instance.operator_contact })}</p>
    {/if}
  </section>

  <section>
    <h3>{t("settings.about.source.title")}</h3>
    <p>{t("settings.about.source.body")}</p>
    {#if instance?.source_url}
      <a href={instance.source_url} target="_blank" rel="noopener noreferrer">
        {t("settings.about.source.link")}
      </a>
    {/if}
  </section>

  <p class="version">
    {t("settings.about.version", { app: CLIENT_VERSION, server: instance?.version ?? "—" })}
    {#if update === "ready"}
      <span>{` · ${t("settings.about.updateReady")} — `}</span><button
        type="button"
        class="restart text-action"
        disabled={restarting}
        onclick={restart}
      >{restarting ? t("common.update.restarting") : t("settings.about.restart")}</button>
    {/if}
  </p>
</div>

<style>
  .about {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    color: var(--c-ink, #1c1c1a);
    font-size: 0.9375rem;
    line-height: 1.45;
  }

  h3 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    font-weight: 600;
  }

  p {
    margin: 0 0 0.25rem;
  }

  a {
    display: inline-block;
    min-height: 44px;
    line-height: 44px;
    color: var(--c-ink, #1c1c1a);
    text-underline-offset: 3px;
  }

  a:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  /* A phone: a link ends at the right edge, where the thumb is
     (ui.md §4.5); here and in the sign-in screen's sheet */
  @media (max-width: 899px) {
    a {
      display: block;
      width: fit-content;
      margin-left: auto;
      text-align: right;
    }
  }

  .restart {
    min-height: 44px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration-line: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .restart:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  .version {
    color: var(--c-muted, #5c6670);
    font-size: 0.875rem;
  }
</style>
