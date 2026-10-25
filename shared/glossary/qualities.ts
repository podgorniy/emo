// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Descriptions of step 2, QUALITIES, every non-retired key in dictionary
 * order. Drafts pending the owner's review; the writing rules are in
 * `shared/glossary.ts`.
 */
import type { Description } from "../glossary.ts";

export const QUALITY_TEXT: Record<string, Description> = {
  heaviness: {
    text: {
      en:
        "The place seems weighed down, as if under a load, and harder to lift or shift.",
      ru:
        "Будто место налилось весом и клонится вниз, как под грузом; его труднее сдвинуть.",
      uk:
        "Ніби місце налилося вагою й хилиться донизу, як під вантажем; його важче зрушити.",
    },
    review: "pending",
  },
  lightness: {
    text: {
      en:
        "As if there is less weight: the place seems weightless, easy to lift or shift. The opposite of “heavy”.",
      ru:
        "Будто веса стало меньше: место кажется невесомым, его легко сдвинуть или приподнять. Противоположность «тяжести».",
      uk:
        "Ніби ваги поменшало: місце здається невагомим, його легко зрушити чи підняти. Протилежність «важкості».",
    },
    review: "pending",
  },
  squeeze: {
    text: {
      en:
        "The place seems squeezed or drawn in, narrower. Near it is “tense”: there the muscles themselves are holding, at the ready. Both can be there at once.",
      ru:
        "Место будто стягивают или сдавливают, оно становится уже. Рядом — «напряжение»: там скорее сами мышцы держат, наготове. Бывает и то и другое сразу.",
      uk:
        "Місце ніби стягують або здавлюють, воно стає вужчим. Поруч — «напруга»: там радше самі м'язи тримають, напоготові. Буває й те, й інше водночас.",
    },
    review: "pending",
  },
  expansion: {
    text: {
      en:
        "As if something presses out from inside and there is too little room, like an overfilled balloon. The reverse of “tight”, which draws in.",
      ru:
        "Будто изнутри давит наружу и места не хватает, как в туго надутом шаре. Обратное «сжатию», которое стягивает внутрь.",
      uk:
        "Ніби зсередини тисне назовні й місця бракує, як у туго надутій кульці. Протилежне «стисненню», яке стягує всередину.",
    },
    review: "pending",
  },
  lump: {
    text: {
      en: "As if something dense and round is stuck inside and does not shift.",
      ru: "Будто внутри застрял плотный округлый комок и не сдвигается.",
      uk: "Ніби всередині застрягло щось щільне й кругле і не зсувається.",
    },
    review: "pending",
  },
  warmth: {
    text: {
      en:
        "A mild, even heat, as from sunlight or a heat pad. Near it is “hot”: hotter and sharper.",
      ru:
        "Мягкий ровный нагрев, как от солнца или грелки. Рядом — «жар»: он горячее и резче.",
      uk:
        "М'яке рівне нагрівання, як від сонця чи грілки. Поруч — «жар»: він гарячіший і різкіший.",
    },
    review: "pending",
  },
  heat: {
    text: {
      en:
        "A thick, glowing heat, as near a stove; hotter than “warm”, and it may come in a wave.",
      ru:
        "Плотный горячий нагрев, как у печки; горячее, чем «тепло», и может накатывать волной.",
      uk:
        "Щільне гаряче нагрівання, як біля печі; гарячіше, ніж «тепло», і може накочувати хвилею.",
    },
    review: "pending",
  },
  cold: {
    text: {
      en:
        "As if the place has cooled, as from a draught or cool water; there may be a chill.",
      ru:
        "Будто место остыло, как от сквозняка или прохладной воды; может пробирать зябкость.",
      uk:
        "Ніби місце охололо, як від протягу чи прохолодної води; може морозити.",
    },
    review: "pending",
  },
  trembling: {
    text: {
      en:
        "Small, quick oscillations, like a vibration; they may or may not show from outside. Near it is “pulsing”: there, an even rhythm of beats.",
      ru:
        "Мелкие частые колебания, как вибрация; со стороны их может быть видно, а может и нет. Рядом — «пульсация»: там ровный ритм толчков.",
      uk:
        "Дрібні часті коливання, як вібрація; збоку їх може бути видно, а може й ні. Поруч — «пульсація»: там рівний ритм поштовхів.",
    },
    review: "pending",
  },
  tingling: {
    text: {
      en:
        "Tiny pinpoint pricks, like pins and needles or soda bubbles. Near it is “tickly”: more a faint brushing along the surface.",
      ru:
        "Мелкие точечные уколы, будто иголочки или пузырьки газировки. Рядом — «щекотно»: там скорее лёгкое скольжение по поверхности.",
      uk:
        "Дрібні точкові поколи, ніби голочки чи бульбашки газованої води. Поруч — «лоскотно»: там радше легке ковзання по поверхні.",
    },
    review: "pending",
  },
  pulsing: {
    text: {
      en:
        "Rhythmic beats or throbs at an even pace, like a metronome. Near it is “trembling”: smaller oscillations with no rhythm.",
      ru:
        "Ритмичные толчки в ровном темпе, как метроном. Рядом — «дрожь»: там колебания мельче и без ритма.",
      uk:
        "Ритмічні поштовхи в рівному темпі, як метроном. Поруч — «тремтіння»: там коливання дрібніші й без ритму.",
    },
    review: "pending",
  },
  numbness: {
    text: {
      en:
        "The place seems muted: touch comes through faintly or not at all. Not the same as “nothing”: here the muting itself is noticed.",
      ru:
        "Место будто приглушено: прикосновение доходит слабо или не доходит совсем. Это не «ничего»: здесь заметна сама приглушённость.",
      uk:
        "Місце ніби приглушене: дотик доходить слабко або не доходить зовсім. Це не «нічого»: тут помітна сама приглушеність.",
    },
    review: "pending",
  },
  emptiness: {
    text: {
      en:
        "As if there is a cavity in that place, like a vessel without contents: the walls can be sensed, the middle is unfilled.",
      ru:
        "Будто на этом месте полость, как в сосуде без содержимого: стенки ощутимы, середина не заполнена.",
      uk:
        "Ніби на цьому місці порожнина, як у посудині без вмісту: стінки відчутні, середина не заповнена.",
    },
    review: "pending",
  },
  nausea: {
    text: {
      en:
        "Unsettled and swaying inside, as on a rocking boat; it may come in waves.",
      ru:
        "Муторно и зыбко внутри, как при качке на лодке; может подкатывать волнами.",
      uk:
        "Каламутно й хитко всередині, як під час хитавиці на човні; може накочувати хвилями.",
    },
    review: "pending",
  },
  tension: {
    text: {
      en:
        "The muscles seem to be holding, at the ready, not letting go. Near it is “tight”: there the place itself is drawn in, narrower.",
      ru:
        "Мышцы будто держат, наготове, не отпускают. Рядом — «сжатие»: там скорее само место стянуто и сужено.",
      uk:
        "М'язи ніби тримають, напоготові, не відпускають. Поруч — «стиснення»: там радше саме місце стягнуте й звужене.",
    },
    review: "pending",
  },
  relaxation: {
    text: {
      en:
        "The muscles seem to have let go and gone soft, with no holding. The opposite of “tense”.",
      ru:
        "Мышцы будто отпустили и обмякли, ничто их не держит. Противоположность «напряжению».",
      uk:
        "М'язи ніби відпустили й обм'якли, ніщо їх не тримає. Протилежність «напрузі».",
    },
    review: "pending",
  },
  aching: {
    text: {
      en:
        "A dull, lingering sensation without sharpness that stays and does not let go. Near it is “pulling”: more a direction, as if something is drawn out.",
      ru:
        "Тупое, затяжное ощущение без резкости, которое держится и не отпускает. Рядом — «тянет»: там скорее направление, будто что-то вытягивают.",
      uk:
        "Тупе, затяжне відчуття без різкості, яке тримається й не відпускає. Поруч — «тягне»: там радше напрямок, ніби щось витягують.",
    },
    review: "pending",
  },
  pulling: {
    text: {
      en:
        "As if the place is drawn out in one direction, like a stretched thread or elastic. Near it is “aching”: dull, with no direction.",
      ru:
        "Будто место вытягивают в одну сторону, как натянутую нить или резинку. Рядом — «ноет»: там тупо и без направления.",
      uk:
        "Ніби місце витягують в один бік, як натягнуту нитку чи гумку. Поруч — «ниє»: там тупо й без напрямку.",
    },
    review: "pending",
  },
  tickling: {
    text: {
      en:
        "A faint, quick brushing along the surface, as if with a feather. Near it is “tingling”: more like pinpoint pricks.",
      ru:
        "Лёгкое быстрое касание по поверхности, будто пёрышком. Рядом — «покалывание»: там скорее точечные уколы.",
      uk:
        "Легкий швидкий дотик по поверхні, ніби пір'їнкою. Поруч — «поколювання»: там радше точкові поколи.",
    },
    review: "pending",
  },
  spaciousness: {
    text: {
      en:
        "As if there is plenty of room and air inside, with no crowding. Near it is “pressing outward”: there, too little room.",
      ru:
        "Будто внутри много места и воздуха, ничто не теснит. Рядом — «распирание»: там места, наоборот, мало.",
      uk:
        "Ніби всередині багато місця й повітря, ніщо не тисне. Поруч — «розпирання»: там місця, навпаки, мало.",
    },
    review: "pending",
  },
  steadiness: {
    text: {
      en:
        "As if there is firm support underneath: solid, even, not swaying. Near it is “heavy”: more a weight that drags down.",
      ru:
        "Будто под вами надёжная опора: прочно, ровно, не качает. Рядом — «тяжесть»: там скорее вес, который клонит вниз.",
      uk:
        "Ніби під вами надійна опора: міцно, рівно, не хитає. Поруч — «важкість»: там радше вага, що хилить донизу.",
    },
    review: "pending",
  },
  nothing: {
    text: {
      en:
        "No sensation stands out right now. An observation in its own right, and not the same as “can't tell”.",
      ru:
        "Сейчас никакое ощущение не выделяется. Это наблюдение наравне с любым другим; оно не то же самое, что «не могу определить».",
      uk:
        "Зараз жодне відчуття не виділяється. Це спостереження нарівні з будь-яким іншим; воно не те саме, що «не можу визначити».",
    },
    review: "pending",
  },
  cant_tell: {
    text: {
      en:
        "It is unclear what is there, or whether anything is. A full answer, and not the same as “nothing”.",
      ru:
        "Непонятно, что там и заметно ли там что-то вообще. Это полноценный ответ, и он не то же самое, что «ничего».",
      uk:
        "Незрозуміло, що там і чи помітно там щось узагалі. Це повноцінна відповідь, і вона не те саме, що «нічого».",
    },
    review: "pending",
  },
};
