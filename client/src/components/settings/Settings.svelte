<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Settings, in the order of ui.md §11: Reminders, Language,
   * Appearance, Devices, Data and keys, Invites, Words, About, under a title
   * row with the methodology. Each section is its own component; changes
   * that other devices should see are synced.
   */
  import "./settings.css";
  import type { AccountInfo } from "../../../../shared/protocol.ts";
  import { runSync } from "../../lib/sync.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import SectionLanguage from "./SectionLanguage.svelte";
  import SectionAppearance from "./SectionAppearance.svelte";
  import SectionReminders from "./SectionReminders.svelte";
  import SectionInvites from "./SectionInvites.svelte";
  import SectionDevices from "./SectionDevices.svelte";
  import SectionData from "./SectionData.svelte";
  import SectionWords from "./SectionWords.svelte";
  import AboutContent from "./AboutContent.svelte";
  import { neighbourPane, type PaneId } from "../../lib/panes.ts";
  import { paneSwipe } from "../../lib/swipe.ts";
  import { stickyHeads } from "../../lib/sticky.ts";
  import { onMount } from "svelte";

  interface Props {
    account: AccountInfo;
    signedOut: boolean;
    onBack: () => void;
    /** Another pane of the registry (lib/panes.ts) */
    onOpenPane: (id: PaneId) => void;
    onLock: () => void;
    onLoggedOut: () => void;
    onSignIn: () => void;
  }

  let { account, signedOut, onBack, onOpenPane, onLock, onLoggedOut, onSignIn }: Props =
    $props();

  // A deep link such as `/settings#appearance` (ui.md §2.2)
  onMount(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  });

  function syncNow() {
    runSync(account.id).catch((err) => console.warn("Sync failed:", err));
  }

  /**
   * The neighbour pane (Settings is last: History before it, nothing after).
   * One rule on every pane (ui.md §2.2): a swipe or ←/→ steps to
   * the neighbour; Esc, a dot or a tab jump straight to theirs.
   */
  function stepPane(step: 1 | -1) {
    const pane = neighbourPane("settings", step);
    if (pane?.id === "home") onBack();
    else if (pane) onOpenPane(pane.id);
  }

  /** "Swipe right or press ← for History"; Esc goes Home (fields keep their keys) */
  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (
      e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented ||
      target?.closest("input, textarea, select, [role=dialog]") ||
      document.querySelector("[role=dialog]")
    ) {
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onBack();
    } else if (
      (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
      !target?.closest("[role=radiogroup]")
    ) {
      e.preventDefault();
      stepPane(e.key === "ArrowLeft" ? -1 : 1);
    }
  }

  // ui.md §5.3: a swipe right steps to the previous pane (History), a drag to the
  // left pulls toward nothing; never from a field, a sheet (its pointer
  // events bubble up here) or a side edge (lib/swipe.ts)
  const swipe = {
    onstep: stepPane,
    canStep: (dir: -1 | 1) => neighbourPane("settings", dir) !== null,
  };
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="settings-container"
  data-pane="settings"
  use:paneSwipe={swipe}
  use:stickyHeads
>
  <!-- No back chevron: the pane dots at the bottom go Home, where the thumb
       is (ui.md §2.2, owner decision 2026-10-10). The title row
       stays in view as the page scrolls, the methodology at its right end
       (ui.md §11, owner decision 2026-10-12); the hint goes under it -->
  <header class="settings-header">
    <h1 class="settings-title" tabindex="-1">{t("settings.title")}</h1>
    <a class="methodology" href={`/methodology#${getLocale()}`} target="_blank" rel="noopener noreferrer">
      {t("settings.methodology")}
    </a>
  </header>
  <p class="settings-hint swipe-hint">{t("settings.hint")}</p>

  <main class="settings-content">
    <!-- ui.md §11: what people come here for first; a theme is
         chosen once, so Appearance is one row that expands -->
    <SectionReminders />
    <SectionLanguage onchanged={syncNow} />
    <SectionAppearance
      accountId={account.id}
      keyVersion={account.current_key_version || 1}
      onchanged={syncNow}
    />
    <SectionDevices {signedOut} {onSignIn} {onLoggedOut} />
    <SectionData accountId={account.id} {onLock} {onLoggedOut} />
    <SectionInvites />
    <SectionWords />
    <section class="settings-section">
      <h2 class="section-header">{t("settings.about.header")}</h2>
      <div class="settings-card about-card">
        <AboutContent />
      </div>
    </section>
  </main>
</div>

<style>
  /* A link that leaves the screen: the solid underline (ui.md §14.4) */
  .methodology {
    flex: none;
    display: flex;
    align-items: center;
    min-height: 44px;
    color: var(--c-ink, #1c1c1a);
    font-size: 0.9375rem;
    text-underline-offset: 3px;
  }

  .methodology:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  .about-card {
    padding: 1rem;
  }
</style>
