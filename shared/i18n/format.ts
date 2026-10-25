// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * i18n formatter and translation lookup over all three languages (server,
 * tests). The client loads one language at a time through `interpolate.ts`.
 */

import type { MessageKey } from "./keys.ts";
import {
  fill,
  PLURAL_BASES,
  type PluralBase,
  pluralKey,
} from "./interpolate.ts";
import { uiEn } from "./ui.en.ts";
import { uiRu } from "./ui.ru.ts";
import { uiUk } from "./ui.uk.ts";
import type { Locale } from "../dictionaries.ts";

export { PLURAL_BASES, type PluralBase };

export const UI_DICTIONARIES: Record<Locale, Record<MessageKey, string>> = {
  en: uiEn,
  ru: uiRu,
  uk: uiUk,
};

/** Translates a key for a given locale, with optional parameter replacement {param}. */
export function t(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return fill(UI_DICTIONARIES[locale], key, params);
}

/** The form `Intl.PluralRules` picks for `n`; `{n}` is always available. */
export function tPlural(
  locale: Locale,
  base: PluralBase,
  n: number,
  params?: Record<string, string | number>,
): string {
  return t(locale, pluralKey(locale, base, n), { n, ...params });
}
