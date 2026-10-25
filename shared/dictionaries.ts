// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shared dictionaries for Emo (Body Log).
 * Single source of truth for dictionary keys, categories, and en/ru/uk labels.
 * Specification: data.md §5, §5.
 */

export const SCHEMA_V = 2;

export type Locale = "en" | "ru" | "uk";

/**
 * `pending`: the uk label is a draft (data.md §5.8). These labels
 * are a measurement instrument, so the owner of the data spec reviews each for
 * meaning against ru, then removes the marker; a release with any left fails
 * (`shared/release_test.ts`, architecture.md §11.4).
 */
export type Review = "pending";

/**
 * `retired`: no longer offered for new input, still valid in old entries and
 * listed in the export's dictionary (data.md §8.2). Keys are never
 * renamed or deleted: add a new one and retire the old.
 */
export interface DictItem<K extends string = string> {
  key: K;
  label: Record<Locale, string>;
  review?: Review;
  retired?: boolean;
}

/** The items a check-in offers: everything not retired, in order. */
export function forInput<T extends DictItem>(items: readonly T[]): T[] {
  return items.filter((item) => !item.retired);
}

export interface QualityItem extends DictItem {
  group: "pressure" | "temperature" | "movement" | "tone" | "none";
}

export type WordL2Item = DictItem;

export interface WordL1Item extends DictItem {
  l2: WordL2Item[];
}

// 8.1 BODY_ZONES
export const BODY_ZONES: DictItem[] = [
  {
    key: "forehead_eyes",
    label: { en: "forehead / eyes", ru: "лоб/глаза", uk: "лоб/очі" },
    review: "pending",
  },
  {
    key: "jaw",
    label: { en: "jaw", ru: "челюсть", uk: "щелепа" },
    review: "pending",
  },
  // 2026-10-09 (UX-25): the back view's head had no zone
  {
    key: "head_back",
    label: { en: "back of the head", ru: "затылок", uk: "потилиця" },
    review: "pending",
  },
  {
    key: "throat",
    label: { en: "throat", ru: "горло", uk: "горло" },
    review: "pending",
  },
  {
    key: "neck",
    label: { en: "neck", ru: "шея", uk: "шия" },
    review: "pending",
  },
  {
    key: "shoulders",
    label: { en: "shoulders", ru: "плечи", uk: "плечі" },
    review: "pending",
  },
  {
    key: "chest",
    label: { en: "chest", ru: "грудь", uk: "груди" },
    review: "pending",
  },
  {
    key: "solar_plexus",
    label: {
      en: "solar plexus",
      ru: "солнечное сплетение",
      uk: "сонячне сплетіння",
    },
    review: "pending",
  },
  {
    key: "belly",
    label: { en: "belly", ru: "живот", uk: "живіт" },
    review: "pending",
  },
  {
    key: "lower_belly",
    label: { en: "lower belly", ru: "низ живота", uk: "низ живота" },
    review: "pending",
  },
  {
    key: "lower_back",
    label: { en: "lower back", ru: "поясница", uk: "поперек" },
    review: "pending",
  },
  {
    key: "upper_back",
    label: { en: "upper back", ru: "спина (верх)", uk: "спина (верх)" },
    review: "pending",
  },
  {
    key: "arms_hands",
    label: { en: "arms / hands", ru: "руки/кисти", uk: "руки/кисті" },
    review: "pending",
  },
  {
    key: "legs_feet",
    label: { en: "legs / feet", ru: "ноги/стопы", uk: "ноги/стопи" },
    review: "pending",
  },
  {
    key: "whole_body",
    label: { en: "whole body", ru: "всё тело", uk: "усе тіло" },
    review: "pending",
  },
  {
    key: "nowhere",
    label: { en: "nowhere", ru: "нигде", uk: "ніде" },
    review: "pending",
  },
];

export const QUALITY_GROUPS: Record<
  QualityItem["group"],
  Record<Locale, string>
> = {
  pressure: {
    en: "Pressure & weight",
    ru: "Давление и вес",
    uk: "Тиск і вага",
  },
  temperature: { en: "Temperature", ru: "Температура", uk: "Температура" },
  movement: { en: "Movement", ru: "Движение", uk: "Рух" },
  tone: { en: "Tone", ru: "Тонус", uk: "Тонус" },
  none: { en: "Or", ru: "Или", uk: "Або" },
};

/** The group headers' uk drafts (data.md §5.8), as for `review`. */
export const QUALITY_GROUPS_REVIEW: Partial<
  Record<QualityItem["group"], Review>
> = {
  pressure: "pending",
  temperature: "pending",
  movement: "pending",
  tone: "pending",
  none: "pending",
};

/** Every label still marked for review, as `dictionary.key` paths. */
export function pendingReview(): string[] {
  const out: string[] = [];
  const items = (name: string, list: DictItem[]) => {
    for (const item of list) {
      if (item.review) out.push(`${name}.${item.key}`);
    }
  };
  items("BODY_ZONES", BODY_ZONES);
  items("QUALITIES", QUALITIES);
  for (const l1 of WORDS) {
    items("WORDS", [l1]);
    items(`WORDS.${l1.key}`, l1.l2);
  }
  items("WORD_CONFIDENCE", WORD_CONFIDENCE);
  items("URGES", URGES);
  items("CONTEXT_TAGS", CONTEXT_TAGS);
  for (const [group, review] of Object.entries(QUALITY_GROUPS_REVIEW)) {
    if (review) out.push(`QUALITY_GROUPS.${group}`);
  }
  return out;
}

// 8.2 QUALITIES
export const QUALITIES: QualityItem[] = [
  {
    key: "heaviness",
    label: { en: "heavy", ru: "тяжесть", uk: "важкість" },
    review: "pending",
    group: "pressure",
  },
  {
    key: "lightness",
    label: { en: "light", ru: "лёгкость", uk: "легкість" },
    review: "pending",
    group: "pressure",
  },
  {
    key: "squeeze",
    label: { en: "tight", ru: "сжатие", uk: "стиснення" },
    review: "pending",
    group: "pressure",
  },
  {
    key: "expansion",
    label: { en: "pressing outward", ru: "распирание", uk: "розпирання" },
    review: "pending",
    group: "pressure",
  },
  {
    key: "lump",
    label: { en: "lump", ru: "ком", uk: "клубок" },
    review: "pending",
    group: "pressure",
  },
  {
    key: "warmth",
    label: { en: "warm", ru: "тепло", uk: "тепло" },
    review: "pending",
    group: "temperature",
  },
  {
    key: "heat",
    label: { en: "hot", ru: "жар", uk: "жар" },
    review: "pending",
    group: "temperature",
  },
  {
    key: "cold",
    label: { en: "cold", ru: "холод", uk: "холод" },
    review: "pending",
    group: "temperature",
  },
  {
    key: "trembling",
    label: { en: "trembling", ru: "дрожь", uk: "тремтіння" },
    review: "pending",
    group: "movement",
  },
  {
    key: "tingling",
    label: { en: "tingling", ru: "покалывание", uk: "поколювання" },
    review: "pending",
    group: "movement",
  },
  {
    key: "pulsing",
    label: { en: "pulsing", ru: "пульсация", uk: "пульсація" },
    review: "pending",
    group: "movement",
  },
  {
    key: "numbness",
    label: { en: "numb", ru: "онемение", uk: "оніміння" },
    review: "pending",
    group: "tone",
  },
  {
    key: "emptiness",
    label: { en: "hollow", ru: "пустота", uk: "порожнеча" },
    review: "pending",
    group: "tone",
  },
  {
    key: "nausea",
    label: { en: "queasy", ru: "тошнота", uk: "нудота" },
    review: "pending",
    group: "tone",
  },
  {
    key: "tension",
    label: { en: "tense", ru: "напряжение", uk: "напруга" },
    review: "pending",
    group: "tone",
  },
  {
    key: "relaxation",
    label: { en: "relaxed", ru: "расслабление", uk: "розслаблення" },
    review: "pending",
    group: "tone",
  },
  {
    key: "aching",
    label: { en: "aching", ru: "ноет", uk: "ниє" },
    review: "pending",
    group: "movement",
  },
  {
    key: "pulling",
    label: { en: "pulling", ru: "тянет", uk: "тягне" },
    review: "pending",
    group: "movement",
  },
  {
    key: "tickling",
    label: { en: "tickly", ru: "щекотно", uk: "лоскотно" },
    review: "pending",
    group: "movement",
  },
  // 2026-10-09 (PSY-13): resource sensations, before the null answers
  {
    key: "spaciousness",
    label: { en: "spacious", ru: "простор", uk: "простір" },
    review: "pending",
    group: "pressure",
  },
  {
    key: "steadiness",
    label: { en: "steady", ru: "устойчивость", uk: "стійкість" },
    review: "pending",
    group: "tone",
  },
  {
    key: "nothing",
    label: { en: "nothing", ru: "ничего", uk: "нічого" },
    review: "pending",
    group: "none",
  },
  {
    key: "cant_tell",
    label: {
      en: "can't tell",
      ru: "не могу определить",
      uk: "не можу визначити",
    },
    review: "pending",
    group: "none",
  },
];

// 8.3 WORDS (Level 1 -> Level 2)
export const WORDS: WordL1Item[] = [
  {
    key: "fear",
    label: { en: "fear", ru: "страх", uk: "страх" },
    review: "pending",
    l2: [
      {
        key: "anxiety",
        label: { en: "anxiety", ru: "тревога", uk: "тривога" },
        review: "pending",
      },
      {
        key: "worry",
        label: { en: "worry", ru: "беспокойство", uk: "занепокоєння" },
        review: "pending",
      },
      {
        key: "wariness",
        label: { en: "wariness", ru: "настороженность", uk: "настороженість" },
        review: "pending",
      },
      {
        key: "tense_waiting",
        label: {
          en: "tense waiting",
          ru: "напряжённое ожидание",
          uk: "напружене очікування",
        },
        review: "pending",
      },
      {
        key: "panic",
        label: { en: "panic", ru: "паника", uk: "паніка" },
        review: "pending",
      },
      {
        key: "terror",
        label: { en: "terror", ru: "ужас", uk: "жах" },
        review: "pending",
      },
      {
        key: "self_consciousness",
        label: { en: "self-consciousness", ru: "стеснение", uk: "скутість" },
        review: "pending",
      },
      {
        key: "insecurity",
        label: { en: "insecurity", ru: "неуверенность", uk: "невпевненість" },
        review: "pending",
      },
    ],
  },
  {
    key: "anger",
    label: { en: "anger", ru: "злость", uk: "злість" },
    review: "pending",
    l2: [
      {
        key: "irritation",
        label: { en: "irritation", ru: "раздражение", uk: "роздратування" },
        review: "pending",
      },
      {
        key: "frustration",
        label: { en: "frustration", ru: "досада", uk: "досада" },
        review: "pending",
      },
      {
        key: "resentment",
        label: { en: "resentment", ru: "обида", uk: "образа" },
        review: "pending",
      },
      {
        key: "indignation",
        label: { en: "indignation", ru: "возмущение", uk: "обурення" },
        review: "pending",
      },
      {
        key: "rage",
        label: { en: "rage", ru: "ярость", uk: "лють" },
        review: "pending",
      },
      {
        key: "disgust",
        label: { en: "disgust", ru: "отвращение", uk: "огида" },
        review: "pending",
      },
      {
        key: "contempt",
        label: { en: "contempt", ru: "презрение", uk: "зневага" },
        review: "pending",
      },
      {
        key: "impatience",
        label: { en: "impatience", ru: "нетерпение", uk: "нетерпіння" },
        review: "pending",
      },
    ],
  },
  {
    key: "sadness",
    label: { en: "sadness", ru: "грусть", uk: "смуток" },
    review: "pending",
    l2: [
      {
        key: "longing",
        label: { en: "longing", ru: "тоска", uk: "туга" },
        review: "pending",
      },
      {
        key: "sorrow",
        label: { en: "sorrow", ru: "печаль", uk: "печаль" },
        review: "pending",
      },
      {
        key: "loneliness",
        label: { en: "loneliness", ru: "одиночество", uk: "самотність" },
        review: "pending",
      },
      {
        key: "disappointment",
        label: {
          en: "disappointment",
          ru: "разочарование",
          uk: "розчарування",
        },
        review: "pending",
      },
      {
        key: "grief",
        label: { en: "grief", ru: "горе", uk: "горе" },
        review: "pending",
      },
      {
        key: "despondency",
        label: { en: "despondency", ru: "уныние", uk: "пригніченість" },
        review: "pending",
      },
      {
        key: "self_pity",
        // The felt state, not a self-judgement (2026-10-09, PSY-14)
        label: { en: "sorry for myself", ru: "жалко себя", uk: "шкода себе" },
        review: "pending",
      },
      {
        key: "helplessness",
        label: { en: "helplessness", ru: "беспомощность", uk: "безпорадність" },
        review: "pending",
      },
    ],
  },
  {
    key: "shame",
    label: { en: "shame", ru: "стыд", uk: "сором" },
    review: "pending",
    l2: [
      {
        key: "awkwardness",
        label: { en: "awkwardness", ru: "неловкость", uk: "ніяковість" },
        review: "pending",
      },
      {
        key: "guilt",
        label: { en: "guilt", ru: "вина", uk: "провина" },
        review: "pending",
      },
      {
        key: "humiliation",
        label: { en: "humiliation", ru: "унижение", uk: "приниження" },
        review: "pending",
      },
      {
        key: "embarrassment",
        label: { en: "embarrassment", ru: "смущение", uk: "збентеження" },
        review: "pending",
      },
      {
        key: "worthlessness",
        label: { en: "worthlessness", ru: "никчёмность", uk: "нікчемність" },
        review: "pending",
      },
    ],
  },
  {
    key: "joy",
    // 2026-10-09 (PSY-13): calm, relief, contentment live here too
    label: {
      en: "joy / ease",
      ru: "радость / покой",
      uk: "радість / легкість",
    },
    review: "pending",
    l2: [
      {
        key: "interest",
        label: { en: "interest", ru: "интерес", uk: "інтерес" },
        review: "pending",
      },
      {
        key: "relief",
        label: { en: "relief", ru: "облегчение", uk: "полегшення" },
        review: "pending",
      },
      {
        key: "calm",
        label: { en: "calm", ru: "спокойствие", uk: "спокій" },
        review: "pending",
      },
      {
        key: "tenderness",
        label: { en: "tenderness", ru: "нежность", uk: "ніжність" },
        review: "pending",
      },
      {
        key: "thrill",
        label: { en: "thrill", ru: "азарт", uk: "азарт" },
        review: "pending",
      },
      {
        key: "gratitude",
        label: { en: "gratitude", ru: "благодарность", uk: "вдячність" },
        review: "pending",
      },
      {
        key: "contentment",
        label: { en: "contentment", ru: "удовлетворение", uk: "задоволення" },
        review: "pending",
      },
      {
        key: "enthusiasm",
        label: { en: "enthusiasm", ru: "воодушевление", uk: "піднесення" },
        review: "pending",
      },
      {
        key: "warmth_to_someone",
        label: {
          en: "warmth toward someone",
          ru: "тепло к кому-то",
          uk: "тепло до когось",
        },
        review: "pending",
      },
      // 2026-10-09 (PSY-13): appended; existing keys keep their meaning
      {
        key: "pride",
        label: { en: "pride", ru: "гордость", uk: "гордість" },
        review: "pending",
      },
      {
        key: "hope",
        label: { en: "hope", ru: "надежда", uk: "надія" },
        review: "pending",
      },
    ],
  },
  {
    key: "surprise",
    label: { en: "surprise", ru: "удивление", uk: "здивування" },
    review: "pending",
    l2: [
      {
        key: "confusion",
        label: { en: "confusion", ru: "замешательство", uk: "замішання" },
        review: "pending",
      },
      {
        key: "bewilderment",
        label: { en: "bewilderment", ru: "растерянность", uk: "розгубленість" },
        review: "pending",
      },
      {
        key: "curiosity",
        label: { en: "curiosity", ru: "любопытство", uk: "цікавість" },
        review: "pending",
      },
      {
        key: "stunned",
        label: { en: "stunned", ru: "оторопь", uk: "ошелешеність" },
        review: "pending",
      },
    ],
  },
  {
    key: "empty",
    label: { en: "empty", ru: "пусто", uk: "порожньо" },
    review: "pending",
    l2: [
      {
        key: "numbness",
        label: { en: "numbness", ru: "онемение", uk: "оніміння" },
        review: "pending",
      },
      {
        key: "boredom",
        label: { en: "boredom", ru: "скука", uk: "нудьга" },
        review: "pending",
      },
      {
        key: "detachment",
        label: {
          en: "detachment",
          ru: "отстранённость",
          uk: "відстороненість",
        },
        review: "pending",
      },
      {
        key: "cotton_wool",
        label: {
          en: "wrapped in cotton wool",
          ru: "как в вате",
          uk: "як у ваті",
        },
        review: "pending",
      },
      {
        key: "nothing",
        label: { en: "nothing", ru: "ничего", uk: "нічого" },
        review: "pending",
      },
      {
        key: "frozen",
        label: { en: "frozen", ru: "оцепенение", uk: "заціпеніння" },
        review: "pending",
      },
    ],
  },
  {
    key: "unknown",
    label: { en: "don't know", ru: "не знаю", uk: "не знаю" },
    review: "pending",
    l2: [],
  },
];

export const WORD_CONFIDENCE: DictItem<"guess" | "sure" | "unknown">[] = [
  {
    key: "guess",
    label: { en: "guessing", ru: "угадываю", uk: "вгадую" },
    review: "pending",
  },
  {
    key: "sure",
    label: { en: "sure", ru: "уверенно", uk: "впевнено" },
    review: "pending",
  },
  {
    key: "unknown",
    // "can't say": not the word step's own "don't know" on the same screen
    label: { en: "can't say", ru: "не могу сказать", uk: "не можу сказати" },
    review: "pending",
  },
];

// 8.4 URGES
export const URGES: DictItem[] = [
  {
    key: "leave",
    label: { en: "leave", ru: "уйти", uk: "піти" },
    review: "pending",
  },
  {
    key: "shrink",
    label: { en: "shrink", ru: "сжаться", uk: "стиснутися" },
    review: "pending",
  },
  {
    key: "freeze",
    label: { en: "freeze", ru: "замереть", uk: "завмерти" },
    review: "pending",
  },
  {
    key: "move",
    label: { en: "move", ru: "двигаться", uk: "рухатися" },
    review: "pending",
  },
  {
    key: "hit",
    label: { en: "hit", ru: "ударить", uk: "вдарити" },
    review: "pending",
  },
  {
    key: "cry",
    label: { en: "cry", ru: "плакать", uk: "плакати" },
    review: "pending",
  },
  {
    key: "shout",
    label: { en: "shout", ru: "кричать", uk: "кричати" },
    review: "pending",
  },
  {
    key: "sleep",
    label: { en: "sleep", ru: "спать", uk: "спати" },
    review: "pending",
  },
  {
    key: "eat",
    label: { en: "eat", ru: "есть", uk: "їсти" },
    review: "pending",
  },
  {
    key: "hug",
    label: {
      en: "hug / hold close",
      ru: "обнять / прижаться",
      uk: "обійняти / пригорнутися",
    },
    review: "pending",
  },
  {
    key: "talk",
    label: { en: "talk", ru: "говорить", uk: "говорити" },
    review: "pending",
  },
  {
    key: "stay_silent",
    label: { en: "stay silent", ru: "молчать", uk: "мовчати" },
    review: "pending",
  },
  {
    key: "nothing",
    label: { en: "nothing", ru: "ничего", uk: "нічого" },
    review: "pending",
  },
];

// 8.5 CONTEXT_TAGS
export const CONTEXT_TAGS: DictItem[] = [
  {
    key: "work",
    label: { en: "work", ru: "работа", uk: "робота" },
    review: "pending",
  },
  {
    key: "people",
    label: { en: "people", ru: "люди", uk: "люди" },
    review: "pending",
  },
  {
    key: "alone",
    // ru «один» is masculine; «наедине» as uk «наодинці» (2026-10-09)
    label: { en: "alone", ru: "наедине", uk: "наодинці" },
    review: "pending",
  },
  {
    key: "food",
    label: { en: "food", ru: "еда", uk: "їжа" },
    review: "pending",
  },
  {
    key: "commute",
    label: { en: "on the way", ru: "дорога", uk: "дорога" },
    review: "pending",
  },
  {
    key: "home",
    label: { en: "home", ru: "дом", uk: "дім" },
    review: "pending",
  },
  {
    key: "screen",
    label: { en: "screen", ru: "экран", uk: "екран" },
    review: "pending",
  },
  {
    key: "body_sport",
    label: { en: "body / sport", ru: "тело/спорт", uk: "тіло/спорт" },
    review: "pending",
  },
  {
    key: "sleep",
    label: {
      en: "sleep (before / after)",
      ru: "сон (перед/после)",
      uk: "сон (перед/після)",
    },
    review: "pending",
  },
  {
    key: "other",
    label: { en: "other", ru: "другое", uk: "інше" },
    review: "pending",
  },
];
