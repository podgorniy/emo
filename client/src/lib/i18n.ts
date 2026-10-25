// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Client i18n translation store and formatter.
 * Specification: llm/copy.md.
 */

import {
  fill,
  type Messages,
  type PluralBase,
  pluralKey,
} from "../../../shared/i18n/interpolate.ts";
import type { MessageKey } from "../../../shared/i18n/keys.ts";
import { uiEn } from "../../../shared/i18n/ui.en.ts";
import type { Locale } from "../../../shared/protocol.ts";
import { getMeta, setMeta } from "./db.ts";

/**
 * English is in the app shell: the default, and the text of a boot that fails
 * before the language is known. Russian and Ukrainian are lazy chunks, loaded
 * before they are applied (performance.md §1.1).
 */
const loaded: Partial<Record<Locale, Messages>> = { en: uiEn };
const LOADERS: Record<Locale, () => Promise<Messages>> = {
  en: () => Promise.resolve(uiEn),
  ru: () => import("../../../shared/i18n/ui.ru.ts").then((m) => m.uiRu),
  uk: () => import("../../../shared/i18n/ui.uk.ts").then((m) => m.uiUk),
};

async function ensureLoaded(locale: Locale): Promise<void> {
  loaded[locale] ??= await LOADERS[locale]();
}

/** The order of copy.md: English · Українська · Русский. */
export const LOCALES: Array<{ id: Locale; native: string }> = [
  { id: "en", native: "English" },
  { id: "uk", native: "Українська" },
  { id: "ru", native: "Русский" },
];

const SUPPORTED: Locale[] = ["en", "uk", "ru"];
let currentLocale: Locale = "en";
const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
  return currentLocale;
}

/** Components re-render through `i18n.svelte.ts`, which listens here. */
export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(locale: Locale) {
  currentLocale = locale;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  for (const fn of listeners) fn(locale);
}

export async function setLocale(locale: Locale): Promise<void> {
  await ensureLoaded(locale);
  apply(locale);
  await setMeta("locale", locale);
}

/** The first of `navigator.languages` this app speaks; English otherwise
 * (architecture.md §11.3). */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.slice(0, 2).toLowerCase() as Locale;
    if (SUPPORTED.includes(base)) return base;
  }
  return "en";
}

export async function initLocale(): Promise<Locale> {
  const detected = detectLocale(
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
  );
  let stored: Locale | null;
  try {
    stored = await getMeta<Locale>("locale");
  } catch (err) {
    // A damaged database: its screen still speaks the device's language
    await use(detected);
    throw err;
  }
  if (stored && SUPPORTED.includes(stored)) {
    await use(stored);
    return currentLocale;
  }
  await use(detected);
  await setMeta("locale", currentLocale);
  return currentLocale;
}

/** Applies `locale` once its strings are here; English if they cannot load. */
async function use(locale: Locale): Promise<void> {
  try {
    await ensureLoaded(locale);
    apply(locale);
  } catch {
    apply("en");
  }
}

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return fill(loaded[currentLocale], key, params);
}

/** A count-dependent string in the current language (copy.md §5). */
export function tn(
  base: PluralBase,
  n: number,
  params?: Record<string, string | number>,
): string {
  return t(pluralKey(currentLocale, base, n), { n, ...params });
}
