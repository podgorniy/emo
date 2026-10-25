// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Descriptions of the two non-spatial options of step 1, BODY_ZONES
 * `whole_body` and `nowhere`, in dictionary order. The 14 spatial zones have
 * none: the figure defines them (ui.md §6.5). Drafts pending the
 * owner's review; the writing rules are in `shared/glossary.ts`.
 */
import type { Description } from "../glossary.ts";

export const ZONE_TEXT: Record<"whole_body" | "nowhere", Description> = {
  whole_body: {
    text: {
      en:
        "The sensation takes in the body as a whole rather than one place or a few. Near it is “nowhere”: there, no place is noticed.",
      ru:
        "Ощущение охватывает тело целиком, а не одно или несколько мест. Рядом — «нигде»: там не заметно ни одного места.",
      uk:
        "Відчуття охоплює тіло цілком, а не одне чи кілька місць. Поруч — «ніде»: там не помітно жодного місця.",
    },
    review: "pending",
  },
  nowhere: {
    text: {
      en:
        "No place in the body stands out right now. A full answer, not a gap.",
      ru:
        "Сейчас в теле не заметно ни одного места. Это полноценный ответ, а не пропуск.",
      uk:
        "Зараз у тілі не помітно жодного місця. Це повноцінна відповідь, а не пропуск.",
    },
    review: "pending",
  },
};
