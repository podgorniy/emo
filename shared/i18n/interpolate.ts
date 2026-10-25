// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The formatter without any dictionary, so the client can load one language
 * at a time (performance.md §1.1). `format.ts` binds it to all three
 * for the server and the tests.
 */

import type { MessageKey } from "./keys.ts";
import type { Locale } from "../dictionaries.ts";

export type Messages = Record<MessageKey, string>;

/** Keys with `.one` / `.few` / `.many` / `.other` forms (copy.md §5). */
export type PluralBase =
  | "auth.notifications.body"
  | "auth.switch.entries"
  | "auth.switch.unsynced"
  | "checkin.step.2.summary.chosen"
  | "settings.data.unreadable.corrupt"
  | "settings.data.unreadable.newer"
  | "settings.devices.signOut.discard";

export const PLURAL_BASES: PluralBase[] = [
  "auth.notifications.body",
  "auth.switch.entries",
  "auth.switch.unsynced",
  "settings.data.unreadable.corrupt",
  "settings.data.unreadable.newer",
  "settings.devices.signOut.discard",
];

/**
 * `key` in `messages`, with `{param}`s replaced. No fallback to English
 * (architecture.md §11.3): every key exists in every language (compile-time and
 * i18n_test.ts); a missing one shows its name.
 */
export function fill(
  messages: Messages | undefined,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  let text = messages?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/** The form `Intl.PluralRules` picks for `n` in `locale`. */
export function pluralKey(
  locale: Locale,
  base: PluralBase,
  n: number,
): MessageKey {
  const rule = new Intl.PluralRules(locale).select(n);
  const form = rule === "one" || rule === "few" || rule === "many"
    ? rule
    : "other";
  return `${base}.${form}` as MessageKey;
}
