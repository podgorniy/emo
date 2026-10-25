<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Sign in: email (plus an invite code behind a toggle, for new accounts:
   * optional on an open server, required with REGISTRATION=invite), then,
   * on the same card, the 6-digit code from the email: the address
   * stays in sight in full with "Change", the code field is focused and
   * sends itself at 6 digits (UX-13). Every failed verification shows the
   * same message; the server's own text is never shown. On a device that
   * holds an account it is "Sign in to sync": that account's email, no
   * invite, and a way to another account or back (reliability.md §1.3).
   * Under the card, "Methodology" (readable without an account) and "About
   * and privacy", in one row on a sideways phone in every language.
   * Going to the code and back, the card keeps its place: its size morphs
   * and its content crossfades (ui.md §5.1).
   * Specification: ui.md §12, reliability.md §1.4,
   * api.md §2.1.
   */
  import { onDestroy, onMount, tick } from "svelte";
  import { apiRequestCode, apiVerifyCode } from "../../lib/api.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import { maskEmail, type UserError, userError } from "../../lib/errors.ts";
  import { swapCard } from "../../lib/motion.ts";
  import type { InstanceRes } from "../../../../shared/protocol.ts";
  import { cachedInstance, loadInstance } from "../../lib/instance.ts";
  import Button from "../common/Button.svelte";
  import ConfirmSheet from "../common/ConfirmSheet.svelte";
  import LangSwitch from "../common/LangSwitch.svelte";
  import Mark from "../common/Mark.svelte";
  import AboutContent from "../settings/AboutContent.svelte";

  interface Props {
    onVerified: (
      account: { id: string; created: boolean; has_keyring: boolean },
      email: string,
    ) => void;
    /** This device holds an account whose sync waits for this sign-in */
    deviceAccount?: boolean;
    /** "Use a different account" (deviceAccount only) */
    onSwitchAccount?: () => void;
    /** Back to the account this device holds (deviceAccount only) */
    onBack?: () => void;
  }

  let { onVerified, deviceAccount = false, onSwitchAccount, onBack }: Props = $props();

  const RESEND_AFTER_SEC = 60;

  let step = $state<"email" | "code">("email");
  let email = $state("");
  let showInvite = $state(false);
  let inviteCode = $state("");
  let code = $state("");
  let loading = $state(false);
  let error = $state<UserError | null>(null);
  /** Seconds until "Resend" (or, after a 429/503, until trying again) */
  let wait = $state(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  /** "About and privacy" before anyone has an account (ui.md §12.2) */
  let aboutOpen = $state(false);
  let instance = $state<InstanceRes | null>(null);
  /**
   * REGISTRATION=invite: a new account needs an invite code. Unknown (not
   * loaded yet) counts as open, the default, so the title never flickers.
   * Open: "Sign in or create an account" on the email step only; the code
   * card keeps the short title (sideways, with a keyboard, it must fit)
   */
  const inviteOnly = $derived(instance?.registration === "invite");
  let inviteInput: HTMLInputElement | undefined = $state();
  /** Sent with the code request: no "needs an invite" note after it */
  const inviteSent = $derived(showInvite && inviteCode.trim() !== "");
  /** "Enter your email" under the field, instead of the browser's bubble */
  let emailMissing = $state(false);
  let emailInput: HTMLInputElement | undefined = $state();
  let codeInput: HTMLInputElement | undefined = $state();
  /**
   * 60 s after a code was asked for with an invite: "Check the invite code".
   * Shown whether or not a mail went out, so it says nothing about which
   * addresses have accounts (api.md §2.1)
   */
  let inviteLate = $state(false);
  let inviteTimer: ReturnType<typeof setTimeout> | null = null;
  const INVITE_CHECK_AFTER_MS = 60_000;

  onMount(async () => {
    instance = await cachedInstance();
    instance = (await loadInstance()) ?? instance;
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
    if (inviteTimer) clearTimeout(inviteTimer);
  });

  function countDown(seconds: number) {
    wait = seconds;
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      wait = Math.max(0, wait - 1);
      if (wait === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    }, 1000);
  }

  const waitText = $derived(
    `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`,
  );

  function fail(err: unknown) {
    error = userError(err);
    if (error.retryAfterSec) countDown(error.retryAfterSec);
  }

  async function requestCode(e?: Event) {
    e?.preventDefault();
    if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
      emailMissing = true;
      emailInput?.focus();
      return;
    }
    emailMissing = false;
    loading = true;
    error = null;
    try {
      await apiRequestCode(
        email.trim(),
        showInvite && inviteCode.trim() ? inviteCode.trim() : undefined,
        getLocale(),
      );
      await swapCard("fwd", () => {
        step = "code";
        code = "";
      });
      countDown(RESEND_AFTER_SEC);
      if (inviteTimer) clearTimeout(inviteTimer);
      inviteLate = false;
      // Open: a mistyped invite is left out and the mail still goes
      if (inviteSent && inviteOnly) {
        inviteTimer = setTimeout(() => (inviteLate = true), INVITE_CHECK_AFTER_MS);
      }
      await tick();
      codeInput?.focus();
    } catch (err) {
      fail(err);
    } finally {
      loading = false;
    }
  }

  async function verify(e?: Event) {
    e?.preventDefault();
    if (code.length !== 6 || loading) return;
    loading = true;
    error = null;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const res = await apiVerifyCode(email.trim(), code, tz, getLocale());
      onVerified(res.account, email.trim());
    } catch (err) {
      fail(err);
      // A rejected code is not left in the field to be sent again
      code = "";
      await tick();
      codeInput?.focus();
    } finally {
      loading = false;
    }
  }

  /** "Change": back to the email (and the invite), both kept */
  async function differentEmail() {
    await swapCard("back", () => {
      step = "email";
      code = "";
      error = null;
    });
    inviteLate = false;
    if (inviteTimer) clearTimeout(inviteTimer);
    await tick();
    emailInput?.focus();
  }

  /** "I have an invite code": the field appears and takes focus (D14) */
  async function openInvite() {
    showInvite = true;
    await tick();
    inviteInput?.focus();
  }

  /** "No code?": back to the email, kept, with the invite field open */
  async function addInvite() {
    await differentEmail();
    showInvite = true;
    await tick();
    inviteInput?.focus();
  }

</script>

<main class="login-container">
  <LangSwitch />

  <div class="login-card">
    {#if !deviceAccount}
      <!-- What Emo is, before anything is asked (ui.md §12.2) -->
      <p class="wordmark"><Mark size={30} />Emo</p>
      <p class="tagline">{t("auth.signin.tagline")}</p>
    {/if}
    <h1 class="login-title">
      {deviceAccount
        ? t("auth.signin.again.title")
        : showInvite
        ? t("auth.signin.title.create")
        : inviteOnly || step === "code"
        ? t("auth.signin.title")
        : t("auth.signin.title.open")}
    </h1>
    {#if deviceAccount && step === "email"}
      <p class="login-subtitle">{t("auth.signin.again.body")}</p>
    {/if}

    {#if error}
      <div class="error-banner" role="alert">
        {t(error.key, error.params)}{#if step === "email" && wait > 0} ({waitText}){/if}
      </div>
    {/if}

    {#if step === "email"}
      <form onsubmit={requestCode} class="login-form" novalidate>
        <div class="form-group">
          <label for="email-input">{t("auth.signin.email")}</label>
          <input
            id="email-input"
            type="email"
            autocomplete="email"
            autocapitalize="off"
            spellcheck="false"
            bind:value={email}
            bind:this={emailInput}
            oninput={() => (emailMissing = false)}
            aria-invalid={emailMissing ? "true" : undefined}
            aria-describedby={emailMissing ? "email-missing" : undefined}
            class="input-field fx-field"
          />
          {#if emailMissing}
            <p class="field-error" id="email-missing">{t("auth.signin.email.empty")}</p>
          {/if}
        </div>

        {#if showInvite}
          <div class="form-group">
            <label for="invite-input">{t("auth.signin.invite")}</label>
            <input
              id="invite-input"
              type="text"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              bind:value={inviteCode}
              bind:this={inviteInput}
              class="input-field fx-field mono"
            />
          </div>
        {:else if !deviceAccount}
          <button type="button" class="link-btn text-action" onclick={openInvite}>
            {t("auth.signin.inviteToggle")}
          </button>
        {/if}

        <Button
          type="submit"
          variant="primary"
          size="large"
          loading={loading}
          disabled={wait > 0 && error !== null}
        >
          {t("auth.signin.sendCode")}
        </Button>
      </form>
      {#if deviceAccount}
        <div class="again-links">
          <button type="button" class="link-btn" onclick={onSwitchAccount}>
            {t("auth.signin.again.switch")}
          </button>
          <button type="button" class="link-btn" onclick={onBack}>
            {t("common.back")}
          </button>
        </div>
      {/if}
    {:else}
      <!-- The same card: the address in full (masked only in "Sign in to
           sync"), "Change", then the code (ui.md §12.3) -->
      <p class="login-subtitle sent" id="code-sent">
        {t("auth.code.body", { email: deviceAccount ? maskEmail(email.trim()) : email.trim() })}
      </p>
      <button type="button" class="link-btn change" aria-describedby="code-sent" onclick={differentEmail}>
        {t("auth.code.change")}
      </button>

      <form onsubmit={verify} class="login-form">
        <input
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]*"
          maxlength="6"
          aria-label={t("auth.code.input.aria")}
          bind:value={code}
          bind:this={codeInput}
          oninput={() => {
            code = code.replace(/\D/g, "").slice(0, 6);
            // Six digits send themselves (UX-13)
            if (code.length === 6) void verify();
          }}
          required
          class="input-field fx-field code-field"
        />

        <Button type="submit" variant="primary" size="large" loading={loading} disabled={code.length !== 6}>
          {t("auth.code.signIn")}
        </Button>

        <div class="resend-row">
          {#if wait > 0}
            <span class="countdown-text" aria-live="off">
              {t("auth.code.resendIn", { m: Math.floor(wait / 60), ss: String(wait % 60).padStart(2, "0") })}
            </span>
          {:else}
            <button type="button" class="link-btn text-action" onclick={() => requestCode()}>
              {t("auth.code.resend")}
            </button>
          {/if}
        </div>
        {#if inviteSent}
          {#if inviteLate}
            <p class="note" role="status">{t("auth.code.inviteCheck")}</p>
          {/if}
        {:else if !deviceAccount && inviteOnly}
          <div class="invite-note">
            <p class="note">{t("auth.code.inviteNote")}</p>
            <button type="button" class="link-btn" onclick={addInvite}>
              {t("auth.code.addInvite")}
            </button>
          </div>
        {/if}
      </form>
    {/if}
    <div class="foot-links">
      <!-- The methodology, before any account: a page of its own -->
      <a class="link-btn" href={`/methodology#${getLocale()}`} target="_blank" rel="noopener noreferrer">
        {t("auth.signin.methodology")}
      </a>
      <button type="button" class="link-btn about-link text-action" onclick={() => (aboutOpen = true)}>
        {t("auth.signin.about")}
      </button>
    </div>
  </div>
</main>

{#if aboutOpen}
  <ConfirmSheet title={t("auth.signin.about")} oncancel={() => (aboutOpen = false)}>
    <AboutContent />
  </ConfirmSheet>
{/if}

<style>
  /* "Methodology" · "About and privacy": centred under a desktop card; at
     the right edge on a phone, "About and privacy" last (ui.md §4.5) */
  .foot-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0 1.25rem;
    margin-top: 1rem;
  }

  a.link-btn {
    display: inline-flex;
    align-items: center;
  }

  .login-container {
    width: 100%;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    /* Clear of the language buttons above the card, however tall it is */
    padding-top: calc(3.75rem + var(--safe-top, 0px));
    position: relative;
  }

  .link-btn:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  /* As the other sign-in cards (auth.css): a lit rim, floating */
  .login-card {
    width: 100%;
    max-width: 400px;
    background-color: var(--c-surface, #ffffff);
    border: 1px solid var(--c-line, #e2e8f0);
    border-radius: var(--r-card, 16px);
    padding: 2rem;
    box-shadow: var(--fx-rim), var(--fx-lift-2);
  }

  /* The pane bar's wordmark with its mark, larger; the tagline says what Emo
     is */
  .wordmark {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 0.5rem;
    font-family: var(--font-display, inherit);
    font-size: 1.375rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--c-ink, #1c1c1a);
  }

  .tagline {
    margin: 0 0 1.5rem;
    font-size: 1rem;
    line-height: 1.45;
    color: var(--c-muted, #5c6670);
  }

  .field-error {
    margin: 0.125rem 0 0;
    font-size: 0.875rem;
    color: var(--c-ink, #1c1c1a);
  }

  .login-title {
    font-family: var(--font-display, inherit);
    font-size: 1.75rem;
    font-weight: 500;
    color: var(--c-ink, #1c1c1a);
    margin-bottom: 0.75rem;
  }

  .login-subtitle {
    font-size: 1rem;
    line-height: 1.45;
    color: var(--c-ink, #1c1c1a);
    margin-bottom: 1.25rem;
    overflow-wrap: anywhere;
  }

  .error-banner {
    border: 1px solid var(--c-line, #e2e8f0);
    background-color: var(--c-ground, #f7f6f2);
    color: var(--c-ink, #1c1c1a);
    padding: 0.75rem;
    border-radius: var(--r-field, 8px);
    font-size: 0.9375rem;
    margin-bottom: 1.25rem;
  }

  .login-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .form-group label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--c-ink, #1c1c1a);
  }

  /* With `.fx-field` (fx.css): one luminous ring on focus, never a border and a
     ring; an error is 2 px ink */
  .input-field {
    min-height: 48px;
    padding: 0.625rem 0.875rem;
    font-family: inherit;
    font-size: 1rem;
  }

  .input-field.mono {
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .code-field {
    height: 64px;
    font-family: var(--font-mono, monospace);
    font-size: 1.875rem;
    letter-spacing: 0.5em;
    text-align: center;
  }

  /* "Change" right under the address */
  .login-subtitle.sent {
    margin-bottom: 0.25rem;
  }

  .link-btn.change {
    display: block;
    margin-bottom: 1rem;
  }

  .resend-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.9375rem;
  }

  .again-links {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  /* "Back" is a short word: still a 44 px target */
  .again-links .link-btn {
    min-width: 44px;
  }

  .invite-note {
    display: flex;
    flex-direction: column;
  }

  .invite-note .note {
    margin: 0;
  }

  .countdown-text,
  .note {
    color: var(--c-muted, #718096);
    font-size: 0.875rem;
  }

  .link-btn {
    align-self: flex-start;
    min-height: 44px;
    background: transparent;
    border: none;
    color: var(--c-ink, #1c1c1a);
    font-size: 0.9375rem;
    text-decoration-line: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    padding: 0;
  }

  /* A phone (ui.md §4.5, §12; owner decision 2026-10-10): the
     card at the bottom like a sheet, its fields and buttons under the
     thumb; the languages under it at the right; every text link at the
     right edge */
  @media (max-width: 899px) {
    .login-container {
      justify-content: flex-end;
      padding-top: calc(1.5rem + var(--safe-top, 0px));
    }

    .link-btn {
      display: block;
      align-self: flex-end;
      margin-left: auto;
      text-align: right;
    }

    .resend-row,
    .again-links,
    .foot-links {
      justify-content: flex-end;
    }

    .foot-links .link-btn {
      margin-left: 0;
    }
  }
</style>
