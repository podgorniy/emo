<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  /**
   * Appearance, inline in Settings (ui.md §13): the current
   * choice, a live preview of a check-in step in the chosen theme, the 10
   * presets, and for tintable ones the base colour (8 swatches + Custom) and
   * the gradient with its second colour, then a status line. Applies at once
   * and is stored in the encrypted prefs (ui.md §14.8). A custom colour that fails
   * the contrast checks stays in the preview until another one is picked.
   * Everything is painted through CSS variables set with CSSOM (`style:` and
   * `setProperty`), which the CSP allows. "Match the system" (opt-in, off by
   * default, UX-26) paints Calm in light mode and Dusk in dark mode; choosing
   * a theme turns it off. "Moving background" (on by default where the theme
   * has one) can keep the ambient light still; it is not offered for the
   * themes without it, and it is not part of the theme (ui.md §13.7).
   */
  import "./settings.css";
  import { PRESETS } from "../../../../shared/theme/presets.ts";
  import {
    type AppearancePref,
    type Hex,
    PRESET_IDS,
    type PresetId,
  } from "../../../../shared/theme/schema.ts";
  import {
    checks,
    dark,
    light,
    resolveTheme,
    SEEDS,
  } from "../../../../shared/theme/tint.ts";
  import { isHex } from "../../../../shared/theme/validate.ts";
  import { BODY_ZONES, QUALITIES, WORDS } from "../../../../shared/dictionaries.ts";
  import type { MessageKey } from "../../../../shared/i18n/keys.ts";
  import { effectiveAppearance, getAppearance, themeCss } from "../../lib/theme.ts";
  import { saveAppearance } from "../../lib/prefs.ts";
  import { getLocale, t } from "../../lib/i18n.svelte.ts";
  import BodyMap from "../flow/BodyMap.svelte";
  import OptionGrid from "../flow/OptionGrid.svelte";
  import Slider from "../common/Slider.svelte";
  import Switch from "../common/Switch.svelte";
  import { fxOff } from "../../lib/theme.ts";

  interface Props {
    accountId: string;
    keyVersion: number;
    onchanged: () => void;
  }

  let { accountId, keyVersion, onchanged }: Props = $props();

  /** What the controls show; the app gets it only when it is readable */
  let pref = $state<AppearancePref>({ ...getAppearance() });
  const resolved = $derived(resolveTheme(effectiveAppearance(pref)));
  const auto = $derived(pref.auto === true);
  const status = $derived(checks(resolved.c));
  const preset = $derived(PRESETS[pref.themeId]);
  const tintable = $derived(!!preset.tint);
  const locale = $derived(getLocale());

  const nameOf = (id: PresetId) =>
    id === "calm" ? t("settings.appearance.theme.calm.name") : PRESETS[id].name;
  const seedLabel = (hex: Hex | null) => {
    if (!hex) return t("settings.appearance.swatch.original");
    const seed = SEEDS.find((s) => s.hex === hex);
    return seed
      ? t(`settings.appearance.swatch.${seed.id}` as MessageKey)
      : t("settings.appearance.swatch.custom");
  };
  const current = $derived(
    auto
      ? t("settings.appearance.auto.current")
      : !tintable
      ? nameOf(pref.themeId)
      : pref.gradient
      ? t("settings.appearance.current", {
        theme: nameOf(pref.themeId),
        seed: seedLabel(pref.seed),
      })
      : `${nameOf(pref.themeId)} · ${seedLabel(pref.seed)}`,
  );

  const PAIR_KEYS: Record<string, MessageKey> = {
    text: "settings.appearance.pair.text",
    buttons: "settings.appearance.pair.buttons",
    selected: "settings.appearance.pair.selected",
    cards: "settings.appearance.pair.cards",
    "secondary text": "settings.appearance.pair.secondary",
    "secondary text (gradient)": "settings.appearance.pair.secondaryGradient",
    "text (gradient)": "settings.appearance.pair.textGradient",
  };

  async function change(next: AppearancePref) {
    pref = next;
    // ui.md §13.9: a choice with low contrast is previewed, not applied
    if (!checks(resolveTheme(effectiveAppearance(next)).c).readable) return;
    await saveAppearance(next, accountId, keyVersion);
    onchanged();
  }

  /** ui.md §13.4: a theme starts from its own look */
  const chooseTheme = (themeId: PresetId) =>
    // An explicit choice turns "Match the system" off (`false` is dropped
    // when stored; a missing key would keep the old value in the merge)
    change({ themeId, seed: null, gradient: false, seed2: null, auto: false });
  /** "Match the system": the chosen theme is kept for when it is off */
  const toggleAuto = () => change({ ...pref, auto: !auto });
  const chooseSeed = (seed: Hex | null) => change({ ...pref, seed });
  /** "Moving background": stored as `still` only when turned off */
  const toggleStill = () => change({ ...pref, still: !pref.still });
  /** "Left-handed mode" for mobile reachability */
  const toggleLeftHanded = () => change({ ...pref, leftHanded: !pref.leftHanded });
  /** Offered where the painted theme has an ambient light at all */
  const movingOffered = $derived(resolved.fx.bg > 0 && !fxOff());
  const lessMotion = typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const chooseSeed2 = (seed2: Hex) => change({ ...pref, seed2 });
  const toggleGradient = () =>
    change({
      ...pref,
      gradient: !pref.gradient,
      seed2: pref.seed2 ?? SEEDS.find((s) => s.id === "sky")!.hex,
    });

  function customColour(e: Event, which: "seed" | "seed2") {
    const value = (e.target as HTMLInputElement).value.toUpperCase();
    if (!isHex(value)) return;
    if (which === "seed") chooseSeed(value);
    else chooseSeed2(value);
  }

  /** A swatch's ring: the background that colour would give this theme */
  const ringOf = (hex: Hex) =>
    preset.tint === "dark" ? dark(hex).ground : light(hex, preset.tp).ground;

  /** The mini mock of a card: the selected card shows the current colours */
  const mockOf = (id: PresetId) =>
    id === pref.themeId && !auto
      ? resolved
      : resolveTheme({ themeId: id, seed: null, gradient: false, seed2: null });

  /** Sets a theme's CSS variables on an element (CSSOM, allowed by the CSP) */
  function themed(node: HTMLElement, vars: Record<string, string>) {
    const apply = (v: Record<string, string>) => {
      for (const [name, value] of Object.entries(v)) {
        node.style.setProperty(name, value);
      }
    };
    apply(vars);
    return { update: apply };
  }

  /** Keeps every control inside `node` out of the tab order, as it changes */
  function untabbable(node: HTMLElement) {
    const sel = "button, input, select, textarea, a[href], [tabindex]";
    const apply = () => {
      for (const el of node.querySelectorAll<HTMLElement>(sel)) {
        if (el.getAttribute("tabindex") !== "-1") el.setAttribute("tabindex", "-1");
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["tabindex"],
    });
    return { destroy: () => observer.disconnect() };
  }

  // The preview's own answers: never saved
  type Tab = "body" | "choices" | "strength" | "word";
  let tab = $state<Tab>("body");
  let locations = $state<string[]>(["chest"]);
  let qualities = $state<string[]>(["warmth"]);
  let strength = $state(6);
  let word = $state<string | null>(null);
  const TABS: Array<{ id: Tab; key: MessageKey; title: MessageKey }> = [
    { id: "body", key: "settings.appearance.preview.body", title: "checkin.step.1.title" },
    { id: "choices", key: "settings.appearance.preview.choices", title: "checkin.step.2.title" },
    { id: "strength", key: "settings.appearance.preview.strength", title: "checkin.step.3.title" },
    { id: "word", key: "settings.appearance.preview.word", title: "checkin.step.6.title" },
  ];
  /** Open on a deep link to `/settings#appearance`, else one row */
  let open = $state(typeof location !== "undefined" && location.hash === "#appearance");

  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
</script>

<section class="settings-section" id="appearance">
  <h2 class="section-header" id="appearance-header">{t("settings.appearance.header")}</h2>
  <!-- Collapsed to one row, "Calm · Original ›", expanding inline: a theme is
       chosen once, so it no longer pushes Reminders down (ui.md §11, §13) -->
  <div class="settings-card">
    <button
      type="button"
      class="settings-row disclosure"
      aria-expanded={open}
      aria-controls="appearance-body"
      onclick={() => (open = !open)}
    >
      <span class="current">{current}</span>
      <svg class="chevron" class:open viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </button>
  </div>

  <div class="body" id="appearance-body" hidden={!open}>

  <!-- 1a. Opt-in: Calm by day, Dusk at night (UX-26; off by default, D4) -->
  <div class="settings-card auto-card">
    <div class="gradient-row">
      <span id="auto-label">{t("settings.appearance.auto")}</span>
      <Switch checked={auto} labelledby="auto-label" describedby="auto-hint" onclick={toggleAuto} />
    </div>
    <p class="hint" id="auto-hint">{t("settings.appearance.auto.hint")}</p>
  </div>

  <!-- 2. Live preview -->
  <div class="settings-card preview-card" aria-label={t("settings.appearance.preview.aria")} role="group">
    <div class="tabs seg" role="tablist">
      <span
        class="seg-puck"
        style:--n={TABS.length}
        style:--i={TABS.findIndex((x) => x.id === tab)}
        aria-hidden="true"
      ></span>
      {#each TABS as item (item.id)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          class:on={tab === item.id}
          onclick={() => (tab = item.id)}
        >
          {t(item.key)}
        </button>
      {/each}
    </div>
    <div class="phone-frame">
      <!-- A picture of the form at 50 %: taps work, but assistive technology
           and the keyboard use the real form instead of these small targets -->
      <div class="phone" aria-hidden="true" use:themed={themeCss(resolved)} use:untabbable>
        <div class="phone-progress" aria-hidden="true">
          {#each Array(9) as _, i (i)}
            <span class:done={i < (tab === "body" ? 1 : tab === "choices" ? 2 : tab === "strength" ? 3 : 6)}></span>
          {/each}
        </div>
        <h3 class="phone-title">{t(TABS.find((x) => x.id === tab)!.title)}</h3>
        <div class="phone-body">
          {#if tab === "body"}
            <BodyMap
              {locations}
              labelOf={(k) => BODY_ZONES.find((z) => z.key === k)?.label[locale] ?? k}
              ontoggle={(k) => (locations = toggle(locations, k))}
            />
          {:else if tab === "choices"}
            <OptionGrid
              ariaLabel={t("checkin.step.2.title")}
              options={QUALITIES.slice(0, 8).map((q) => ({ key: q.key, label: q.label[locale] }))}
              selected={(k) => qualities.includes(k)}
              ontoggle={(k) => (qualities = toggle(qualities, k))}
            />
          {:else if tab === "strength"}
            <Slider
              min={0}
              max={10}
              value={strength}
              touched={true}
              ariaLabel={t("checkin.step.3.title")}
              poleLow={t("checkin.step.3.pole.low")}
              poleHigh={t("checkin.step.3.pole.high")}
              oninput={(v) => (strength = v)}
            />
          {:else}
            <OptionGrid
              ariaLabel={t("checkin.step.6.title")}
              options={WORDS.map((w) => ({ key: w.key, label: w.label[locale] }))}
              selected={(k) => word === k}
              ontoggle={(k) => (word = word === k ? null : k)}
            />
          {/if}
        </div>
        <div class="phone-next" aria-hidden="true">{t("common.next")}</div>
      </div>
    </div>
  </div>

  <!-- 3. The presets -->
  <div class="grid" role="radiogroup" aria-label={t("settings.appearance.themes.aria")}>
    {#each PRESET_IDS as id (id)}
      {@const mock = mockOf(id)}
      <button
        type="button"
        role="radio"
        aria-checked={!auto && pref.themeId === id}
        class="card"
        class:on={!auto && pref.themeId === id}
        onclick={() => chooseTheme(id)}
      >
        <span class="mock" aria-hidden="true" use:themed={themeCss(mock)}>
          <span class="mock-heading"></span>
          <span class="mock-chips">
            <span class="mock-chip on"></span>
            <span class="mock-chip"></span>
          </span>
          <span class="mock-button"></span>
          {#if !auto && pref.themeId === id}<span class="check">✓</span>{/if}
        </span>
        <span class="name">{nameOf(id)}</span>
        <span class="desc">{t(`settings.appearance.theme.${id}.desc` as MessageKey)}</span>
      </button>
    {/each}
  </div>

  {#if tintable && !auto}
    <!-- 4–5. Base colour and gradient -->
    <div class="settings-card colours">
      <h3 class="card-title" id="base-colour">{t("settings.appearance.baseColour.title")}</h3>
      <div class="swatches" role="radiogroup" aria-labelledby="base-colour">
        <button
          type="button"
          role="radio"
          aria-checked={pref.seed === null}
          aria-label={t("settings.appearance.swatch.original")}
          class="swatch"
          class:on={pref.seed === null}
          style:--ring={preset.c.ground}
          style:--seed={preset.c.accent}
          onclick={() => chooseSeed(null)}
        >
          <span class="dot"></span>
          <span class="orig">{t("settings.appearance.swatch.original.short")}</span>
        </button>
        {#each SEEDS as seed (seed.id)}
          <button
            type="button"
            role="radio"
            aria-checked={pref.seed === seed.hex}
            aria-label={t(`settings.appearance.swatch.${seed.id}` as MessageKey)}
            class="swatch"
            class:on={pref.seed === seed.hex}
            style:--ring={ringOf(seed.hex)}
            style:--seed={seed.hex}
            onclick={() => chooseSeed(seed.hex)}
          >
            <span class="dot"></span>
          </button>
        {/each}
        <label class="custom" class:on={pref.seed !== null && !SEEDS.some((s) => s.hex === pref.seed)}>
          <input
            type="color"
            value={(pref.seed ?? preset.c.accent).toLowerCase()}
            onchange={(e) => customColour(e, "seed")}
          />
          {t("settings.appearance.swatch.custom")}
        </label>
      </div>

      <div class="rule"></div>

      <div class="gradient-row">
        <span id="gradient-label">{t("settings.appearance.gradient.title")}</span>
        <Switch checked={pref.gradient} labelledby="gradient-label" onclick={toggleGradient} />
      </div>
      {#if pref.gradient}
        <p class="hint" id="second-colour">{t("settings.appearance.gradient.hint")}</p>
        <div class="swatches" role="radiogroup" aria-labelledby="second-colour">
          {#each SEEDS as seed (seed.id)}
            <button
              type="button"
              role="radio"
              aria-checked={pref.seed2 === seed.hex}
              aria-label={t(`settings.appearance.swatch.${seed.id}` as MessageKey)}
              class="swatch"
              class:on={pref.seed2 === seed.hex}
              style:--ring={ringOf(seed.hex)}
              style:--seed={seed.hex}
              onclick={() => chooseSeed2(seed.hex)}
            >
              <span class="dot"></span>
            </button>
          {/each}
          <label class="custom" class:on={pref.seed2 !== null && !SEEDS.some((s) => s.hex === pref.seed2)}>
            <input
              type="color"
              value={(pref.seed2 ?? "#2563A8").toLowerCase()}
              onchange={(e) => customColour(e, "seed2")}
            />
            {t("settings.appearance.swatch.custom")}
          </label>
        </div>
        <div
          class="gradient-bar"
          role="img"
          aria-label={t("settings.appearance.gradient.preview.aria")}
          style:--from={resolved.c.ground}
          style:--to={resolved.c.ground2 ?? resolved.c.ground}
        ></div>
      {/if}
    </div>
  {:else}
    <p class="settings-note">{t("settings.appearance.fixedPalette", { name: nameOf(pref.themeId) })}</p>
  {/if}

  <!-- 5a. The ambient light behind Home and sign-in: moving or still -->
  {#if movingOffered}
    <div class="settings-card auto-card">
      <div class="gradient-row">
        <span id="moving-label">{t("settings.appearance.moving")}</span>
        <Switch
          checked={!pref.still}
          labelledby="moving-label"
          describedby="moving-hint"
          onclick={toggleStill}
        />
      </div>
      <p class="hint" id="moving-hint">
        {lessMotion ? t("settings.appearance.moving.reduced") : t("settings.appearance.moving.hint")}
      </p>
    </div>
  {/if}

  <!-- 5b. Left-handed mode for mobile reachability -->
  <div class="settings-card auto-card">
    <div class="gradient-row">
      <span id="lefthanded-label">{t("settings.appearance.leftHanded")}</span>
      <Switch
        checked={!!pref.leftHanded}
        labelledby="lefthanded-label"
        describedby="lefthanded-hint"
        onclick={toggleLeftHanded}
      />
    </div>
    <p class="hint" id="lefthanded-hint">
      {t("settings.appearance.leftHanded.hint")}
    </p>
  </div>

  <!-- 6. Status: only when something is wrong (a custom colour too low in
       contrast); "Readable" alone was an orphan line (ui.md §13) -->
  <p class="status" class:bad={!status.readable} aria-live="polite">
    {#if !status.readable}
      {t("settings.appearance.status.lowContrast", {
        pairs: status.bad.map((p) => (PAIR_KEYS[p] ? t(PAIR_KEYS[p]) : p)).join(", "),
      })}
    {/if}
  </p>
  </div>
</section>

<style>
  .current {
    font-size: 0.9375rem;
    color: var(--c-ink, #1e2a26);
  }

  /* 2. Preview */
  .preview-card {
    padding: 14px 12px;
    border-radius: 16px;
    gap: 12px;
  }

  /* The shared segmented control (fx.css), its puck sliding */
  .tabs button {
    font-size: 0.875rem;
  }

  .phone-frame {
    width: 195px;
    height: 422px;
    margin: 0 auto;
    overflow: hidden;
    border-radius: 18px;
    box-shadow: 0 0 0 1px var(--c-line, #b3bdb7), var(--fx-lift-2);
  }

  /* The real screen at 390×844, scaled to 50 % */
  .phone {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 390px;
    height: 844px;
    padding: 22px 24px;
    box-sizing: border-box;
    transform: scale(0.5);
    transform-origin: top left;
    background: var(--c-page, var(--c-ground));
    color: var(--c-ink);
    font-family: var(--font-ui);
  }

  .phone-progress {
    display: flex;
    gap: 4px;
  }

  .phone-progress span {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--c-track);
  }

  .phone-progress span.done {
    background: var(--c-accent);
  }

  .phone-title {
    margin: 8px 0 0;
    font-family: var(--font-display);
    font-weight: var(--display-weight);
    font-size: 30px;
    line-height: 1.1;
    letter-spacing: -0.015em;
  }

  .phone-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .phone-next {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 56px;
    border-radius: var(--r-control);
    background: var(--c-primary);
    color: var(--c-on-primary);
    font-size: 16px;
    font-weight: 600;
  }

  /* 3. Presets */
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  /* Theme cards: a lit rim at rest; chosen = 2 px ink, lifted, checked */
  .card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 8px 8px 10px;
    border: 2px solid transparent;
    border-radius: min(var(--r-card, 14px), 18px);
    background: var(--c-surface, #ffffff);
    box-shadow: var(--fx-rim), var(--fx-lift-1), var(--fx-edge-line);
    color: var(--c-ink, #1e2a26);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--dur-2) var(--ease-standard),
      box-shadow var(--dur-3) var(--ease-out),
      scale var(--dur-spring) var(--ease-spring);
  }

  .card:active {
    scale: 0.985;
    transition-duration: var(--dur-1);
    transition-timing-function: var(--ease-out);
  }

  .card.on {
    border-color: var(--c-ink, #1e2a26);
    box-shadow: var(--fx-rim), var(--fx-lift-2);
  }

  .mock {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 76px;
    padding: 10px;
    box-sizing: border-box;
    border-radius: 10px;
    background: var(--c-page, var(--c-ground));
  }

  .mock-heading {
    width: 62%;
    height: 7px;
    border-radius: 4px;
    background: var(--c-ink);
  }

  .mock-chips {
    display: flex;
    gap: 6px;
  }

  .mock-chip {
    width: 24px;
    height: 14px;
    border-radius: 4px;
    background: var(--c-surface);
    box-shadow: inset 0 0 0 1px var(--c-line);
  }

  .mock-chip.on {
    width: 30px;
    background: var(--c-choice);
    box-shadow: none;
  }

  .mock-button {
    height: 12px;
    border-radius: 4px;
    background: var(--c-primary);
  }

  .check {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--c-ink);
    color: var(--c-ground);
    font-size: 13px;
  }

  .name {
    margin-top: 4px;
    font-size: 15px;
    font-weight: 600;
  }

  .desc {
    font-size: 12px;
    color: var(--c-muted, #4e5853);
  }

  /* 4–5. Colours */
  .colours {
    gap: 12px;
    padding: 14px;
  }

  .card-title {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    /* Room under each row for the "orig" caption */
    gap: 18px 8px;
  }

  .swatch {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1.5px solid transparent;
    border-radius: 50%;
    background: var(--ring);
    cursor: pointer;
  }

  .swatch .dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--seed);
  }

  .swatch.on {
    border-color: #ffffff;
    box-shadow: 0 0 0 2.5px var(--c-figure-sel, #4f46e5);
  }

  .orig {
    position: absolute;
    bottom: -14px;
    font-size: 10px;
    color: var(--c-muted, #4e5853);
  }

  .custom {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 12px 0 6px;
    border: 1.5px solid var(--c-line, #b3bdb7);
    border-radius: 999px;
    font-size: 14px;
    cursor: pointer;
  }

  .custom.on {
    border-color: var(--c-ink, #1e2a26);
  }

  .custom input {
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }

  .rule {
    height: 1px;
    background: var(--c-line, #b3bdb7);
  }

  .auto-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 1rem 0.75rem;
  }

  .gradient-row {
    gap: 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
  }

  .hint {
    margin: 0;
    font-size: 14px;
    color: var(--c-muted, #4e5853);
  }

  .gradient-bar {
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(90deg, var(--from), var(--to));
  }

  /* 6. Status */
  .disclosure {
    width: 100%;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .disclosure:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: -3px;
    border-radius: var(--r-card, 16px);
  }

  .chevron {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--c-muted, #5c6670);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 200ms var(--ease-out);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .body[hidden] {
    display: none;
  }

  .status {
    margin: 0;
    font-size: 13px;
    color: var(--c-muted, #4e5853);
  }

  .status.bad {
    font-weight: 600;
    color: var(--c-ink, #312e81);
  }

  .card:focus-visible,
  .swatch:focus-visible,
  .custom:focus-within {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }
</style>
