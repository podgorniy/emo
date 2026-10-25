// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Release gates: skipped in everyday runs, required by `make release-check`
 * (EMO_RELEASE=1), which the release job of CI runs before it builds.
 */
import { assertEquals } from "@std/assert";
import { pendingReview } from "./dictionaries.ts";
import { glossaryPendingReview } from "./glossary.ts";

Deno.test({
  name:
    "release - no dictionary label is still a draft (architecture.md §11.4)",
  ignore: Deno.env.get("EMO_RELEASE") !== "1",
  fn() {
    assertEquals(pendingReview(), []);
  },
});

Deno.test({
  name: "release - no glossary description is still a draft (data.md §5)",
  ignore: Deno.env.get("EMO_RELEASE") !== "1",
  fn() {
    assertEquals(glossaryPendingReview(), []);
  },
});
