// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The two emails, in the account's language: the sign-in code and the
 * recovery key. Plain text, no links; `{instance}` is the hostname only, so
 * mail clients do not get a URL to follow.
 * Specification: copy.md §2.1, architecture.md §5.6, §11.2.
 */

import type { Locale } from "../dictionaries.ts";
import { t } from "./format.ts";

export interface MailText {
  subject: string;
  text: string;
}

export function loginCodeMail(
  locale: Locale,
  code: string,
  instance: string,
): MailText {
  return {
    subject: t(locale, "mail.code.subject", { code }),
    text: t(locale, "mail.code.body", { code, instance }),
  };
}

/** `renewed`: the key replaces an earlier one, so older emails stop working. */
export function recoveryKeyMail(
  locale: Locale,
  key: string,
  instance: string,
  renewed: boolean,
): MailText {
  const body = t(locale, "mail.recovery.body", { key, instance });
  return {
    subject: t(locale, "mail.recovery.subject"),
    text: renewed ? `${body}\n\n${t(locale, "mail.recovery.renewed")}` : body,
  };
}
