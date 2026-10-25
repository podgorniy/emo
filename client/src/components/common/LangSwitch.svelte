<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The language choice on every screen before the app (sign-in, onboarding,
   * unlock, account gone, storage damaged): the shared `.seg`, the chosen
   * language a raised surface that slides. It works locked and signed out
   * (the locale is kept unencrypted) and reaches other tabs. Inside the app,
   * Settings holds it (SectionLanguage).
   * Placement: top right on a desktop; on a phone under the card, at the
   * right edge. The parent is a positioned flex column.
   * Specification: ui.md §12.1.
   */
  import type { Locale } from "../../../../shared/protocol.ts";
  import { getLocale, LOCALES, setLocale, t } from "../../lib/i18n.svelte.ts";
  import { broadcast } from "../../lib/channel.ts";

  async function choose(id: Locale) {
    if (id === getLocale()) return;
    await setLocale(id);
    broadcast({ type: "locale", payload: id });
  }
</script>

<div class="lang-selector seg" role="group" aria-label={t("settings.language.header")}>
  <span
    class="seg-puck"
    style:--n={LOCALES.length}
    style:--i={Math.max(0, LOCALES.findIndex((l) => l.id === getLocale()))}
    aria-hidden="true"
  ></span>
  {#each LOCALES as loc (loc.id)}
    <button
      type="button"
      class="lang-btn"
      class:on={getLocale() === loc.id}
      aria-pressed={getLocale() === loc.id}
      lang={loc.id}
      onclick={() => choose(loc.id)}
    >
      {loc.native}
    </button>
  {/each}
</div>

<style>
  .lang-selector {
    position: absolute;
    top: calc(var(--safe-top, 0px) + 0.5rem);
    right: 1rem;
  }

  /* Chrome, so no highlight: the shared segmented control (fx.css) */
  .lang-btn {
    min-width: 44px;
    padding: 0 0.625rem;
    font-size: 0.875rem;
  }

  /* A phone (ui.md §4.5, §12.1): under the card, at the right edge */
  @media (max-width: 899px) {
    .lang-selector {
      position: relative;
      top: auto;
      right: auto;
      order: 1;
      align-self: flex-end;
      margin-top: 0.5rem;
    }
  }
</style>
