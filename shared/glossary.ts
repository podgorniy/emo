// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Descriptions of every term and scale a check-in offers, keyed by dictionary
 * key: shown one tap away on steps 2–9 and in Settings → Words
 * (ui.md §6.5, §11.9). A description sits inside the
 * measurement (methodology.md §5.4), so its rules are tested
 * (copy.md §8.3, `glossary_test.ts`): one or two sentences without the
 * term's own label; no causes, meanings, norms, frequency, coaching or clinical
 * words; near words told apart by object, time, direction and spread, never by
 * a body zone, the scales of steps 3–5 or another step's labels; null answers
 * are full answers. The Russian key defines the meaning (data.md §5).
 * Every text is a draft (`review: "pending"`) until the owner's review; a
 * release with any left fails (`shared/release_test.ts`). Shell code never
 * imports this module statically: it is a lazy chunk, loaded through
 * `client/src/lib/help.ts` (performance.md §1.1).
 */
import type { Locale, Review } from "./dictionaries.ts";
import { ZONE_TEXT } from "./glossary/zones.ts";
import { QUALITY_TEXT } from "./glossary/qualities.ts";
import { SCALE_TEXT } from "./glossary/scales.ts";
import { WORD_TEXT } from "./glossary/words.ts";
import { CONFIDENCE_TEXT } from "./glossary/confidence.ts";
import { URGE_TEXT } from "./glossary/urges.ts";
import { CONTEXT_TEXT } from "./glossary/context.ts";

/**
 * A reviewed exception to the cross-step label rule (R7): `label`, from
 * another measurement step, may appear in this description's `locale` text.
 */
export interface CrossLabel {
  locale: Locale;
  label: string;
  reason: string;
}

/** One term's or scale's description in every language. */
export interface Description {
  text: Record<Locale, string>;
  review?: Review;
  allow?: CrossLabel[];
}

/** The four slider scales: steps 3, 4, 5 and 8. */
export type ScaleId = "intensity" | "valence" | "arousal" | "head_mode";

export const SCALE_DESCRIPTIONS: Record<ScaleId, Description> = SCALE_TEXT;

/**
 * The term descriptions per dictionary. WORDS holds both levels: `fear` and
 * `fear.anxiety`. BODY_ZONES holds only `whole_body` and `nowhere`.
 */
export const TERM_DESCRIPTIONS = {
  BODY_ZONES: ZONE_TEXT,
  QUALITIES: QUALITY_TEXT,
  WORDS: WORD_TEXT,
  WORD_CONFIDENCE: CONFIDENCE_TEXT,
  URGES: URGE_TEXT,
  CONTEXT_TAGS: CONTEXT_TEXT,
} satisfies Record<string, Record<string, Description>>;

export type TermGroupId = keyof typeof TERM_DESCRIPTIONS;

/**
 * Every description still marked for review, as `GROUP.key` paths
 * ("QUALITIES.squeeze", "WORDS.fear.anxiety", "SCALES.valence"), like
 * `pendingReview()` for the dictionary labels.
 */
export function glossaryPendingReview(): string[] {
  const out: string[] = [];
  for (const [id, d] of Object.entries(SCALE_DESCRIPTIONS)) {
    if (d.review) out.push(`SCALES.${id}`);
  }
  for (const [group, record] of Object.entries(TERM_DESCRIPTIONS)) {
    for (
      const [key, d] of Object.entries(record as Record<string, Description>)
    ) {
      if (d.review) out.push(`${group}.${key}`);
    }
  }
  return out;
}
