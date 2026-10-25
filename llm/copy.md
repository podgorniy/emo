<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — copy

Rules for every user-visible string outside the dictionaries: key naming, where
the strings live, forbidden words, editorial heading splits, parameters and
plurals, lengths, and the tests that hold all of it. The strings themselves live
in code (`shared/i18n/`), not here.

## 1. Rules

1. **Key naming:** `area.screen.element[.state]`, dot.case, ASCII, no digits
   except step numbers (`checkin.step.3.hint`). The areas are the namespaces of
   §2.
2. **Files.** `shared/i18n/keys.ts` holds `MESSAGE_KEYS`, the list of every key;
   `MessageKey` is its union type. `shared/i18n/ui.en.ts`, `ui.ru.ts` and
   `ui.uk.ts` each export a `Record<MessageKey, string>` (`uiEn`, `uiRu`,
   `uiUk`), so a key missing in any language, or a key not in `MESSAGE_KEYS`,
   does not compile. **No runtime fallback to en:** a missing key shows its own
   name (architecture.md §11.3). The client ships English in the shell and loads
   ru/uk as lazy chunks (`client/src/lib/i18n.ts`); the server and tests use all
   three through `shared/i18n/format.ts` (`t`, `tPlural`).
3. **Dictionaries are not here.** Zone, quality, word, certainty, urge and
   context labels, and the `QUALITY_GROUPS` labels, live in
   `shared/dictionaries.ts` (data.md §5). Term and scale descriptions live in
   `shared/glossary.ts` (data, under the tests of §8.3). The certainty buttons
   of step 6 (`checkin.step.6.confidence.*`) must equal the `WORD_CONFIDENCE`
   labels in every language (tested).
4. **Parameters** are `{name}` placeholders inside the string, filled by
   `fill()` in `shared/i18n/interpolate.ts`. Lists (`{list}`) arrive already
   joined by the caller: `Intl.ListFormat` (type `unit`) for en, a plain `,` for
   ru/uk.
5. **Plurals:** a count-dependent key is a base with four keys `.one`, `.few`,
   `.many`, `.other` in every language. `pluralKey()` picks the form with
   `Intl.PluralRules(locale).select(n)` (anything but one/few/many reads
   `.other`); en fills `.one` and `.other` and repeats `.other` in the rest. The
   bases are `PLURAL_BASES` in `shared/i18n/interpolate.ts` (§5).
6. **Editorial headings** are three keys per step:
   `checkin.step.<n>.title.editorial.pre`, `.em`, `.post`. The plain title is
   `checkin.step.<n>.title`; `pre + em + post` must equal it (§4).
7. **Forbidden words** apply to every string in every language, `mail.*` and
   `push.*` included. The list with its inflected forms is
   `shared/i18n/forbidden.ts` (§8.2).
8. **Typography:** curly quotes `“ ”` in en, `« »` in ru/uk; en-dash and em-dash
   as written; a non-breaking space before `→` and inside `0:42`-style times.
9. **Length:** ru/uk run 20–40 % longer than en. Controls that cannot grow are
   listed in §6. Soft hyphens (`&shy;`) only in dictionary labels, never in UI
   strings.
10. **Never translated:** `common.appName` ("Emo"); the language names
    (`settings.language.*` are endonyms); the theme names
    (`Calm, Mono,
    Lavender, Paper, Night, Ink, Sea glass, Archive, Dusk, Sand`,
    from `shared/theme/presets.ts`); the swatch short label `orig`.
11. **"passphrase" stays Latin in ru/uk strings:** it is what the person types
    into a field and what the recovery file says, and «парольная фраза» /
    «кодова фраза» are long and unfamiliar. A change to this is made in all keys
    at once (grep `passphrase` in `ui.ru.ts` / `ui.uk.ts`).
12. **Tone.** Copy orients, never evaluates: no counts that read as a score, no
    praise, no blame, no gender (`history.item.trigger.manual` is not "on your
    own"; `history.item.leftOpen` is factual). Push and mail carry no
    instruction beyond what they are for. The methodology behind these limits is
    methodology.md §3.
13. **Never reuse a key for different text.** Change the value in place; a key
    that falls out of use may stay in all three tables (several do, e.g.
    `auth.code.title`, `auth.code.differentEmail`,
    `checkin.step.10.validator.aria`, `settings.reminders.denied`).
14. **ru and uk are drafts until reviewed** by the owner, the same gate as the
    dictionary translations (architecture.md §11.4).

## 2. Key namespaces

The inventory of every key is `shared/i18n/keys.ts`; the text is in
`shared/i18n/ui.{en,ru,uk}.ts`. About 570 keys, by area:

| Namespace                                | What it covers                                                                                                                                  |
| :--------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.*`                               | Shared buttons and words (Done, Show/Hide, Skip, Next), the update card (`common.update.*`), the offline/unreachable band, `common.appName`     |
| `home.*`                                 | Home: Now, the draft line, the sync dot and its tooltip/sheet (`home.sync.*`), reminder lines, pane names, the wordmark                         |
| `checkin.*`                              | Shared across steps: progress, step label, Next/Back, close and "stop here", Save, Saved with Undo, null answers (`checkin.null.*`), help links |
| `checkin.step.1.*` … `checkin.step.10.*` | Per step: `title`, `title.editorial.*`, hint, options and summaries; step 6 certainty, step 9 "other" counter, step 10 note field and validator |
| `a11y.*`                                 | Screen-reader text: step announcements, slider words (`a11y.slider.*`), zones, the sync dot, the History track, keyboard legend                 |
| `settings.*`                             | Settings sections: `appearance`, `reminders`, `invites`, `devices`, `data` (export, lock, delete), `about`, `words`, `language`, `methodology`  |
| `history.*`                              | The History pane: title, empty and loading states, day labels, item lines, the end line, keyboard legend                                        |
| `auth.*`                                 | Sign-in, code, passphrase set/unlock, recovery key, new device, account switch, notifications and install onboarding                            |
| `push.*`                                 | `push.title` (the only push text) and `push.body` (empty on purpose)                                                                            |
| `mail.*`                                 | The sign-in code mail and the recovery-key mail (subject and body)                                                                              |
| `errors.*`                               | Error and state messages: generic, offline, unreachable, session expired, account gone, HTTPS required, damaged storage, rate limit             |

### 2.1 Stable copy decisions

- **Step 6 certainty "sure"** is an adverb in ru/uk, «уверенно» / «впевнено»:
  gender-neutral and short enough for the three-column buttons. "don't know" is
  "can't say" (`unknown`).
- **Step 2 summary** has no count: `checkin.step.2.summary.chosen` is "Chosen:
  {list}". A count would be ungrammatical in ru («1 выбрано») and something to
  optimise.
- **Login-code errors** are one message, `auth.code.invalid`: no attempts count,
  no "expired" versus "wrong" (api.md §2.1).
- **Push** is the title only, fixed per language (architecture.md §9.2): en
  "What's in the body?", ru «Что в теле?», uk «Що в тілі?». `push.body` is the
  empty string in every language, and the completeness test expects that.
- **Mail** (`shared/i18n/mail.ts`) is plain text, no HTML, no links. `{code}` is
  6 digits, `{key}` the recovery key in 8 groups, `{instance}` the hostname
  only: mail clients auto-link a bare hostname, but Emo never sends `https://`.
  A replaced recovery key adds `mail.recovery.renewed`.
- **History** has no counts and no plural keys (ui.md §15.18).
- **Settings → About** values in `{}` come from `GET /api/instance`; a row whose
  value is `null` is not rendered. `settings.about.privacy.body` must stay true
  to what the server stores (architecture.md §2.3): change both together.

## 3. `ErrorCode` → user text

The server's error `message` is for logs and is never shown. The client maps the
`code` to a key in `client/src/lib/errors.ts` (`userError`, table `BY_CODE`);
every other code reads `errors.generic`. A request that never reached the server
reads `errors.offline`. `rate_limited` becomes `errors.tooManyRequests` with
`{min}` from `Retry-After` (at least 1); the recovery card shows
`auth.recovery.email.limit` instead. `upgrade_required` shows
`errors.updateRequired` and the update card in its required state
(`common.update.required.*`).

Codes the person never sees, handled silently: `invites_disabled` (the Invites
section is hidden), `recovery_mail_disabled` (the card is hidden),
`entry_blob_mismatch` and `entry_deleted` (sync handles them), `unhealthy`
(`/healthz` only). `account_full` and `insufficient_storage` read
`errors.generic` while the sync dot stays pending (an operator problem);
`tz_unknown` and `locale_unsupported` read `errors.generic` (a client bug). The
code list is api.md §1.2; a new code gets a row in `BY_CODE` or is deliberately
left to `errors.generic`.

## 4. Editorial heading splits

Themes with `heading: editorial` render a step title as `pre` + _`em`_ (italic,
accent colour) + `post` (`CheckInFlow.svelte`). Rules:

- `pre + em + post` equals the plain title exactly; whitespace belongs to `pre`
  and `post`; `em` is never empty.
- Each language is split on its own: word order differs, so the emphasis is
  authored per language, not translated from en.
- `pre` or `post` may be empty (ru/uk step 7: the whole «Хочется» / «Хочеться»
  is the emphasis). Themes render an empty part without a stray space.
- The splits for all ten steps are the `checkin.step.<n>.title.editorial.*` keys
  in `ui.{en,ru,uk}.ts`. Step 10's title is the note field's visible label, so
  its split is kept and tested but not drawn as a heading.

## 5. Parameters and plural keys

Every parameter is a `{name}` inside the string. The plural bases
(`PLURAL_BASES`, four forms each):

| Base                                                                       | Param |
| :------------------------------------------------------------------------- | :---- |
| `auth.notifications.body` (ru «{n} раз/раза/раз», uk «{n} раз/рази/разів») | `n`   |
| `auth.switch.entries`, `auth.switch.unsynced`                              | `n`   |
| `settings.data.unreadable.corrupt`, `settings.data.unreadable.newer`       | `n`   |
| `settings.devices.signOut.discard`                                         | `n`   |

Not plural, with the reason where it matters:

| Key                                                                       | Params                          | Note                                                                 |
| :------------------------------------------------------------------------ | :------------------------------ | :------------------------------------------------------------------- |
| `checkin.progress.counter`                                                | `nn` (zero-padded), `label`     |                                                                      |
| `checkin.stepLabel`, `a11y.step.announce(.title)`                         | `n` (, `title`)                 | "Step {n} of 9"                                                      |
| `checkin.next.list` / `.count`                                            | `list` / `n`                    |                                                                      |
| `checkin.step.1.tab.aria`, `.figure.aria`                                 | `view`, `n`                     |                                                                      |
| `checkin.step.2.summary.chosen`                                           | `list`                          | no count on purpose (§2.1)                                           |
| `checkin.step.9.other.counter`, `checkin.step.10.counter`                 | `n`                             |                                                                      |
| `a11y.slider.low` / `.high`, `.untouched`                                 | `pole` / `text`                 | words, never a number                                                |
| `a11y.zone.*`                                                             | `zone`                          |                                                                      |
| `settings.appearance.current`                                             | `theme`, `seed`                 |                                                                      |
| `settings.appearance.status.lowContrast`                                  | `pairs` (pre-joined)            |                                                                      |
| `settings.appearance.fixedPalette`                                        | `name`                          |                                                                      |
| `settings.reminders.windowTooShort`                                       | `h`, `n`                        | `n` ≤ 6, the wording holds                                           |
| `settings.invites.joined` / `.limit` / `.shareText` / `.status.used`      | `n` / `code`, `url` / `date`    |                                                                      |
| `settings.about.contact` / `.version`                                     | `contact` / `app`, `server`     |                                                                      |
| `settings.devices.revoke.confirm`                                         | `device`                        |                                                                      |
| `settings.data.export.csv.labels` / `.preparing`                          | `language` / `n`                |                                                                      |
| `settings.data.clockSkew`                                                 | `n`                             | shown only for n ≥ 5, so en is always plural; ru/uk use «мин» / «хв» |
| `auth.step`, `auth.code.body` / `.resendIn`, `auth.newDevice.downloading` | `n` / `email` / `m`, `ss` / `n` |                                                                      |
| `auth.switch.signedInAs`                                                  | `email`                         |                                                                      |
| `auth.recovery.file.body`                                                 | `key`, `email`, `url`           |                                                                      |
| `mail.*`                                                                  | `code`, `key`, `instance`       |                                                                      |
| `errors.tooManyRequests`                                                  | `min`                           |                                                                      |

## 6. Length and fixed-width notes

Ratio = longest of ru/uk over en, in code points. A string is flagged when the
ratio is over 1.4 **and** it sits in a control that cannot grow.

- `checkin.next.list`: Next: {list} → / Далее: {list} →. Ratio: 1.1. Control: 56
  px button, truncates. Rule: the ellipsis is the design.
- `checkin.step.1.tab.front` / `.back`: Front / Спереди, Сзади. Ratio: 1.4.
  Control: 40 px segmented tab with badge. Rule: holds at 390 px; at 320 px
  prefer a smaller font (13 px) over a different word («Перед / Спина» is
  wrong).
- `checkin.step.6.confidence.sure`: sure / уверенно, впевнено. Ratio: 2.0.
  Control: three buttons, ≈ 100 px each. Rule: adverbs fit at 390 px; check at
  320 px.
- `settings.appearance.swatch.*`: Teal … Amber / Бирюза, Бурштин. Ratio: ≤ 1.75.
  Control: label under a 44 px swatch. Rule: not shown (swatches carry
  `aria-label` only). A visible label is capped at 7 characters: ru «Бирюза,
  Небо, Индиго, Шалфей, Сирень, Сланец, Роза, Янтарь», uk «Бірюза, Небо, Індиго,
  Шавлія, Бузок, Сланець, Роза, Бурштин».
- `settings.language.*`: English · Українська · Русский. Control: three equal
  segments. Rule: holds at 390 px (longest 10 characters).
- `home.sync.stale`: Not synced for a day / Не синхронизировано больше суток.
  Ratio: 1.6. Control: one line under the dots. Rule: **flag:** shorter forms
  are ru «Не синхронизировано сутки», uk «Не синхронізовано добу».
- `auth.recovery.email.title`: Email it to me / Отправить мне на email. Ratio:
  1.6. Control: card title, wraps. Rule: cards are at least 64 px and may wrap.
- `auth.code.resendIn`: Resend in {m}:{ss}. Ratio: 1.6. Control: text link.
  Rule: may wrap.

Everything else checked (`common.skipCheckin`,
`checkin.step.6.confidence.guess`, `settings.appearance.preview.*`,
`settings.appearance.swatch.custom`, `settings.devices.signOut`) is under the
threshold or in a control that grows.

## 7. Localisation notes for the UI

- Every UI string is a `MessageKey`; en is the reference text.
- Layout holds in the longest language. Buttons have no fixed widths; Next
  labels truncate with an ellipsis.
- Editorial splits are authored per language (§4).
- The language is the first of `navigator.languages` the app speaks
  (`detectLocale` in `client/src/lib/i18n.ts`), then whatever the person picks
  in Settings → Language; English when none matches. No runtime fallback to en
  for a missing key. The mechanics (what is translated, how the locale reaches
  the server) are in architecture.md §11.

## 8. Tests

### 8.1 Completeness (`shared/i18n/i18n_test.ts`)

- Every key of `MESSAGE_KEYS` is a string in en, ru and uk (over 300 keys) and
  is non-empty, except `push.body` (empty in all three, on purpose) and an
  editorial `pre` / `post`, which may be empty. Keys absent from `MESSAGE_KEYS`
  do not compile (the tables are typed `Record<MessageKey, string>`).
- Every plural base renders in every language for n ∈ {1, 2, 5, 11, 21, 22, 25,
  101}: non-empty, no `{` left, and the number present (except en n = 1). Spot
  checks pin ru `settings.devices.signOut.discard` for 1, 3, 5 and uk
  `auth.notifications.body` for 21.
- `checkin.step.<n>.title.editorial.pre + em + post === checkin.step.<n>.title`
  for steps 1–10 in all three languages.
- The step 6 certainty buttons equal the `WORD_CONFIDENCE` dictionary labels.
- Mail (`shared/i18n/mail_test.ts`): the code mail holds the code and the
  hostname and never `https?:`; `mail.recovery.renewed` appears only for a
  replaced key.
- `make lint` runs every test in `shared/i18n/`, so a missing translation or a
  forbidden word fails lint as well as `make test`.

### 8.2 Forbidden words (`shared/i18n/forbidden.ts`, `forbidden_test.ts`)

The list (`FORBIDDEN_WORDS`, which is the data; keep it in step with
methodology.md §3):

- en: `mood, moods, emotion, emotions, emotional, feeling, feelings`
- ru:
  `настроение, настроения, настроением, настроении, эмоция, эмоции, эмоций,
  эмоциям, эмоциями, эмоциях, эмоциональный, эмоциональное, эмоциональная,
  эмоциональные, чувство, чувства, чувств, чувствам, чувствами, чувствах`
- uk:
  `настрій, настрою, настроєм, настрої, емоція, емоції, емоцій, емоціям,
  емоціями, емоціях, емоційний, емоційне, емоційна, емоційні, почуття,
  почуттів, почуттям, почуттями, почуттях`

Rules:

- **Whole words**, case-insensitive, Unicode-aware: a match may not touch a
  letter or an apostrophe (`'`, `’`) on either side
  (`(?<![\p{L}'’])(…)(?![\p{L}'’])`, flags `iu`). Substring matching is wrong:
  it would also catch harmless words ("unfeeling" passes). `feel` alone is not
  listed; if copy ever needs it, add it explicitly.
- The regex does not stem, so the list carries the inflected forms. When copy
  changes, add the forms it uses; the test names the key and language that
  failed.
- **Scope:** all UI tables; dictionary labels (zones, qualities, urges,
  contexts, certainties, words of both levels) and `QUALITY_GROUPS`; glossary
  descriptions in every language; every string field of every theme preset; both
  mails in every locale (rendered by `MailService`); every line of every
  `.svelte` file in `client/src` (its `<style>` block removed),
  `client/src/sw.js`, `client/index.html` and `server/services/scheduler.ts`;
  the built-in privacy notice (`client/public/privacy.html`); the methodology
  page's own prose.
- **Methodology page:** names of theories, scales and works stay as published,
  so `<cite>…</cite>` and `<i class="term">…</i>` are exempt. A name is at most
  200 characters with no markup inside, and at least 10 000 characters of each
  language's article are still checked.
- **Negative controls:** the test asserts the matcher catches one example per
  language ("How are you feeling?", «Какое у вас настроение», «Яке почуття
  зараз»), passes "unfeeling Emo", and that a page's prose is checked while its
  names are not.

### 8.3 Glossary content tests (`shared/glossary_test.ts`)

The descriptions behind the help link and Settings → Words
(`shared/glossary.ts`, ui.md §6.5) sit inside the measurement, so their rules
are mechanical tests. Each rule runs per group, named
`glossary - <GROUP>: <rule>` with GROUP one of `BODY_ZONES`, `QUALITIES`,
`SCALES`, `WORDS`, `WORD_CONFIDENCE`, `URGES`, `CONTEXT_TAGS` (global checks are
`glossary - all: …`), so a writer can filter. Negative controls show that each
matcher catches a planted example.

- **R1 Completeness:** every non-retired key of the group has non-empty en, ru
  and uk text, in dictionary order; no key that `shared/dictionaries.ts` lacks,
  no retired key; BODY_ZONES only `whole_body` and `nowhere` (the 14 spatial
  zones are defined by the figure); the scales exactly `intensity`, `valence`,
  `arousal`, `head_mode`.
- **R2 Length** in code points: terms at most 200 en and 240 ru/uk; scales at
  most 320 en and 380 ru/uk.
- **R3** No forbidden word (§8.2).
- **R4** No stop-phrase of the note validator (`findStopPhrase` over
  `shared/i18n/note-stopwords.ts`, the union of all three languages): no causes,
  meanings or "why".
- **R5** No norm, frequency, coaching or clinical word, case-insensitive: en
  whole words (should, must, normal, healthy, supposed, try, usually, typically,
  most people, breathe, relax, dissociation, alexithymia, disorder, symptom,
  trauma, therapy, progress, learning to, and their listed forms); ru and uk
  stems at a word start (должн, нужн, нормальн, обычн, большинств, попробуйте,
  …; повинн, треба, зазвичай, звичайн, більшіст, спробуйте, …).
- **R6** No digit.
- **R7** No label of another measurement step: step 1 (all 16 zones), 2
  (qualities), 6 (words of both levels and the certainties) or 7 (urges). Labels
  are normalised (parenthesised parts removed, split on "/", trimmed, lower
  case, ’ as ') and matched as whole words or phrases. A label is foreign when
  it is in another of these steps and not in the description's own one; the
  group's own labels are set aside first, so a quoted near term ("tense
  waiting") is not the foreign label inside it. Scales and situations have no
  own step; situation labels are never foreign. An exception is declared on the
  description (`allow: [{ locale, label, reason }]`) and fails when the label is
  not foreign, not in the text, or the reason is empty.
- **R8** WORDS only: no vocabulary of the scales of steps 3–5 (stems strong,
  strength, charg, energ, pleasant, unpleasant; ru сил, заряд, энерг, приятн,
  неприятн; uk сил, заряд, енерг, приємн, неприємн).
- **R9** No text starts with its own label (any normalised part, after leading
  quotes). A scale has no dictionary label, so R9 does not apply to it.
- **Release gate:** `shared/release_test.ts` (run by `make release-check`,
  `EMO_RELEASE=1`) fails while any description is still a draft
  (`glossaryPendingReview()`) or any dictionary label is (`pendingReview()`).
