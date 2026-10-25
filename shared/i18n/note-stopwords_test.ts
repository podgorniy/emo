// SPDX-License-Identifier: AGPL-3.0-or-later
/** The corpora of ui.md §8.2; they grow with the lists. */
import { assertEquals } from "@std/assert";
import { findStopPhrase, validateNote } from "../entry.ts";

const MUST_PASS = [
  "15 хвилин тому, кухня",
  "годину тому",
  "п'ять хвилин тому",
  "созвон, кухня, 15 минут",
  "10 minutes ago, kitchen",
  "by the window",
  "кава, балкон",
  // Hedges are tentativeness, not "why" (2026-10-09)
  "maybe 10 people at the standup",
  "it seems flat",
  "I think nothing",
  "probably the coffee",
  "наверное, устал",
  "думаю о дедлайне",
  "кажется что пол качается",
  "мабуть, втома",
  "здається що холодно",
  // Word boundaries: "why", «бо» inside other words
  "lunch on Whyte Avenue",
  "бокс, зал",
  "робота, кухня",
];

const MUST_REJECT = [
  "тому що втомився",
  "бо страшно",
  "потому что опоздал",
  "because I was late",
  // "Why", and self-evaluating questions (2026-10-09)
  "no idea why I feel nothing",
  "why again",
  "what's wrong with me",
  "what’s wrong with me",
  "What is wrong with me",
  "почему мне опять так плохо",
  "зачем я это сделал",
  "что со мной не так",
  "чому мені знову погано",
  "навіщо я це зробив",
  "що зі мною не так",
];

Deno.test("note stop-words - facts and hedges pass", () => {
  for (const note of MUST_PASS) {
    assertEquals(validateNote(note).valid, true, note);
  }
});

Deno.test("note stop-words - explanations and 'why' are rejected", () => {
  for (const note of MUST_REJECT) {
    assertEquals(validateNote(note).error, "stop_phrase_detected", note);
  }
});

Deno.test("note stop-words - the phrase as typed, and where it starts", () => {
  assertEquals(findStopPhrase("call with boss because I was late"), {
    phrase: "because",
    start: 15,
  });
  assertEquals(findStopPhrase("Кухня. Почему опять?"), {
    phrase: "Почему",
    start: 7,
  });
  // The typographic apostrophe is kept in the quote
  assertEquals(
    findStopPhrase("sofa, what’s wrong with me")?.phrase,
    "what’s wrong with me",
  );
  assertEquals(findStopPhrase("sofa, evening"), null);
});
