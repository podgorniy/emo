// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The reactive face of `i18n.ts` for components: `t()` and `tn()` read a
 * `$state` locale, so every string on screen follows a language change at
 * once, without a reload (ui.md §11.4, architecture.md §11.3).
 */

import type { PluralBase } from "../../../shared/i18n/interpolate.ts";
import type { MessageKey } from "../../../shared/i18n/keys.ts";
import type { Locale } from "../../../shared/protocol.ts";
import * as plain from "./i18n.ts";

export { LOCALES, setLocale } from "./i18n.ts";

const state = $state({ locale: plain.getLocale() });
plain.onLocaleChange((locale) => {
  state.locale = locale;
});

/** The current language, tracked by the component that reads it. */
export function getLocale(): Locale {
  return state.locale;
}

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  void state.locale;
  return plain.t(key, params);
}

export function tn(
  base: PluralBase,
  n: number,
  params?: Record<string, string | number>,
): string {
  void state.locale;
  return plain.tn(base, n, params);
}
