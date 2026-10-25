// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Descriptions of step 6, WORDS: each level-1 key (`fear`) followed by its
 * level-2 keys (`fear.anxiety`), non-retired only, in dictionary order. The
 * Russian key defines the meaning (data.md §5). Drafts pending the
 * owner's review; the writing rules are in `shared/glossary.ts`.
 */
import type { Description } from "../glossary.ts";

export const WORD_TEXT: Record<string, Description> = {
  fear: {
    text: {
      en:
        "A broad word for states of alertness: attention is on something that may happen or is already close. The broad word is enough; the finer words are optional.",
      ru:
        "Общее слово для состояний настороженности: внимание занято тем, что может случиться или уже рядом. Общего слова достаточно; уточнение — по желанию.",
      uk:
        "Загальне слово для станів настороженості: увага зайнята тим, що може статися або вже поруч. Загального слова досить; уточнення — за бажанням.",
    },
    review: "pending",
  },
  "fear.anxiety": {
    text: {
      en:
        "Alertness without a clear object: as if something is about to happen, but not clear what. Compared with “worry”: less about one particular thing, more spread out.",
      ru:
        "Настороженность без ясного предмета: будто что-то вот-вот случится, но что — непонятно. По сравнению с «беспокойством» — меньше про что-то определённое, более разлита.",
      uk:
        "Настороженість без ясного предмета: ніби щось ось-ось станеться, але що — незрозуміло. Порівняно із «занепокоєнням» — менше про щось певне, більш розлита.",
    },
    review: "pending",
  },
  "fear.worry": {
    text: {
      en:
        "Attention keeps returning to a particular thing that might go wrong, going over the options, at times in words. Compared with “anxiety”: the object is clearer.",
      ru:
        "Внимание снова и снова возвращается к чему-то определённому, что может пойти не так: перебирает варианты, иногда словами. По сравнению с «тревогой» — предмет яснее.",
      uk:
        "Увага знову й знову повертається до чогось певного, що може не вдатися: перебирає варіанти, часом словами. Порівняно з «тривогою» — предмет ясніший.",
    },
    review: "pending",
  },
  "fear.wariness": {
    text: {
      en:
        "Attention is on guard, watching something or someone nearby, as if checking whether it is safe. Compared with “anxiety”: it points at what is here and now.",
      ru:
        "Внимание начеку и следит за чем-то или кем-то рядом, будто проверяя, безопасно ли. По сравнению с «тревогой» — направлено на то, что здесь и сейчас.",
      uk:
        "Увага напоготові й стежить за чимось або кимось поруч, ніби перевіряючи, чи безпечно. Порівняно з «тривогою» — спрямована на те, що тут і зараз.",
    },
    review: "pending",
  },
  "fear.tense_waiting": {
    text: {
      en:
        "Attention is fixed on something about to happen: a known event, an answer, a moment. Compared with “anxiety”: it is clear what you are waiting for.",
      ru:
        "Внимание приковано к тому, что вот-вот произойдёт: известному событию, ответу, моменту. По сравнению с «тревогой» — понятно, чего вы ждёте.",
      uk:
        "Увага прикута до того, що ось-ось станеться: відомої події, відповіді, моменту. Порівняно з «тривогою» — зрозуміло, на що ви чекаєте.",
    },
    review: "pending",
  },
  "fear.panic": {
    text: {
      en:
        "Sudden, overwhelming fear: attention darts about and holds on to nothing, as if everything calls for action at once. Compared with “terror”: more rushing about, less going still.",
      ru:
        "Внезапный, захлёстывающий страх: внимание мечется и ни на чём не держится, будто всё требует действовать немедленно. По сравнению с «ужасом» — больше метания, меньше оцепенения.",
      uk:
        "Раптовий, нестримний страх: увага метається й ні за що не тримається, ніби все вимагає діяти негайно. Порівняно з «жахом» — більше метання, менше заціпеніння.",
    },
    review: "pending",
  },
  "fear.terror": {
    text: {
      en:
        "Overwhelming fear of something dreadful that is happening or about to: attention is fixed on it, the rest seems to vanish. Compared with “panic”: more going still, less rushing about.",
      ru:
        "Захлёстывающий страх перед чем-то страшным, что происходит или вот-вот произойдёт: внимание приковано к нему, остальное будто исчезает. По сравнению с «паникой» — больше оцепенения, меньше метания.",
      uk:
        "Нестримний страх перед чимось страшним, що відбувається або ось-ось станеться: увага прикута до нього, решта ніби зникає. Порівняно з «панікою» — більше заціпеніння, менше метання.",
    },
    review: "pending",
  },
  "fear.self_consciousness": {
    text: {
      en:
        "Attention is on how you come across to others, and it constrains: being less noticeable seems easier. Compared with “embarrassment”: more about others' gaze now or ahead than about what happened.",
      ru:
        "Внимание занято тем, как вы выглядите для других, и это сковывает: хочется быть незаметнее. По сравнению со «смущением» — больше про чужой взгляд сейчас или впереди, чем про случившееся.",
      uk:
        "Увага зайнята тим, як вас бачать інші, і це сковує: хочеться, щоб вас менше помічали. Порівняно зі «збентеженням» — більше про чужий погляд зараз або попереду, ніж про те, що сталося.",
    },
    review: "pending",
  },
  "fear.insecurity": {
    text: {
      en:
        "Doubt about yourself or your choice: footing seems shaky, each step forward comes with a look back. Compared with “anxiety”: it is about yourself and what you can do.",
      ru:
        "Сомнение в себе или в своём выборе: опора будто шаткая, шаг вперёд даётся с оглядкой. По сравнению с «тревогой» — направлено на себя и свои возможности.",
      uk:
        "Сумнів у собі або у своєму виборі: опора ніби хитка, крок уперед дається з оглядкою. Порівняно з «тривогою» — спрямований на себе і свої можливості.",
    },
    review: "pending",
  },
  anger: {
    text: {
      en:
        "A broad word for states of being against: attention is on what gets in the way or seems wrong, with a push to resist it. The broad word is enough; the finer words are optional.",
      ru:
        "Общее слово для состояний «против»: внимание направлено на то, что мешает или кажется неправильным, с порывом дать отпор. Общего слова достаточно; уточнение — по желанию.",
      uk:
        "Загальне слово для станів «проти»: увага спрямована на те, що заважає або здається неправильним, з поривом дати відсіч. Загального слова досить; уточнення — за бажанням.",
    },
    review: "pending",
  },
  "anger.irritation": {
    text: {
      en:
        "Attention keeps catching on small things, and each one grates. Compared with “frustration”: not one thwarted aim but many scattered small snags.",
      ru:
        "Внимание то и дело цепляется за мелочи, и каждая задевает. По сравнению с «досадой» — не одна сорванная цель, а много разрозненных мелких помех.",
      uk:
        "Увага раз у раз чіпляється за дрібниці, і кожна зачіпає. Порівняно з «досадою» — не одна зірвана мета, а багато розрізнених дрібних перешкод.",
    },
    review: "pending",
  },
  "anger.frustration": {
    text: {
      en:
        "Something fell through and it grates: a plan, an attempt or an expectation did not work out, and attention returns to it in protest. Compared with “disappointment”: more pushing against, less sinking.",
      ru:
        "Задевает то, что сорвалось: план, попытка или ожидание не сбылись, и внимание возвращается к этому с протестом. По сравнению с «разочарованием» — больше «против», меньше упадка.",
      uk:
        "Зачіпає те, що зірвалося: план, спроба чи очікування не справдилися, і увага повертається до цього з протестом. Порівняно з «розчаруванням» — більше «проти», менше занепаду.",
    },
    review: "pending",
  },
  "anger.resentment": {
    text: {
      en:
        "Hurt by what someone did or did not do toward you: attention goes back to it, sore and unfair. Compared with “indignation”: more about you and the hurt, less about a principle.",
      ru:
        "Задевает чей-то поступок по отношению к вам или то, чего для вас не сделали: внимание возвращается к этому, больно и несправедливо. По сравнению с «возмущением» — больше про себя и про боль, меньше про принцип.",
      uk:
        "Зачіпає чийсь вчинок щодо вас або те, чого для вас не зробили: увага повертається до цього, боляче й несправедливо. Порівняно з «обуренням» — більше про себе й про біль, менше про принцип.",
    },
    review: "pending",
  },
  "anger.indignation": {
    text: {
      en:
        "Protest against something that seems unjust or not to be allowed, done to you or to others. Compared with “resentment”: turned outward, at the act itself or how things are.",
      ru:
        "Протест против того, что кажется несправедливым или недопустимым, — с вами или с другими. По сравнению с «обидой» — направлено вовне, на сам поступок или порядок вещей.",
      uk:
        "Протест проти того, що здається несправедливим чи неприпустимим, — щодо вас або інших. Порівняно з «образою» — спрямоване назовні, на сам вчинок чи лад речей.",
    },
    review: "pending",
  },
  "anger.rage": {
    text: {
      en:
        "Overwhelming anger that is hard to contain: attention narrows to what it is against, with a push to break through everything. Compared with “irritation”: not small pricks but one solid wave.",
      ru:
        "Захлёстывающая злость, которую трудно удержать: внимание сужено до того, против чего она, и порыв прорваться через всё. По сравнению с «раздражением» — не мелкие уколы, а сплошная волна.",
      uk:
        "Нестримна злість, яку важко втримати: увага звужена до того, проти чого вона, і порив прорватися крізь усе. Порівняно з «роздратуванням» — не дрібні уколи, а суцільна хвиля.",
    },
    review: "pending",
  },
  "anger.disgust": {
    text: {
      en:
        "Recoil from something that seems foul or alien: a pull to get away from it, keep it off, not take it in. Compared with “contempt”: closer to revulsion than to looking down.",
      ru:
        "Отталкивание от чего-то, что кажется мерзким или чужеродным: порыв отстраниться, не подпускать, не брать в себя. По сравнению с «презрением» — ближе к брезгливости, чем к взгляду свысока.",
      uk:
        "Відштовхування від чогось, що здається гидким або чужим: порив відсторонитися, не підпускати, не брати в себе. Порівняно зі «зневагою» — ближче до гидливості, ніж до погляду згори.",
    },
    review: "pending",
  },
  "anger.contempt": {
    text: {
      en:
        "Looking down on someone or something as not worth regard: distant and dismissive. Compared with “disgust”: less recoil, more a sense of being above it.",
      ru:
        "Взгляд свысока на кого-то или что-то, как на недостойное внимания: отстранённо и пренебрежительно. По сравнению с «отвращением» — меньше отталкивания, больше превосходства.",
      uk:
        "Погляд згори на когось чи щось, як на негідне уваги: відсторонено й зверхньо. Порівняно з «огидою» — менше відштовхування, більше зверхності.",
    },
    review: "pending",
  },
  "anger.impatience": {
    text: {
      en:
        "Attention strains ahead and waiting is hard: things go less quickly than you would like, with an itch to hurry them. Compared with “tense waiting”: more protest at the delay.",
      ru:
        "Внимание рвётся вперёд, а ждать трудно: всё идёт не так скоро, как хотелось бы, и подмывает поторопить события. По сравнению с «напряжённым ожиданием» — больше протеста против промедления.",
      uk:
        "Увага рветься вперед, а чекати важко: усе йде не так скоро, як хотілося б, і кортить поквапити події. Порівняно з «напруженим очікуванням» — більше протесту проти зволікання.",
    },
    review: "pending",
  },
  sadness: {
    text: {
      en:
        "A broad word for states of loss and lack: attention turns to what is missing or gone, more inward than outward. The broad word is enough; the finer words are optional.",
      ru:
        "Общее слово для состояний утраты и нехватки: внимание обращено к тому, чего нет или не стало, скорее внутрь, чем вовне. Общего слова достаточно; уточнение — по желанию.",
      uk:
        "Загальне слово для станів утрати й нестачі: увага звернена до того, чого немає або не стало, радше всередину, ніж назовні. Загального слова досить; уточнення — за бажанням.",
    },
    review: "pending",
  },
  "sadness.longing": {
    text: {
      en:
        "A pull toward what is out of reach or will not come back, a person, a place, a time; at times with no clear object, spread out. Compared with “sorrow”: more reaching, less acceptance.",
      ru:
        "Тяга к тому, чего нет рядом или уже не вернуть, — к человеку, месту, времени; иногда без ясного предмета, разлитая. По сравнению с «печалью» — больше тяги, меньше смирения.",
      uk:
        "Тяга до того, чого немає поруч або вже не повернути, — до людини, місця, часу; часом без ясного предмета, розлита. Порівняно з «печаллю» — більше тяги, менше змирення.",
    },
    review: "pending",
  },
  "sadness.sorrow": {
    text: {
      en:
        "A quiet sadness about something lost or gone: attention turns to the past, without protest. Compared with “grief”: it does not fill everything, there is room for other things.",
      ru:
        "Тихая грусть о чём-то утраченном или ушедшем: внимание обращено к прошлому, без протеста. По сравнению с «горем» — не заполняет собой всё, оставляет место другому.",
      uk:
        "Тихий смуток за чимось утраченим або минулим: увага звернена до минулого, без протесту. Порівняно з «горем» — не заповнює собою все, лишає місце іншому.",
    },
    review: "pending",
  },
  "sadness.loneliness": {
    text: {
      en:
        "A lack of closeness and connection with others, alone or among people: as if no one sees or hears you.",
      ru:
        "Нехватка близости и связи с другими — и наедине, и среди людей: будто вас не видят и не слышат.",
      uk:
        "Брак близькості й зв'язку з іншими — і наодинці, і серед людей: ніби вас не бачать і не чують.",
    },
    review: "pending",
  },
  "sadness.disappointment": {
    text: {
      en:
        "An expectation or hope has not come true: what you were reaching for turned out otherwise, and attention sinks. Compared with “frustration”: less protest, more sinking.",
      ru:
        "Ожидание или надежда не сбылись: то, к чему было стремление, оказалось не тем, и внимание оседает. По сравнению с «досадой» — меньше протеста, больше упадка.",
      uk:
        "Очікування чи надія не справдилися: те, до чого було прагнення, виявилося не тим, і увага осідає. Порівняно з «досадою» — менше протесту, більше занепаду.",
    },
    review: "pending",
  },
  "sadness.grief": {
    text: {
      en:
        "A great loss that fills everything: attention keeps returning to it, and the world seems different. Compared with “sorrow”: it takes over completely.",
      ru:
        "Большая утрата, которая заполняет собой всё: внимание снова и снова возвращается к ней, и мир будто другой. По сравнению с «печалью» — захватывает целиком.",
      uk:
        "Велика втрата, що заповнює собою все: увага знову й знову повертається до неї, і світ ніби інший. Порівняно з «печаллю» — захоплює цілком.",
    },
    review: "pending",
  },
  "sadness.despondency": {
    text: {
      en:
        "As if everything has gone dull and nothing waits ahead: nothing draws you, nothing seems worth starting. Compared with “sorrow”: less about a loss, more about what lies ahead.",
      ru:
        "Будто всё потускнело и впереди ничего не ждёт: ничто не привлекает, ничего не хочется начинать. По сравнению с «печалью» — меньше про утрату, больше про то, что впереди.",
      uk:
        "Ніби все потьмяніло й попереду нічого не чекає: ніщо не вабить, нічого не хочеться починати. Порівняно з «печаллю» — менше про втрату, більше про те, що попереду.",
    },
    review: "pending",
  },
  "sadness.self_pity": {
    text: {
      en:
        "Sadness turned toward yourself: being sorry for yourself, the way you might be for someone else who is having a hard time.",
      ru:
        "Грусть, обращённая к себе: жаль себя, как бывает жаль другого человека, которому досталось.",
      uk:
        "Смуток, звернений до себе: шкода себе, як буває шкода іншу людину, якій дісталося.",
    },
    review: "pending",
  },
  "sadness.helplessness": {
    text: {
      en:
        "As if nothing can be done or changed: attempts seem useless and all that is left is waiting. Compared with “frustration”: less protest, more coming to a stop.",
      ru:
        "Будто ничего нельзя сделать или изменить: попытки кажутся бесполезными, и остаётся только ждать. По сравнению с «досадой» — меньше протеста, больше остановки.",
      uk:
        "Ніби нічого не можна зробити чи змінити: спроби здаються марними, і лишається тільки чекати. Порівняно з «досадою» — менше протесту, більше зупинки.",
    },
    review: "pending",
  },
  shame: {
    text: {
      en:
        "A broad word for states where attention turns to yourself as if under someone's gaze, or your own, with a pull to hide. The broad word is enough; the finer words are optional.",
      ru:
        "Общее слово для состояний, когда внимание обращено на себя будто под чужим или собственным взглядом, с порывом спрятаться. Общего слова достаточно; уточнение — по желанию.",
      uk:
        "Загальне слово для станів, коли увага звернена на себе ніби під чужим або власним поглядом, з поривом сховатися. Загального слова досить; уточнення — за бажанням.",
    },
    review: "pending",
  },
  "shame.awkwardness": {
    text: {
      en:
        "A hitch in contact or in a situation: it is unclear how to act, and things come out slightly off. Compared with “shame”: about this moment, not about yourself as a whole.",
      ru:
        "Заминка в общении или в ситуации: непонятно, как себя вести, и всё выходит немного не так. По сравнению со «стыдом» — про этот момент, а не про себя целиком.",
      uk:
        "Затинка у спілкуванні чи в ситуації: незрозуміло, як поводитися, і все виходить трохи не так. Порівняно із «соромом» — про цей момент, а не про себе цілком.",
    },
    review: "pending",
  },
  "shame.guilt": {
    text: {
      en:
        "Attention is on something you did or did not do, and on whom or what it affected, with a pull to put it right. Compared with “shame”: about the act, not about yourself.",
      ru:
        "Внимание обращено к тому, что вы сделали или не сделали, и к тому, кого или что это задело, с порывом исправить. По сравнению со «стыдом» — про поступок, а не про себя целиком.",
      uk:
        "Увага звернена до того, що ви зробили чи не зробили, і до того, кого чи що це зачепило, з поривом виправити. Порівняно із «соромом» — про вчинок, а не про себе цілком.",
    },
    review: "pending",
  },
  "shame.humiliation": {
    text: {
      en:
        "Dignity is hurt: as if you are being put below others or held up to ridicule. Compared with “shame”: more about what is done to you than about yourself.",
      ru:
        "Задето достоинство: будто вас ставят ниже других или выставляют на посмешище. По сравнению со «стыдом» — больше про то, что делают с вами, чем про вас самих.",
      uk:
        "Зачеплено гідність: ніби вас ставлять нижче за інших або виставляють на посміх. Порівняно із «соромом» — більше про те, що роблять з вами, ніж про вас самих.",
    },
    review: "pending",
  },
  "shame.embarrassment": {
    text: {
      en:
        "Others' sudden attention on you throws you off and mixes up your thoughts. Compared with “awkwardness”: more about being looked at.",
      ru:
        "Неожиданное внимание других к вам сбивает с толку и путает мысли. По сравнению с «неловкостью» — больше про то, что на вас смотрят.",
      uk:
        "Несподівана увага інших до вас збиває з пантелику й плутає думки. Порівняно з «ніяковістю» — більше про те, що на вас дивляться.",
    },
    review: "pending",
  },
  "shame.worthlessness": {
    text: {
      en:
        "As if you yourself are worth nothing, not for one thing but as a whole. Compared with “guilt”: about yourself, not about an act.",
      ru:
        "Будто вы сами по себе ничего не стоите — не за что-то одно, а целиком. По сравнению с «виной» — про себя, а не про поступок.",
      uk:
        "Ніби ви самі по собі нічого не варті — не за щось одне, а цілком. Порівняно з «провиною» — про себе, а не про вчинок.",
    },
    review: "pending",
  },
  joy: {
    text: {
      en:
        "A broad word for states of gladness, ease or peace: attention can stay where it is, unhurried, or turn toward something gladly. The broad word is enough; the finer words are optional.",
      ru:
        "Общее слово для состояний радости, облегчения или покоя: внимание может оставаться здесь без спешки или с охотой обращаться к чему-то. Общего слова достаточно; уточнение — по желанию.",
      uk:
        "Загальне слово для станів радості, полегшення чи спокою: увага може лишатися тут без поспіху або охоче звертатися до чогось. Загального слова досить; уточнення — за бажанням.",
    },
    review: "pending",
  },
  "joy.interest": {
    text: {
      en:
        "Attention turns toward something by itself and stays with it: wanting to learn, see and understand more. Compared with “curiosity”: more lasting, less restless.",
      ru:
        "Внимание само обращается к чему-то и задерживается на нём: хочется узнать, увидеть, понять больше. По сравнению с «любопытством» — длится дольше, меньше нетерпения.",
      uk:
        "Увага сама звертається до чогось і затримується на ньому: хочеться дізнатися, побачити, зрозуміти більше. Порівняно з «цікавістю» — триває довше, менше нетерпіння.",
    },
    review: "pending",
  },
  "joy.relief": {
    text: {
      en:
        "Something worrying or hard has ended or passed, and attention lets go of it. Compared with “calm”: with a glance back at how it was just before.",
      ru:
        "Что-то тревожное или трудное закончилось или миновало, и внимание его отпускает. По сравнению со «спокойствием» — с оглядкой на то, что только что было иначе.",
      uk:
        "Щось тривожне чи складне скінчилося або минуло, і увага його відпускає. Порівняно зі «спокоєм» — з оглядкою на те, що щойно було інакше.",
    },
    review: "pending",
  },
  "joy.calm": {
    text: {
      en:
        "Nothing hurries or troubles you: attention can stay in the present, with no pull elsewhere. Compared with “relief”: no glance back at what came before.",
      ru:
        "Ничто не торопит и не тревожит: внимание может оставаться в настоящем, без порыва куда-то. По сравнению с «облегчением» — без оглядки на то, что было до.",
      uk:
        "Ніщо не квапить і не тривожить: увага може лишатися в теперішньому, без пориву кудись. Порівняно з «полегшенням» — без оглядки на те, що було раніше.",
    },
    review: "pending",
  },
  "joy.tenderness": {
    text: {
      en:
        "Care toward someone or something: wanting to be gentle and careful, to protect. Compared with “warmth toward someone”: more care, as if before something fragile.",
      ru:
        "Бережность к кому-то или чему-то: хочется быть осторожнее и мягче, защитить. По сравнению с «теплом к кому-то» — больше заботы, будто перед чем-то хрупким.",
      uk:
        "Дбайливість до когось чи чогось: хочеться поводитися обережно й м'яко, захистити. Порівняно з «теплом до когось» — більше турботи, ніби перед чимось крихким.",
    },
    review: "pending",
  },
  "joy.thrill": {
    text: {
      en:
        "Being caught up in a game, a risk or a chase for a result: attention is set on the goal, wanting to keep going and win. Compared with “enthusiasm”: more about contest and risk.",
      ru:
        "Захваченность игрой, риском или погоней за результатом: внимание сосредоточено на цели, хочется продолжать и выиграть. По сравнению с «воодушевлением» — больше про состязание и риск.",
      uk:
        "Захопленість грою, ризиком чи гонитвою за результатом: увага зосереджена на меті, хочеться продовжувати й виграти. Порівняно з «піднесенням» — більше про змагання й ризик.",
    },
    review: "pending",
  },
  "joy.gratitude": {
    text: {
      en:
        "Attention is on what was given to you or done for you, and on whoever it came from, with a pull to give back.",
      ru:
        "Внимание обращено к тому, что вам дали или сделали для вас, и к тем, от кого это пришло, с порывом ответить тем же.",
      uk:
        "Увага звернена до того, що вам дали чи зробили для вас, і до тих, від кого це прийшло, з поривом віддячити.",
    },
    review: "pending",
  },
  "joy.contentment": {
    text: {
      en:
        "Something is done, received or has turned out as you wanted, and it is enough: nothing more is wanted. Compared with “pride”: less about yourself, more about how it came out.",
      ru:
        "Что-то сделано, получено или сложилось так, как хотелось, и этого достаточно: ничего не хочется добавить. По сравнению с «гордостью» — меньше про себя, больше про то, что вышло.",
      uk:
        "Щось зроблено, отримано чи склалося так, як хотілося, і цього досить: нічого не хочеться додати. Порівняно з «гордістю» — менше про себе, більше про те, що вийшло.",
    },
    review: "pending",
  },
  "joy.enthusiasm": {
    text: {
      en:
        "A lift and a pull toward something ahead: a plan, a task or a meeting calls, and you want to take it on. Compared with “thrill”: less about winning, more about the thing itself.",
      ru:
        "Подъём и порыв к чему-то впереди: замысел, дело или встреча зовут, и хочется браться за них. По сравнению с «азартом» — меньше про выигрыш, больше про сам замысел.",
      uk:
        "Підйом і порив до чогось попереду: задум, справа чи зустріч кличуть, і хочеться за них братися. Порівняно з «азартом» — менше про виграш, більше про сам задум.",
    },
    review: "pending",
  },
  "joy.warmth_to_someone": {
    text: {
      en:
        "Goodwill and closeness toward a particular person: wanting to be near, to do them some good. Compared with “tenderness”: less carefulness, more plain fondness.",
      ru:
        "Расположение и близость к определённому человеку: хочется быть рядом, сделать для этого человека что-то доброе. По сравнению с «нежностью» — меньше бережности, больше простой приязни.",
      uk:
        "Прихильність і близькість до певної людини: хочеться бути поруч, зробити для неї щось добре. Порівняно з «ніжністю» — менше дбайливості, більше простої приязні.",
    },
    review: "pending",
  },
  "joy.pride": {
    text: {
      en:
        "Attention is on something that you or someone close to you achieved, and it is seen as worth something. Compared with “contentment”: more about whoever made it happen.",
      ru:
        "Внимание обращено к тому, что удалось вам или кому-то близкому, и в этом видится ценность. По сравнению с «удовлетворением» — больше про того, чья это заслуга.",
      uk:
        "Увага звернена до того, що вдалося вам чи комусь близькому, і в цьому бачиться цінність. Порівняно із «задоволенням» — більше про того, чия це заслуга.",
    },
    review: "pending",
  },
  "joy.hope": {
    text: {
      en:
        "Attention looks ahead to something good that may happen, without certainty but open to it. Compared with “tense waiting”: more expecting good than bracing.",
      ru:
        "Внимание обращено вперёд, к чему-то хорошему, что может случиться, — без уверенности, но с открытостью. По сравнению с «напряжённым ожиданием» — больше ожидания хорошего, чем опаски.",
      uk:
        "Увага звернена вперед, до чогось доброго, що може статися, — без певності, але з відкритістю. Порівняно з «напруженим очікуванням» — більше очікування доброго, ніж побоювання.",
    },
    review: "pending",
  },
  surprise: {
    text: {
      en:
        "A broad word for states where something unexpected stops attention: something is not as expected. The broad word is enough; the finer words are optional.",
      ru:
        "Общее слово для состояний, когда неожиданное останавливает внимание: что-то оказалось не таким, как ждали. Общего слова достаточно; уточнение — по желанию.",
      uk:
        "Загальне слово для станів, коли несподіване зупиняє увагу: щось виявилося не таким, як чекали. Загального слова досить; уточнення — за бажанням.",
    },
    review: "pending",
  },
  "surprise.confusion": {
    text: {
      en:
        "Something unexpected throws you, and for a moment it is unclear what to do next. Compared with “bewilderment”: shorter, about this moment.",
      ru:
        "Неожиданное сбивает, и на миг непонятно, что делать дальше. По сравнению с «растерянностью» — короче, про этот момент.",
      uk:
        "Несподіване збиває, і на мить незрозуміло, що робити далі. Порівняно з «розгубленістю» — коротше, про цей момент.",
    },
    review: "pending",
  },
  "surprise.bewilderment": {
    text: {
      en:
        "Attention scatters, and it is unclear what to take up or which way to turn, as if footing is lost. Compared with “confusion”: longer and wider.",
      ru:
        "Внимание рассыпается, и непонятно, за что взяться и куда повернуть: опора будто потеряна. По сравнению с «замешательством» — дольше и шире.",
      uk:
        "Увага розсипається, і незрозуміло, за що взятися і куди повернути: опора ніби загублена. Порівняно із «замішанням» — довше й ширше.",
    },
    review: "pending",
  },
  "surprise.curiosity": {
    text: {
      en:
        "A pull to find out what lies behind the unknown: the new beckons, and you want to peek in. Compared with “interest”: quicker, more about novelty.",
      ru:
        "Порыв узнать, что там, за неизвестным: новое манит, хочется заглянуть и выяснить. По сравнению с «интересом» — короче и больше про новизну.",
      uk:
        "Порив дізнатися, що там, за невідомим: нове вабить, хочеться зазирнути й з'ясувати. Порівняно з «інтересом» — коротше й більше про новизну.",
    },
    review: "pending",
  },
  "surprise.stunned": {
    text: {
      en:
        "Something unexpected stops everything for a moment: no thoughts, no movement, as if knocked off track. Compared with “frozen”: sudden and brief.",
      ru:
        "Неожиданное на миг останавливает всё: ни мыслей, ни движения, будто выбило из колеи. По сравнению с «оцепенением» — внезапно и коротко.",
      uk:
        "Несподіване на мить зупиняє все: ні думок, ні руху, ніби вибило з колії. Порівняно із «заціпенінням» — раптово й коротко.",
    },
    review: "pending",
  },
  empty: {
    text: {
      en:
        "As if there is little or nothing: flat, muted or far off. A word for a state, not a missing answer. The broad word is enough; the finer words are optional.",
      ru:
        "Будто почти ничего нет: плоско, приглушённо или издалека. Это слово для состояния, а не пропуск ответа. Общего слова достаточно; уточнение — по желанию.",
      uk:
        "Ніби майже нічого немає: пласко, приглушено чи здалеку. Це слово для стану, а не пропуск відповіді. Загального слова досить; уточнення — за бажанням.",
    },
    review: "pending",
  },
  "empty.numbness": {
    text: {
      en:
        "As if everything is muffled and little gets through: things happen close by but barely touch you. Compared with “detachment”: not pushed away but dampened.",
      ru:
        "Будто всё приглушено и мало что доходит: происходящее рядом, но почти не задевает. По сравнению с «отстранённостью» — не отодвинуто, а заглушено.",
      uk:
        "Ніби все приглушене й мало що доходить: те, що відбувається поруч, майже не зачіпає. Порівняно з «відстороненістю» — не відсунуте, а заглушене.",
    },
    review: "pending",
  },
  "empty.boredom": {
    text: {
      en:
        "Nothing holds attention and time seems to stand still: wanting something else, yet nothing appeals. Compared with “despondency”: less about what lies ahead, more about now.",
      ru:
        "Ничто не удерживает внимание, и время будто стоит: хочется чего-то другого, но ничто не привлекает. По сравнению с «унынием» — меньше про то, что впереди, больше про сейчас.",
      uk:
        "Ніщо не втримує увагу, і час ніби стоїть: хочеться чогось іншого, але ніщо не вабить. Порівняно з «пригніченістю» — менше про те, що попереду, більше про зараз.",
    },
    review: "pending",
  },
  "empty.detachment": {
    text: {
      en:
        "As if watching from the side or from far off: things happen, but as if not to you. Compared with “numbness”: not dampened but pushed away.",
      ru:
        "Будто смотрите со стороны или издалека: всё происходит, но как будто не с вами. По сравнению с «онемением» — не заглушено, а отодвинуто.",
      uk:
        "Ніби дивитеся збоку чи здалеку: усе відбувається, але ніби не з вами. Порівняно з «онімінням» — не заглушене, а відсунуте.",
    },
    review: "pending",
  },
  "empty.cotton_wool": {
    text: {
      en:
        "As if everything is wrapped in something soft: sounds, thoughts and contact arrive muffled, through a thick layer. Compared with “numbness”: a muffling around more than within.",
      ru:
        "Будто всё обёрнуто чем-то мягким: звуки, мысли и контакт доходят глухо, сквозь толщу. По сравнению с «онемением» — больше про приглушённость вокруг, чем внутри.",
      uk:
        "Ніби все обгорнуте чимось м'яким: звуки, думки й контакт доходять глухо, крізь товщу. Порівняно з «онімінням» — більше про приглушеність довкола, ніж усередині.",
    },
    review: "pending",
  },
  "empty.nothing": {
    text: {
      en:
        "A word for a state in which nothing noticeable is there right now. A full answer; unlike “don't know”, here a word has been found.",
      ru:
        "Слово для состояния, в котором сейчас ничего заметного нет. Полноценный ответ; в отличие от «не знаю», слово здесь найдено.",
      uk:
        "Слово для стану, у якому зараз нічого помітного немає. Повноцінна відповідь; на відміну від «не знаю», слово тут знайдено.",
    },
    review: "pending",
  },
  "empty.frozen": {
    text: {
      en:
        "As if everything inside has gone still and stopped: it is hard to act, think or respond. Compared with “stunned”: longer, not only in the first moment.",
      ru:
        "Будто всё внутри застыло и остановилось: трудно действовать, думать, отвечать. По сравнению с «оторопью» — дольше, не только в первый миг.",
      uk:
        "Ніби все всередині застигло й зупинилося: складно діяти, думати, відповідати. Порівняно з «ошелешеністю» — довше, не лише в першу мить.",
    },
    review: "pending",
  },
  unknown: {
    text: {
      en:
        "No word comes, and that is a full answer. Compared with “can't say”: there a word is chosen but its fit is unclear; here there is no word.",
      ru:
        "Слово не приходит, и это полноценный ответ. По сравнению с «не могу сказать» — там слово выбрано, но неясно, подходит ли; здесь слова нет.",
      uk:
        "Слово не приходить, і це повноцінна відповідь. Порівняно з «не можу сказати» — там слово вибране, але незрозуміло, чи пасує; тут слова немає.",
    },
    review: "pending",
  },
};
