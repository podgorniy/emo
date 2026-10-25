<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Invites: this account's codes (an unused one can be shared), how many
   * people joined, and "+ Create code". No emails or ids of invitees exist
   * on the client. Shown only when the instance allows user invites.
   * Specification: ui.md §11.8; api.md §2.2.
   */
  import "./settings.css";
  import { onMount } from "svelte";
  import type { InvitesListRes } from "../../../../shared/protocol.ts";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { apiCreateInvite, apiListInvites, ApiErrorResponse } from "../../lib/api.ts";
  import { userError } from "../../lib/errors.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";

  let list = $state<InvitesListRes | null>(null);
  let busy = $state(false);
  let errorKey = $state<MessageKey | null>(null);
  let copied = $state<string | null>(null);

  onMount(load);

  async function load() {
    try {
      list = await apiListInvites();
    } catch (err) {
      // 403 invites_disabled: the section stays hidden; offline: nothing to show
      if (!(err instanceof ApiErrorResponse)) list = null;
    }
  }

  const grouped = (code: string) => code.match(/.{1,4}/g)?.join("-") ?? code;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" }).format(new Date(iso));

  async function create() {
    busy = true;
    errorKey = null;
    try {
      await apiCreateInvite();
      await load();
    } catch (err) {
      errorKey = userError(err).key;
    } finally {
      busy = false;
    }
  }

  async function share(code: string) {
    const text = t("settings.invites.shareText", { code: grouped(code), url: location.origin });
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      copied = code;
    } catch {
      errorKey = "errors.generic";
    }
  }
</script>

{#if list}
  <section class="settings-section">
    <h2 class="section-header">
      {t("settings.invites.header")}
      <span class="aside">{t("settings.invites.joined", { n: list.joined_total })}</span>
    </h2>
    <div class="settings-card">
      {#each list.items as invite, i (invite.code ?? i)}
        <div class="settings-row">
          <span class="invite">
            <span class="code">{invite.code ? grouped(invite.code) : "••••-••••-••••"}</span>
            <span class="row-sub">
              {invite.status === "used" && invite.joined_at
                ? t("settings.invites.status.used", { date: date(invite.joined_at) })
                : invite.status === "unused"
                ? t("settings.invites.status.unused")
                : t("settings.invites.status.expired")}
            </span>
          </span>
          {#if invite.status === "unused" && invite.code}
            <button type="button" class="settings-link text-action" onclick={() => share(invite.code!)}>
              {copied === invite.code ? t("common.copied") : t("settings.invites.share")}
            </button>
          {/if}
        </div>
      {/each}
      <div class="settings-row">
        <button type="button" class="row-button" disabled={busy} onclick={create}>
          {t("settings.invites.create")}
        </button>
      </div>
    </div>
    <p class="settings-note" role="status">
      {errorKey === "errors.inviteLimit"
        ? t("settings.invites.limit", { n: list.limit })
        : errorKey
        ? t(errorKey)
        : t("settings.invites.note")}
    </p>
  </section>
{/if}

<style>
  .invite {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .code {
    font-family: var(--font-mono, monospace);
    font-size: 0.9375rem;
    letter-spacing: 0.04em;
  }
</style>
