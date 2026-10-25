// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Descriptions of step 7, URGES, every non-retired key in dictionary order.
 * Every urge but `nothing` ends with the same sentence on what an urge is (a
 * pull, not a plan), so no option reads differently. Drafts pending the
 * owner's review; the writing rules are in `shared/glossary.ts`.
 */
import type { Description } from "../glossary.ts";

export const URGE_TEXT: Record<string, Description> = {
  leave: {
    text: {
      en:
        "A pull to get away and be somewhere else, further from here. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга отдалиться и оказаться где-то в другом месте, подальше отсюда. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга віддалитися й опинитися деінде, подалі звідси. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  shrink: {
    text: {
      en:
        "A pull to become smaller and less visible, to curl up and take up less space. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга стать меньше и незаметнее, свернуться, занять меньше места. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга зменшитися, згорнутися й займати якомога менше місця. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  freeze: {
    text: {
      en:
        "A pull to stop and keep still, as if any movement would be too much. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга остановиться и не шевелиться, будто любое движение лишнее. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга зупинитися й не ворушитися, ніби будь-який рух зайвий. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  move: {
    text: {
      en:
        "A pull to get up, walk about, stretch, do something with the body. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга встать, пройтись, размяться, что-то сделать телом. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга встати, пройтися, розім'ятися, щось зробити тілом. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  hit: {
    text: {
      en:
        "A pull to strike, push or shove something away hard. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга толкнуть, стукнуть или резко оттолкнуть что-то от себя. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга штовхнути, стукнути чи різко відштовхнути щось від себе. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  cry: {
    text: {
      en:
        "A pull to let tears come, as if they are close. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга дать волю слезам, будто они совсем близко. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга дати волю сльозам, ніби вони зовсім близько. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  shout: {
    text: {
      en:
        "A pull to raise your voice or call out loudly. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга громко крикнуть или повысить голос. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга голосно крикнути чи підвищити голос. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  sleep: {
    text: {
      en:
        "A pull to lie down and fall asleep, or at least switch off for a while. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга лечь и уснуть или хотя бы на время отключиться. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга лягти й заснути або хоча б ненадовго вимкнутися. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  eat: {
    text: {
      en:
        "A pull to have a bite of something or to chew on something. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга что-нибудь съесть или пожевать. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга щось з'їсти чи пожувати. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  hug: {
    text: {
      en:
        "A pull toward closeness with someone or something: to wrap around, lean in, nestle. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга к близости с кем-то или чем-то: обхватить, прислониться, прильнуть. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга до близькості з кимось чи чимось: обхопити, прихилитися, притулитися. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  talk: {
    text: {
      en:
        "A pull to speak to someone, to tell or ask something. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга с кем-то заговорить, что-то рассказать или спросить. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга з кимось заговорити, щось розповісти чи запитати. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  stay_silent: {
    text: {
      en:
        "A pull to keep quiet and stay out of any conversation. An urge is a pull, not a plan; noticing it is enough.",
      ru:
        "Тяга не произносить ни слова и держаться в стороне от разговора. Побуждение — это тяга, а не план; достаточно его заметить.",
      uk:
        "Тяга не вимовляти ані слова й триматися осторонь розмови. Спонукання — це тяга, а не план; досить її помітити.",
    },
    review: "pending",
  },
  nothing: {
    text: {
      en: "No pull stands out right now. A full answer, like any other.",
      ru:
        "Сейчас никакой тяги не заметно. Это полноценный ответ, наравне с любым другим.",
      uk:
        "Зараз жодної тяги не помітно. Це повноцінна відповідь, нарівні з будь-якою іншою.",
    },
    review: "pending",
  },
};
