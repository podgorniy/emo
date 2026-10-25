// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Descriptions of step 9, CONTEXT_TAGS (situations), every non-retired key in
 * dictionary order. Each ends with the same tie rule ("If several fit, choose
 * the closest"). Drafts pending the owner's review; the writing rules are in
 * `shared/glossary.ts`.
 */
import type { Description } from "../glossary.ts";

export const CONTEXT_TEXT: Record<string, Description> = {
  work: {
    text: {
      en:
        "A job or study, tasks and duties, at a workplace or anywhere else. If several fit, choose the closest.",
      ru:
        "Учёба или работа, дела и задачи — на рабочем месте или где угодно. Если подходит несколько вариантов, выберите самый близкий.",
      uk:
        "Навчання, робота, справи й завдання — на робочому місці чи будь-де. Якщо підходить кілька варіантів, виберіть найближчий.",
    },
    review: "pending",
  },
  people: {
    text: {
      en:
        "Others are part of the moment: nearby, on a call or in a chat. If several fit, choose the closest.",
      ru:
        "Другие люди — часть момента: рядом, на звонке или в переписке. Если подходит несколько вариантов, выберите самый близкий.",
      uk:
        "Інші люди — частина моменту: поруч, на дзвінку чи в листуванні. Якщо підходить кілька варіантів, виберіть найближчий.",
    },
    review: "pending",
  },
  alone: {
    text: {
      en:
        "No one else is around or in touch with you right now. If several fit, choose the closest.",
      ru:
        "Рядом никого нет, и ни с кем нет связи прямо сейчас. Если подходит несколько вариантов, выберите самый близкий.",
      uk:
        "Поруч нікого немає, і ні з ким немає зв'язку саме зараз. Якщо підходить кілька варіантів, виберіть найближчий.",
    },
    review: "pending",
  },
  food: {
    text: {
      en:
        "A meal, a snack or a drink, or getting one ready. If several fit, choose the closest.",
      ru:
        "Приём пищи, перекус или питьё, а также их приготовление. Если подходит несколько вариантов, выберите самый близкий.",
      uk:
        "Прийом їжі, перекус чи пиття, а також їх приготування. Якщо підходить кілька варіантів, виберіть найближчий.",
    },
    review: "pending",
  },
  commute: {
    text: {
      en:
        "In transit: on foot, on public transport or driving. If several fit, choose the closest.",
      ru:
        "В пути: пешком, в транспорте или за рулём. Если подходит несколько вариантов, выберите самый близкий.",
      uk:
        "У дорозі: пішки, у транспорті чи за кермом. Якщо підходить кілька варіантів, виберіть найближчий.",
    },
    review: "pending",
  },
  home: {
    text: {
      en:
        "At your place: with chores, or at rest. If several fit, choose the closest.",
      ru:
        "Дома, у себя: за домашними делами или на отдыхе. Если подходит несколько вариантов, выберите самый близкий.",
      uk:
        "Удома, у себе: за хатніми справами чи на відпочинку. Якщо підходить кілька варіантів, виберіть найближчий.",
    },
    review: "pending",
  },
  screen: {
    text: {
      en:
        "Attention on a display: a phone, a computer, a TV, a feed or a video. If several fit, choose the closest.",
      ru:
        "Внимание на экране: телефон, компьютер, телевизор, лента или видео. Если подходит несколько вариантов, выберите самый близкий.",
      uk:
        "Увага на екрані: телефон, комп'ютер, телевізор, стрічка чи відео. Якщо підходить кілька варіантів, виберіть найближчий.",
    },
    review: "pending",
  },
  body_sport: {
    text: {
      en:
        "Doing something with the body: exercise, a walk, stretching, a shower or self-care. If several fit, choose the closest.",
      ru:
        "Занятие телом: тренировка, прогулка, растяжка, душ или уход за собой. Если подходит несколько вариантов, выберите самый близкий.",
      uk:
        "Заняття тілом: тренування, прогулянка, розтяжка, душ чи догляд за собою. Якщо підходить кілька варіантів, виберіть найближчий.",
    },
    review: "pending",
  },
  sleep: {
    text: {
      en:
        "Shortly before falling asleep or soon after waking, including at night. If several fit, choose the closest.",
      ru:
        "Незадолго до сна или вскоре после пробуждения, в том числе ночью. Если подходит несколько вариантов, выберите самый близкий.",
      uk:
        "Незадовго до сну або невдовзі після пробудження, зокрема вночі. Якщо підходить кілька варіантів, виберіть найближчий.",
    },
    review: "pending",
  },
  other: {
    text: {
      en:
        "The situation is not among the options; a word or two can go in the field below, if you like.",
      ru:
        "Ситуации нет среди вариантов; при желании можно добавить слово-два в поле ниже.",
      uk:
        "Ситуації немає серед варіантів; за бажанням можна додати слово-два в полі нижче.",
    },
    review: "pending",
  },
};
