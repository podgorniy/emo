<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Step 2 of 3 — the recovery key, shown once: an 8 × 4 grid and three ways
   * to keep it (multi-select). Next stays disabled until one is done. A way
   * done is "chosen" in the check-in's cool language: a highlight edge and a
   * soft halo. "Copied" rises into the button and the key's well brightens
   * once, so what was copied answers it (ui.md §5.1).
   * Specification: ui.md §12.7, architecture.md §4.1,
   * §5.6.
   */
  import "./auth.css";
  import { onMount, tick } from "svelte";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { apiGetInstance, apiSendRecoveryMail } from "../../lib/api.ts";
  import { userError } from "../../lib/errors.ts";
  import { t } from "../../lib/i18n.svelte.ts";
  import { arrive, EASE, play } from "../../lib/motion.ts";
  import Button from "../common/Button.svelte";

  interface Props {
    recoveryKey: string;
    /** The account address, when this device knows it (sign-up). */
    email?: string | null;
    /** "Step 2 of 3" during onboarding; none for a new key from Settings. */
    step?: number | null;
    /** false inside a page that already has its `<main>` (Settings). */
    landmark?: boolean;
    onConfirmed: () => void;
  }

  let { recoveryKey, email = null, step = 2, landmark = true, onConfirmed }: Props = $props();

  const groups = $derived(recoveryKey.split("-"));
  let saved = $state(false);
  let mailed = $state(false);
  let written = $state(false);
  let mailEnabled = $state(true);
  let sending = $state(false);
  let mailError = $state<MessageKey | null>(null);
  let copyState = $state<"idle" | "copied" | "failed">("idle");
  let keyEl = $state<HTMLElement | null>(null);
  let copyLabel = $state<HTMLElement | null>(null);
  const done = $derived(saved || mailed || written);

  onMount(async () => {
    try {
      mailEnabled = (await apiGetInstance()).recovery_mail_enabled;
    } catch {
      // Offline: the card stays; sending will say so
    }
  });

  async function saveFile() {
    const today = new Date().toISOString().slice(0, 10);
    const filename = `emo-recovery-${today}.txt`;
    const text = t("auth.recovery.file.body", {
      key: recoveryKey,
      email: email ?? "—",
      url: location.host,
    }) + "\n";
    const file = new File([text], filename, { type: "text/plain" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t("auth.recovery.title") });
        saved = true;
        return;
      }
    } catch (err) {
      // The share sheet was dismissed: not saved
      if ((err as DOMException)?.name === "AbortError") return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    saved = true;
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      const again = copyState === "copied";
      copyState = "copied";
      await tick();
      if (!again) arrive(copyLabel, "up", { offset: 6, duration: 160 });
      // The well lights with the highlight's tint and settles back, once
      if (keyEl) {
        const css = getComputedStyle(keyEl);
        const from = css.getPropertyValue("--c-info").trim();
        if (from) {
          play(keyEl, [{ backgroundColor: from }, { backgroundColor: css.backgroundColor }], {
            duration: 600,
            easing: EASE.out,
            id: "flash",
          });
        }
      }
    } catch {
      // Denied, or not a secure context: say so instead of doing nothing
      copyState = "failed";
    }
  }

  async function sendMail() {
    sending = true;
    mailError = null;
    try {
      await apiSendRecoveryMail(recoveryKey);
      mailed = true;
    } catch (err) {
      const e = userError(err);
      mailError = e.key === "errors.tooManyRequests" ? "auth.recovery.email.limit" : e.key;
    } finally {
      sending = false;
    }
  }
</script>

<svelte:element this={landmark ? "main" : "div"} class="auth-screen">
  <div class="auth-card">
    {#if step}<p class="auth-step">{t("auth.step", { n: step })}</p>{/if}
    <h1 class="auth-title">{t("auth.recovery.title")}</h1>
    <p class="auth-body">{t("auth.recovery.body")}</p>

    <div class="key" role="group" aria-label={t("auth.recovery.key.aria")} bind:this={keyEl}>
      {#each groups as group, i (i)}
        <span class="group">{group}</span>
      {/each}
    </div>
    <div class="copy-row">
      <button type="button" class="auth-link text-action" onclick={copyKey}>
        <span class="copy-label" bind:this={copyLabel}>
          {copyState === "copied" ? t("common.copied") : t("common.copy")}
        </span>
      </button>
      {#if copyState === "failed"}
        <span class="auth-hint" role="status">{t("auth.recovery.copy.failed")}</span>
      {/if}
    </div>

    <div class="channels">
      <button type="button" class="channel" class:done={saved} aria-pressed={saved} onclick={saveFile}>
        <span class="mark" aria-hidden="true"></span>
        <span class="text">
          <strong>{t("auth.recovery.save.title")}</strong>
          <span>{saved ? t("auth.recovery.save.done") : t("auth.recovery.save.body")}</span>
        </span>
      </button>

      {#if mailEnabled}
        <button
          type="button"
          class="channel"
          class:done={mailed}
          aria-pressed={mailed}
          disabled={sending || mailed}
          onclick={sendMail}
        >
          <span class="mark" aria-hidden="true"></span>
          <span class="text">
            <strong>{t("auth.recovery.email.title")}</strong>
            <span class="warning">
              {mailed ? t("auth.recovery.email.done") : t("auth.recovery.email.warning")}
            </span>
            {#if mailError}<span role="alert">{t(mailError)}</span>{/if}
          </span>
        </button>
      {/if}

      <button
        type="button"
        class="channel"
        class:done={written}
        aria-pressed={written}
        onclick={() => (written = !written)}
      >
        <span class="mark" aria-hidden="true"></span>
        <span class="text">
          <strong>{t("auth.recovery.write.title")}</strong>
          <span>{written ? t("auth.recovery.write.done") : t("auth.recovery.write.body")}</span>
        </span>
      </button>
    </div>

    <div class="next">
      <Button variant="primary" size="large" disabled={!done} onclick={onConfirmed}>
        {t("common.next")}
      </Button>
    </div>
  </div>
</svelte:element>

<style>
  .next {
    display: flex;
    flex-direction: column;
  }

  .key {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem 0.75rem;
    padding: 1rem;
    border: 1px solid var(--c-line, #e2e8f0);
    border-radius: 12px;
    background: var(--c-ground, #f7f6f2);
    box-shadow: var(--fx-inset);
    font-family: var(--font-mono, monospace);
    font-size: 1.125rem;
    text-align: center;
    letter-spacing: 0.05em;
    user-select: all;
  }

  /* A box, so "Copied" can rise into place; the button's dotted underline
     does not reach into a box by itself */
  .copy-label {
    display: inline-block;
    text-decoration: inherit;
  }

  .copy-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.25rem 0 1rem;
  }

  /* A phone: Copy at the right edge, under the key (auth.css) */
  @media (max-width: 899px) {
    .copy-row {
      justify-content: flex-end;
    }
  }

  .channels {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    margin-bottom: 1.25rem;
  }

  /* Three equal choices with a lit rim; done = the cool "chosen" of the
     check-in: a 2 px highlight edge (padding gives back the half pixel, so
     nothing shifts) and its soft halo */
  .channel {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    min-height: 64px;
    padding: 0.75rem;
    border: 1.5px solid var(--c-line, #e2e8f0);
    border-radius: min(var(--r-control, 12px), 16px);
    background: var(--c-surface, #ffffff);
    box-shadow: var(--fx-rim), var(--fx-lift-1);
    color: var(--c-ink, #1c1c1a);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--dur-2) var(--ease-standard),
      border-color var(--dur-2) var(--ease-standard),
      box-shadow var(--dur-3) var(--ease-out),
      scale var(--dur-spring) var(--ease-spring);
  }

  @media (hover: hover) and (pointer: fine) {
    .channel:not(:disabled):hover {
      border-color: var(--c-line-strong, var(--c-line));
      background: var(--c-surface-hi, var(--c-surface));
    }
  }

  .channel:not(:disabled):active {
    scale: 0.99;
    box-shadow: var(--fx-press);
    transition-duration: var(--dur-1);
    transition-timing-function: var(--ease-out);
  }

  .channel:disabled {
    cursor: default;
  }

  .channel.done {
    padding: calc(0.75rem - 0.5px);
    border: 2px solid var(--c-focus, #4f46e5);
    background: var(--c-surface-hi, var(--c-surface));
    box-shadow: var(--fx-rim), var(--fx-sel-aura);
  }

  .channel:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  .mark {
    flex: 0 0 22px;
    height: 22px;
    margin-top: 2px;
    border: 2px solid var(--c-line-strong, var(--c-line));
    border-radius: 50%;
    transition: border-color var(--dur-2) var(--ease-standard);
  }

  .channel.done .mark {
    border-color: var(--c-focus, #4f46e5);
    background:
      var(--fx-thumb-sheen, none),
      radial-gradient(circle, var(--c-focus, #4f46e5) 5px, transparent 5.5px);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9375rem;
    line-height: 1.35;
  }

  /* ui.md §12.7 asks for #312E81; the theme's ink keeps it readable on dark grounds */
  .warning {
    color: var(--c-ink, #312e81);
    font-weight: 500;
  }
</style>
