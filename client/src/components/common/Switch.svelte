<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * The on/off switch of Settings (ui.md §11, §13, §14.4): a
   * 52×32 track in a 44 px tall target. Off is a recessed track with a firm
   * edge, readable against the card (≥ 3:1); on is the accent, lit where the
   * accent is cool. The knob springs across and stretches a little toward
   * its travel while pressed (ui.md §5.1). The state is the track colour and the
   * knob's place, never colour alone.
   */
  interface Props {
    checked: boolean;
    /** The id of the visible label */
    labelledby: string;
    describedby?: string;
    disabled?: boolean;
    onclick: () => void;
  }

  let { checked, labelledby, describedby, disabled = false, onclick }: Props = $props();
</script>

<button
  type="button"
  role="switch"
  class="switch"
  aria-checked={checked}
  aria-labelledby={labelledby}
  aria-describedby={describedby}
  {disabled}
  {onclick}
><span class="knob" aria-hidden="true"></span></button>

<style>
  .switch {
    position: relative;
    flex: 0 0 52px;
    width: 52px;
    height: 44px;
    padding: 0;
    border: none;
    border-radius: 16px;
    background: none;
    cursor: pointer;
  }

  .switch::before {
    content: "";
    position: absolute;
    top: 6px;
    left: 0;
    width: 52px;
    height: 32px;
    border-radius: 16px;
    background-color: var(--c-track, #d3e0e6);
    background-image: none;
    box-shadow: inset 0 0 0 1.5px var(--c-line-strong, #7a847f), var(--fx-inset);
    transition:
      background-color var(--dur-2) var(--ease-standard),
      box-shadow var(--dur-3) var(--ease-out);
  }

  .switch[aria-checked="true"]::before {
    background-color: var(--c-accent, #4f46e5);
    background-image: var(--fx-sheen, none);
    box-shadow: var(--fx-rim-fill), var(--fx-accent-aura-sm);
  }

  .knob {
    position: absolute;
    top: 9px;
    left: 3px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--c-knob, #ffffff);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), 0 0 0 0.5px rgb(0 0 0 / 0.08);
    transform-origin: left center;
    transition:
      transform var(--dur-spring) var(--ease-spring),
      scale var(--dur-1) var(--ease-out);
  }

  .switch[aria-checked="true"] .knob {
    transform: translateX(20px);
    transform-origin: right center;
  }

  .switch:not(:disabled):active .knob {
    scale: 1.15 1;
  }

  .switch:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .switch:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }
</style>
