// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stop-phrases of the note validator: "why" — causes, meanings and
 * self-evaluating questions — not facts and not hedges (methodology.md §2.10:
 * the abstract mode, "why is this happening to me", is the harmful one;
 * "maybe", "I think" are tentativeness, which belongs to a guess). The union of
 * all three languages applies whatever the interface language; the lists grow
 * only through code. A typographic apostrophe matches a plain one.
 * Specification: ui.md §8.2.
 */

export const STOP_PHRASES: string[] = [
  // ru: causes and meanings, then "why" questions
  "потому что",
  "значит",
  "из-за",
  "поэтому",
  "это значит",
  "почему",
  "зачем",
  "что со мной не так",
  // uk
  "тому що",
  "бо",
  "значить",
  "через те що",
  "це означає",
  "чому",
  "навіщо",
  "що зі мною не так",
  // en
  "because",
  "means",
  "due to",
  "that's why",
  "this means",
  "why",
  "what's wrong with me",
  "what is wrong with me",
];
