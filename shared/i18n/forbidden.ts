// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Forbidden words test list and validator.
 * Methodology rule: whole-word forbidden in any UI, push, or mail string.
 * Specification: copy.md §8.2, methodology.md.
 */

export const FORBIDDEN_WORDS = [
  // en
  "mood",
  "moods",
  "emotion",
  "emotions",
  "emotional",
  "feeling",
  "feelings",

  // ru
  "настроение",
  "настроения",
  "настроением",
  "настроении",
  "эмоция",
  "эмоции",
  "эмоций",
  "эмоциям",
  "эмоциями",
  "эмоциях",
  "эмоциональный",
  "эмоциональное",
  "эмоциональная",
  "эмоциональные",
  "чувство",
  "чувства",
  "чувств",
  "чувствам",
  "чувствами",
  "чувствах",

  // uk
  "настрій",
  "настрою",
  "настроєм",
  "настрої",
  "емоція",
  "емоції",
  "емоцій",
  "емоціям",
  "емоціями",
  "емоціях",
  "емоційний",
  "емоційне",
  "емоційна",
  "емоційні",
  "почуття",
  "почуттів",
  "почуттям",
  "почуттями",
  "почуттях",
];

const FORBIDDEN_REGEX = new RegExp(
  "(?<![\\p{L}'’])(" +
    FORBIDDEN_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
      "|",
    ) + ")(?![\\p{L}'’])",
  "iu",
);

export function findForbiddenWord(text: string): string | null {
  const match = text.match(FORBIDDEN_REGEX);
  return match ? match[0] : null;
}
