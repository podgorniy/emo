// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Descriptions of the four slider scales, steps 3, 4, 5 and 8: what each asks
 * and its two ends, in step order. Drafts pending the owner's review; the
 * writing rules are in `shared/glossary.ts`.
 */
import type { Description } from "../glossary.ts";

export const SCALE_TEXT: Record<
  "intensity" | "valence" | "arousal" | "head_mode",
  Description
> = {
  intensity: {
    text: {
      en:
        "How strong what you marked is: that sensation itself, not how much it matters. From “barely there” to “very strong”.",
      ru:
        "Насколько сильно то, что вы отметили: само это ощущение, а не то, насколько оно важно. От «едва заметно» до «очень сильно».",
      uk:
        "Наскільки сильне те, що ви позначили: саме це відчуття, а не те, наскільки воно важливе. Від «ледь помітно» до «дуже сильно».",
    },
    review: "pending",
  },
  valence: {
    text: {
      en:
        "The state as a whole, right now: does it lean unpleasant or pleasant, and how far. It is not a verdict on whether it is good or bad to be like this.",
      ru:
        "Состояние в целом, прямо сейчас: ближе к неприятному или к приятному, и насколько. Это не оценка того, хорошо или плохо, что сейчас так.",
      uk:
        "Стан загалом, саме зараз: ближче до неприємного чи до приємного, і наскільки. Це не оцінка того, добре чи погано, що зараз так.",
    },
    review: "pending",
  },
  arousal: {
    text: {
      en:
        "How much energy and speed there is in the body as a whole, from “low charge, slowed down” to “high charge, revved up”. Whether that is pleasant is a separate question; this one is only about charge.",
      ru:
        "Сколько энергии и скорости в теле в целом: от «заряда мало, всё замедлено» до «заряда много, всё ускорено». Приятно это или нет — отдельный вопрос; здесь только заряд.",
      uk:
        "Скільки енергії та швидкості в тілі загалом: від «заряду мало, усе сповільнено» до «заряду багато, усе прискорено». Приємно це чи ні — окреме питання; тут лише заряд.",
    },
    review: "pending",
  },
  head_mode: {
    text: {
      en:
        "Where your attention was just before you opened Emo: on sensations and movement, “here, in the body”, or on thoughts, plans and inner conversations, “in my head, in thoughts”. Neither end is better than the other.",
      ru:
        "Где было внимание прямо перед тем, как вы открыли Emo: на ощущениях и движении, «здесь, в теле», или на мыслях, планах и разговорах про себя, «в голове, в мыслях». Ни один из краёв не лучше другого.",
      uk:
        "Де була увага прямо перед тим, як ви відкрили Emo: на відчуттях і русі, «тут, у тілі», чи на думках, планах і розмовах подумки, «у голові, у думках». Жоден із країв не кращий за інший.",
    },
    review: "pending",
  },
};
