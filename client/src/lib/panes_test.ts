// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §15.3: the row of panes is Check-in · History ·
 * Settings (owner decision 2026-10-09); Settings is last.
 */
import { assertEquals } from "@std/assert";
import { enabledPanes, neighbourPane } from "./panes.ts";

Deno.test("panes - Check-in · History · Settings, each with its route", () => {
  assertEquals(
    enabledPanes().map((p) => [p.id, p.path, p.labelKey]),
    [
      ["home", "/", "home.pane.home"],
      ["history", "/history", "home.pane.history"],
      ["settings", "/settings", "home.pane.settings"],
    ],
  );
  assertEquals(neighbourPane("home", 1)?.id, "history");
  assertEquals(neighbourPane("home", -1), null);
  assertEquals(neighbourPane("history", 1)?.id, "settings");
  assertEquals(neighbourPane("history", -1)?.id, "home");
  assertEquals(neighbourPane("settings", -1)?.id, "history");
  assertEquals(neighbourPane("settings", 1), null);
});
