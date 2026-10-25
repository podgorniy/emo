// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The pane registry (ui.md §2.2): Home is a row of panes —
 * Check-in · History · Settings, input → list → settings (owner decision
 * 2026-10-09) — and a future module is one more entry here, not a change to
 * Home: Reports goes after History, Settings stays last. Phones show the
 * panes as dots and swipes, desktops as tabs; each has a route. A swipe or
 * ←/→ steps to the neighbour; a dot, a tab, the wordmark's long press and a
 * pane's back control jump straight to their target, so Home ↔ Settings
 * never mounts or decrypts History (ui.md §15.3).
 */
import type { Component } from "svelte";
import type { MessageKey } from "../../../shared/i18n/keys.ts";

export type PaneId = "home" | "settings" | "history";

export interface PaneModule {
  id: PaneId;
  /** Position in the row of panes */
  order: number;
  /** The dot's aria-label and the desktop tab's text */
  labelKey: MessageKey;
  path: string;
  /** Loaded on first use (Home is in the shell) */
  load?: () => Promise<{ default: Component<never> }>;
  enabled(): boolean;
}

export const PANES: PaneModule[] = [
  {
    id: "home",
    order: 0,
    labelKey: "home.pane.home",
    path: "/",
    enabled: () => true,
  },
  // Past check-ins, next to Home: loaded on first open, never prefetched,
  // and only a deliberate swipe or ←/→ passes it (ui.md §15.3)
  {
    id: "history",
    order: 1,
    labelKey: "home.pane.history",
    path: "/history",
    load: () =>
      import("../components/history/History.svelte") as Promise<
        { default: Component<never> }
      >,
    enabled: () => true,
  },
  // Always last: a future Reports pane takes order 2 and Settings moves on
  {
    id: "settings",
    order: 2,
    labelKey: "home.pane.settings",
    path: "/settings",
    load: () =>
      import("../components/settings/Settings.svelte") as Promise<
        { default: Component<never> }
      >,
    enabled: () => true,
  },
];

export function enabledPanes(): PaneModule[] {
  return PANES.filter((p) => p.enabled()).sort((a, b) => a.order - b.order);
}

/** The pane after (`+1`) or before (`-1`) `id`, if there is one. */
export function neighbourPane(id: PaneId, step: 1 | -1): PaneModule | null {
  const panes = enabledPanes();
  const i = panes.findIndex((p) => p.id === id);
  return panes[i + step] ?? null;
}
