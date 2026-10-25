// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Descriptions of step 6's certainty, WORD_CONFIDENCE, in dictionary order.
 * Drafts pending the owner's review; the writing rules are in
 * `shared/glossary.ts`.
 */
import type { Description } from "../glossary.ts";

export const CONFIDENCE_TEXT: Record<
  "guess" | "sure" | "unknown",
  Description
> = {
  guess: {
    text: {
      en: "The word is an attempt: it may fit. A guess is a full answer.",
      ru:
        "Слово как попытка: может быть, подходит. Догадка — полноценный ответ.",
      uk: "Слово як спроба: можливо, пасує. Здогад — повноцінна відповідь.",
    },
    review: "pending",
  },
  sure: {
    text: {
      en:
        "The word fits, and right now there is no doubt about it. Compared with “guessing”: not an attempt but recognition.",
      ru:
        "Слово подходит, и сомнений в этом сейчас нет. По сравнению с «угадываю» — не попытка, а узнавание.",
      uk:
        "Слово пасує, і сумнівів у цьому зараз немає. Порівняно з «вгадую» — не спроба, а впізнавання.",
    },
    review: "pending",
  },
  unknown: {
    text: {
      en:
        "A word is chosen, but whether it fits is unclear. A full answer, and not the same as “don't know”: there, no word comes.",
      ru:
        "Слово выбрано, но подходит ли оно — неясно. Это полноценный ответ, и он не то же самое, что «не знаю»: там слова нет.",
      uk:
        "Слово вибране, але чи пасує воно — незрозуміло. Це повноцінна відповідь, і вона не те саме, що «не знаю»: там слова немає.",
    },
    review: "pending",
  },
};
