<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The app's button (ui.md §14.4): `primary` and `secondary`
   * (`outline` = a quiet secondary) are the shared looks of `fx.css`, with
   * their light, press and focus; `danger` and `ghost` are flat. While
   * `loading` it keeps its lit look, says so (`aria-busy`) and shows the
   * busy light (or its spinner) (ui.md §5.1).
   */
  import type { Snippet } from "svelte";

  interface Props {
    type?: "button" | "submit" | "reset";
    variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
    size?: "normal" | "large" | "small";
    disabled?: boolean;
    /** Busy: disabled, with a spinner before the label */
    loading?: boolean;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  }

  let {
    type = "button",
    variant = "primary",
    size = "normal",
    disabled = false,
    loading = false,
    onclick,
    children,
  }: Props = $props();
</script>

<button
  {type}
  class="btn {variant} {size}"
  class:btn-primary={variant === "primary"}
  class:btn-secondary={variant === "secondary" || variant === "outline"}
  class:quiet={variant === "outline"}
  disabled={disabled || loading}
  aria-busy={loading}
  {onclick}
>
  {#if loading}<span class="spinner" aria-hidden="true"></span>{/if}
  {@render children?.()}
</button>

<style>
  /* Size and type only; the looks are fx.css's (`btn-primary`,
     `btn-secondary`) or the two flat variants below */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    min-width: 44px;
    padding: 0.625rem 1.25rem;
    font-family: var(--font-ui, inherit);
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.25;
    user-select: none;
    text-decoration: none;
  }

  .primary {
    font-weight: 600;
  }

  .spinner {
    width: 1em;
    height: 1em;
    margin-right: 0.5em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: btn-spin 0.8s linear infinite;
  }

  @keyframes btn-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }

  /* #C53030: white on it reads at 5.4:1 (ui.md §10); flat, no
     glow: an alarm colour never shines */
  .danger,
  .ghost {
    border: 0;
    border-radius: var(--r-control, 12px);
    cursor: pointer;
    transition:
      background-color var(--dur-2) var(--ease-standard),
      scale var(--dur-spring) var(--ease-spring);
  }

  .danger {
    background-color: #c53030;
    color: #ffffff;
  }

  .ghost {
    background-color: transparent;
    color: var(--c-ink, #1c1c1a);
  }

  @media (hover: hover) and (pointer: fine) {
    .ghost:not(:disabled):hover {
      background-color: var(--c-surface-hi, var(--c-surface));
    }
  }

  .danger:not(:disabled):active,
  .ghost:not(:disabled):active {
    scale: 0.985;
    transition-duration: var(--dur-1);
    transition-timing-function: var(--ease-out);
  }

  .danger:disabled,
  .ghost:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .danger:focus-visible,
  .ghost:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  .large {
    min-height: 52px;
    padding: 0.875rem 1.5rem;
    font-size: 1.125rem;
  }

  .small {
    min-height: 36px;
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
  }
</style>
