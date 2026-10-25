<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Language: a 3-way segmented radio group (the shared `.seg`: the chosen
   * one a raised surface that slides). The change applies at once
   * (`<html lang>`, every string), reaches other tabs, and the server learns
   * it on the next sync (mail and push language).
   * Specification: ui.md §11.4.
   */
  import "./settings.css";
  import type { Locale } from "../../../../shared/protocol.ts";
  import { getLocale, LOCALES, setLocale, t } from "../../lib/i18n.svelte.ts";
  import { broadcast } from "../../lib/channel.ts";

  interface Props {
    onchanged: () => void;
  }

  let { onchanged }: Props = $props();

  async function choose(id: Locale) {
    if (id === getLocale()) return;
    await setLocale(id);
    broadcast({ type: "locale", payload: id });
    onchanged();
  }
</script>

<section class="settings-section">
  <h2 class="section-header" id="language-header">{t("settings.language.header")}</h2>
  <div class="seg" role="radiogroup" aria-labelledby="language-header">
    <span
      class="seg-puck"
      style:--n={LOCALES.length}
      style:--i={Math.max(0, LOCALES.findIndex((l) => l.id === getLocale()))}
      aria-hidden="true"
    ></span>
    {#each LOCALES as loc (loc.id)}
      <button
        type="button"
        role="radio"
        aria-checked={getLocale() === loc.id}
        class:on={getLocale() === loc.id}
        lang={loc.id}
        onclick={() => choose(loc.id)}
      >
        {loc.native}
      </button>
    {/each}
  </div>
</section>


