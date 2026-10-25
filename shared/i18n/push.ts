// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Push notification copy, picked by `accounts.locale` on the server.
 * The title is fixed by the spec; there is no body text.
 * Specification: architecture.md §9.2, copy.md §2.1.
 */

import type { Locale } from "../dictionaries.ts";
import { UI_DICTIONARIES } from "./format.ts";

export function pushTitle(locale: Locale): string {
  return UI_DICTIONARIES[locale]["push.title"];
}

export function pushBody(locale: Locale): string {
  return UI_DICTIONARIES[locale]["push.body"];
}
