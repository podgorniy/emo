<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — data

What an entry records: the plaintext payload, every field, the dictionaries
(stable keys and where their labels live), what the reminder journal adds, and
how each stored format may evolve. Why each field exists is in `methodology.md`;
how a payload is encrypted, padded and synced is in `architecture.md`
(architecture.md §5.5, architecture.md §8).

Where the code owns the data, it is the reference:

| What                                                                                         | File                                                                                  |
| :------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| Entry and draft types, `ANSWER_STEPS`, `COPY_VERSION`, `UI_LAYOUTS`, validator, reader table | `shared/entry.ts` (`EntryV2`, `DraftV2`, `validateEntryV2`, `readEntry`)              |
| `SCHEMA_V`, dictionary keys and en/ru/uk labels, review markers                              | `shared/dictionaries.ts`                                                              |
| Term and scale descriptions                                                                  | `shared/glossary.ts`, `shared/glossary/*.ts`                                          |
| Control variants recorded in `ui`                                                            | `shared/theme/schema.ts` (`INTENSITY_VARIANTS`, `OPTION_VARIANTS`, `FIGURE_VARIANTS`) |
| How a draft becomes an entry                                                                 | `client/src/lib/machine.ts` (`toEntry`, `toStoppedEntry`, `mergeUi`)                  |
| Checking pulled entries                                                                      | `client/src/lib/entryCheck.ts`, `client/src/lib/entryRead.ts`                         |
| Reminder journal types                                                                       | `shared/protocol.ts` (`ReminderItem`, `ReminderStatus`, `ReminderReason`)             |
| Released-schema fixture                                                                      | `shared/fixtures/entry.v2.json`                                                       |

---

## 1. Principle

An entry is an act of reading the body, not a description or an analysis.
Everything that needs interpretation is kept out of the structure: causes,
meanings, conclusions, stories. Every refusal, emptiness and "don't know" is
valid data and is stored on equal terms with everything else (`methodology.md`
§2.7).

Entries are **immutable**. Editing would be re-interpretation, which the method
forbids; there is no screen for editing past entries. An entry can only be
deleted, as a tombstone (`DELETE /api/entries/:id` with the `X-Emo-Auth` proof):
by the emergency Undo on Saved and on Home (ui.md §6.5), which reopens the form
with the answers, or by **Delete** on an open record in the History pane (ui.md
§15.10), which does not. The Undo and tombstone mechanics: architecture.md §8.2.

---

## 2. The entry payload

### 2.1 Shape

`schema_v: 2`, as `EntryV2` in `shared/entry.ts` defines it:

```json
{
  "schema_v": 2,
  "id": "6f1c2a3e-9b4d-4e7f-8a21-5c3d9e0b1f47",
  "ts": "2026-10-07T10:00:00Z",
  "tz_offset_min": 180,
  "trigger": "random",
  "reminder_id": "0192f1c4-7b43-7000-8000-0000000000aa",
  "latency_sec": 14,
  "hidden_sec": 0,
  "skipped": false,
  "abandoned": false,
  "stopped_at": null,
  "body": {
    "locations": ["chest", "throat"],
    "qualities": ["squeeze", "lump"],
    "intensity": 6
  },
  "affect": {
    "valence": -2,
    "arousal": 7,
    "word": "fear.anxiety",
    "word_confidence": "guess"
  },
  "urge": "shrink",
  "head_mode": 8,
  "context_tag": "work",
  "context_other": null,
  "note": "созвон с руководителем",
  "untouched": ["head_mode"],
  "ui": {
    "theme": "3f9a1c0be27d4a65",
    "intensity": "slider",
    "options": "grid",
    "figure": "solid",
    "copy": 6,
    "layout": "phone"
  }
}
```

- Dictionary values are **stable English keys** (`chest`, `fear.anxiety`). A
  label in any language is a property of the interface, not of the data.
- The payload is serialised as canonical JSON (sorted keys), padded with ASCII
  spaces to a multiple of 2048 bytes and encrypted with the DEK; `ui` is
  encrypted with the rest. Nothing in it is visible to the server
  (architecture.md §5.5).

### 2.2 Where it is checked

- `validateEntryV2` is the whole schema: types, ranges, dictionary membership,
  the skipped/abandoned shape and the links between fields (§3.7). It runs
  before save and after a pulled entry is decrypted.
- `readEntry` runs a decrypted value through the reader table (§8.1) and the
  validator and never throws. It returns `ok`, `newer` (written by a newer app:
  kept encrypted, never shown or exported) or `invalid` (readable but not a
  valid entry). A decryption failure is `undecryptable`.
- Pulled rows are flagged `ok`, `undecryptable`, `invalid` or `newer`
  (`entryCheck.ts`). The ciphertext is always kept; nothing is uploaded or
  tombstoned because of a flag. A row not `ok` is checked again on every sync
  pass, so a flag clears once a build that can read it runs. What the user sees
  for each flag: reliability.md §1.2.

---

## 3. Fields

### 3.1 Service fields

| Field           | Type                                  | Description                                                                                                                                                                                                                                                                                                                                     |
| :-------------- | :------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_v`      | `2`                                   | Payload version (§8.1)                                                                                                                                                                                                                                                                                                                          |
| `id`            | UUID v4                               | Random (`crypto.randomUUID()`): a time-ordered id would tell the server when the entry was written. The validator and the server reject other versions                                                                                                                                                                                          |
| `ts`            | ISO 8601 UTC, `Z`, optional ms        | When the entry was saved. On an abandoned entry: the last interaction with the form                                                                                                                                                                                                                                                             |
| `tz_offset_min` | int, ±840                             | Local offset at that moment (`-Date.getTimezoneOffset()`)                                                                                                                                                                                                                                                                                       |
| `trigger`       | `random` \| `manual` \| `after_event` | `random`: an answer to a reminder within 15 minutes of its notification appearing (`REMINDER_RESPONSE_WINDOW_MIN`) — a tap on it, or a check-in started on this device while it still shows. `manual`: opened on one's own, including a tap on a notification after that window. `after_event`: started from Home's "after an event" (ui.md §3) |
| `reminder_id`   | UUID or `null`                        | The reminder answered; only with `trigger = random`, otherwise `null`. Always present                                                                                                                                                                                                                                                           |
| `latency_sec`   | int, 0 – 30 days                      | Wall-clock seconds from step 1 first shown to save (to the last interaction on an abandoned entry), **including** time the app was hidden. Recorded automatically, never shown                                                                                                                                                                  |
| `hidden_sec`    | int, 0 – `latency_sec`                | How much of `latency_sec` the app was hidden or closed (`visibilitychange`, and the time between closing and resuming a draft). Active time = `latency_sec − hidden_sec`; without it "away for 9 minutes" and "slow to answer" look the same                                                                                                    |

### 3.2 Skipped, abandoned, stopped

| Field        | Type                      | Description                                                                                                                                                                                                                                                                               |
| :----------- | :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skipped`    | bool                      | `true` when the check-in ended without Save: "Skip check-in" on step 1, "Stop here" from step 2 on, "Skip" on Home, or abandoned. It is stored and counts as a gap for compliance                                                                                                         |
| `abandoned`  | bool                      | `true` when the form was left open without Save or an explicit skip: 10 minutes without interaction (`ABANDON_AFTER_MS`, ui.md §6.2). Always with `skipped = true`                                                                                                                        |
| `stopped_at` | answer-step key or `null` | Only on a skipped entry: the step on screen when it ended (on an abandoned one, at the last interaction). A key from `ANSWER_STEPS` (§4), not a screen number. `null` on a saved entry. Missing on entries written before the field existed: read as `null` (such a skip kept no answers) |

On a skipped entry the answers of the steps **before** `stopped_at` are kept as
they were confirmed with Next — observed data, not imputation — and the fields
of that step and every later one are `null`. Stopped on `locations` (step 1): no
answers at all, and `untouched`, `body`, `affect`, `urge`, `head_mode`,
`context_tag`, `context_other`, `note` are all `null`. Stopped on the last
screen: `stopped_at = "context"`, so neither the situation nor the note is kept.
A kept note must pass the note check of the form (`validateNote`).

A check-in started on one's own (`manual`, `after_event`) and closed or
abandoned with no interaction at all leaves no entry. One opened from a reminder
always leaves one: an unanswered reminder is compliance data (`methodology.md`
§1.1; ui.md §6.2).

### 3.3 Body (`body`)

| Field       | Type                            | Description                                                                                                                                                                        |
| :---------- | :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locations` | array of keys (§5.2), non-empty | Zones, chosen by tapping the figure (front / back), never from a text list. "Whole body" → `["whole_body"]`, "nowhere" → `["nowhere"]`; each excludes every other zone. No repeats |
| `qualities` | array of keys (§5.3), non-empty | Qualities of the sensation; several allowed. `nothing` and `cant_tell` each exclude every other quality. No repeats                                                                |
| `intensity` | int 0–10                        | Strength of the sensation. The control shows no number; untouched → 5 and listed in `untouched`                                                                                    |

### 3.4 Affect (`affect`)

| Field             | Type                                     | Description                                                                                                                                                                                                                                                                                     |
| :---------------- | :--------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `valence`         | int −3…+3                                | "Overall: unpleasant or pleasant?" — the state as a whole, not one sensation. Always a bipolar slider with a marked centre; 0 is neutral; untouched → 0 and listed in `untouched`                                                                                                               |
| `arousal`         | int 0–10                                 | "Low charge, everything slowed" ↔ "high charge, everything sped up": both poles without judgement. No number; untouched → 5 and `untouched`. In copy 1 the poles were "sluggish, inhibited" ↔ "wound up, on edge", both unpleasant, which pulled answers towards the valence × arousal diagonal |
| `word`            | key or `null`                            | The word for the state (§5.4): two levels, level 1 then an optional level 2, stored `l1` or `l1.l2`. `empty` and `unknown` ("don't know") are always offered on level 1. `null` when no word was chosen                                                                                         |
| `word_confidence` | `guess` \| `sure` \| `unknown` \| `null` | Required with a word, `null` without one. The word `unknown` always has `unknown`                                                                                                                                                                                                               |

Valence and arousal are recorded **independently** of the word: a state can be
recorded without naming it.

### 3.5 Other answers

| Field           | Type                 | Description                                                                                                                                                                                                                                                                                          |
| :-------------- | :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `urge`          | key (§5.6) or `null` | "I feel like…": one action tendency, optional                                                                                                                                                                                                                                                        |
| `head_mode`     | int 0–10             | "Just before you opened Emo, where was your attention?": in the body ↔ in the head, in thoughts. Anchored to an event every entry has (a manual entry has no reminder). In copy 1 the anchor was "just before this", i.e. after seven steps about the body. No number; untouched → 5 and `untouched` |
| `context_tag`   | key (§5.7)           | One situation tag; required when its step was reached                                                                                                                                                                                                                                                |
| `context_other` | string or `null`     | Only with `context_tag = "other"`: 1–40 code points, not blank; no stop-word check. Otherwise `null`                                                                                                                                                                                                 |
| `note`          | string or `null`     | A fact, not an interpretation. Non-blank, at most 160 code points (not bytes, not UTF-16 units). The stored schema checks length only: the stop-phrase list is a rule of input (ui.md §8), so changing the list never invalidates a saved entry                                                      |

### 3.6 How the answers were taken: `untouched` and `ui`

**`untouched`** (array or `null`): the sliders the person never touched — a
subset of `intensity`, `valence`, `arousal`, `head_mode`, each at most once.
Their stored value is the midpoint (5, or 0 for valence), but "left alone" stays
distinguishable from "chose the middle". `[]` when every slider was touched;
`null` on an entry skipped on step 1. On a stopped entry it lists only the
untouched sliders of steps before `stopped_at`; sliders not reached are `null`
and not listed. In copy 4–5 it is a lower bound (see below).

**`ui`** (object or `null`): which controls, which version of the instrument and
which layout the entry was taken with, so analyses compare like with like
(`methodology.md` §5.4). Present on every entry, including one skipped or
abandoned on step 1; `null` only on entries written before copy 6.

| Key         | Values                                            | Meaning                                                                                                                                   |
| :---------- | :------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`     | 16 lowercase hex                                  | First 16 hex characters of SHA-256 over the canonical resolved theme JSON (ui.md §14.7)                                                   |
| `intensity` | `slider` \| `bloom` \| `ruler`                    | Always `slider` (the instrument is identical in every theme, ui.md §1.11); written so a later version with variants keeps comparable data |
| `options`   | `grid` \| `chips` \| `grouped` \| `list`          | Always `grid`                                                                                                                             |
| `figure`    | `solid` \| `soft` \| `hatch` \| `glow`            | Always `solid`                                                                                                                            |
| `copy`      | int ≥ 1, optional                                 | `COPY_VERSION` the check-in started with; missing = 1                                                                                     |
| `layout`    | `phone` \| `short` \| `wide` \| `mixed`, optional | The form's layout; missing = unknown                                                                                                      |

Readers ignore `ui` keys they do not know, so a newer app may add some.

**`ui.copy`** is the version of the instrument's wording **and screen
composition**: questions, poles, labels, screens, term descriptions, the way a
control answers. Any change of these, or of a description's meaning, bumps
`COPY_VERSION` in `shared/entry.ts`. The draft keeps the version it started
with: a check-in started before an update and saved after it stays in the old
version.

| Copy | What the instrument was                                                                                                                                                                                                                                                                                                          |
| :--- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | The original wording (every entry without `ui.copy`)                                                                                                                                                                                                                                                                             |
| 2    | Neutral arousal poles, "Overall:" on valence, `head_mode` anchored to opening Emo, the certainty "can't say", the vocabulary of §5 (`head_back`, `spaciousness`, `steadiness`, `joy.pride`, `joy.hope`, `joy` labelled "joy / ease", relabelled `self_pity` and `alone`), nine screens with the note under the situation         |
| 3    | A description of every term and scale one tap away on steps 2–9 and in Settings → Words (§5.9); no wording, pole, label or screen changed                                                                                                                                                                                        |
| 4    | A slider screen's Next waits for a touch (a press where the thumb is answers the midpoint); step 3's null hint asks for that press                                                                                                                                                                                               |
| 5    | On a phone the screens sit under the thumb: the question with its slider or the urges low on the screen, step 1's Whole body / Nowhere in the footer and its Front/Back switch under the figure, help links at the right edge, Close and Stop here over Next; no wording changed                                                 |
| 6    | A slider answers only to a slide along its track, a still tap (moved < ~10 px, no `pointercancel`) or a key: a still tap within reach of the thumb answers where it is, one elsewhere on the track sets the value there; a scroll, pull or pinch starting on a slider answers nothing. `ui` on every entry; `ui.layout` recorded |

In copy 4–5 a scroll or pull that started on an untouched slider could record
its midpoint as a touch, so `untouched` there is a lower bound.

**`ui.layout`**: `phone` — narrower than 900 px; `short` — a phone whose
keyboard-free layout-viewport height is under 500 px (held sideways); the height
is held while an on-screen keyboard is up, so typing never makes an entry
`mixed` (`client/src/lib/viewport.ts` `keyboardFreeHeight`); `wide` — 900 px and
wider; `mixed` — the layout changed while the check-in was open (turned, or a
draft resumed in another window). It is recorded on the draft when the form
opens and whenever the layout changes while it is open (`machine.recordLayout`),
and merged at save (`machine.mergeUi`). The CSV column is `ui_layout`
(architecture.md §10.1).

**Comparability: version × layout.** A cell is one `ui.copy` and one
`ui.layout`. Slider values, words and `untouched` are compared within a cell;
cells are never pooled.

| `ui.copy` | `ui.layout` | Cell            | What differs                                                                                                                                                    |
| :-------- | :---------- | :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 2, 3   | none        | one per version | Wording and vocabulary (2), one-tap descriptions (3); layout not recorded                                                                                       |
| 4         | none        | own             | Next waits for a slider touch; `untouched` a lower bound                                                                                                        |
| 5         | none        | own             | Phone screens under the thumb; wide screens as in 4 but unrecorded, so they cannot be separated from phone entries nor pooled with 4; `untouched` a lower bound |
| 6         | `phone`     | own             | The slider answers only to a slide, a still tap or a key; phone screens as in 5                                                                                 |
| 6         | `short`     | own             | The same on a phone held sideways                                                                                                                               |
| 6         | `wide`      | own             | The wide-screen layout                                                                                                                                          |
| 6         | `mixed`     | own             | The layout changed during the check-in; left out of comparisons by layout                                                                                       |

An entry started in copy 5 and saved after the update stays copy 5 but may carry
a layout; it belongs to the copy-5 row.

### 3.7 Rules between fields

What `validateEntryV2` enforces beyond the types above:

- `abandoned = true` requires `skipped = true`; `stopped_at` is set only when
  `skipped = true`.
- `reminder_id` is non-null only with `trigger = random`.
- `hidden_sec ≤ latency_sec`.
- Every field of a reached step is present and valid; every field of a step not
  reached is `null` (§3.2). A saved entry reaches every step.
- `body.locations`: known keys, no repeats, `whole_body` and `nowhere` alone.
  `body.qualities`: known keys, no repeats, `nothing` and `cant_tell` alone.
- `word` is `l1` or `l1.l2` with known keys (retired keys stay valid);
  `word_confidence` is set exactly when `word` is; `word = unknown` has
  `word_confidence = unknown`.
- `untouched` holds only reached sliders, once each.
- `context_other` only with `context_tag = other`.
- `ui` is present (object or `null`); its known keys are checked, unknown ones
  ignored.

---

## 4. Input order

Strictly in this order. The answer groups are `ANSWER_STEPS` in
`shared/entry.ts`; the form shows them on nine screens, the note on the same
screen as the situation, under it (ui.md §6.2):

| #  | Answer step (`stopped_at` key) | Fields                                  |
| :- | :----------------------------- | :-------------------------------------- |
| 1  | `locations`                    | `body.locations` (the body figure)      |
| 2  | `qualities`                    | `body.qualities`                        |
| 3  | `intensity`                    | `body.intensity`                        |
| 4  | `valence`                      | `affect.valence`                        |
| 5  | `arousal`                      | `affect.arousal`                        |
| 6  | `word`                         | `affect.word`, `affect.word_confidence` |
| 7  | `urge`                         | `urge`                                  |
| 8  | `head_mode`                    | `head_mode`                             |
| 9  | `context`                      | `context_tag`, `context_other`          |
| 10 | `note`                         | `note` (screen 9, with the situation)   |

The body comes before words. Going back is always possible; skipping forward is
not. A check-in can stop at any step: from step 2 on, "Stop here" keeps the
answers of the steps before (§3.2). A partial dose is still a dose
(`methodology.md` §2.12, §5.3). The keys name answer groups, not screens, so
putting two groups on one screen never changes their meaning;
`stopped_at =
"note"` stays valid in stored entries.

---

## 5. Dictionaries

### 5.1 Rules

- Dictionaries are fixed: the user cannot add values. This keeps the check-in
  from turning into a search for words.
- `shared/dictionaries.ts` is the only source of keys and labels. Each
  dictionary is an array of `{ key, label: { en, ru, uk }, review?, retired? }`
  in display order; `WORDS` is a tree level 1 → level 2; `QUALITIES` items also
  carry a `group`. The type requires all three labels, so a missing translation
  does not compile.
- Data stores keys only; labels are i18n. The **ru** labels are the
  methodological source; en and uk render the meaning of the ru label.
- A key is **never renamed or deleted**. To take a value out of input, set
  `retired: true`: `forInput` hides it from new check-ins, old entries still
  validate and render, and the export's `dictionaries.json` still lists it
  (§8.2).
- Labels are part of the measurement instrument (architecture.md §11.4). A draft
  label carries `review: "pending"` until the owner checks its meaning against
  ru; `pendingReview()` lists what is left, and the release gate
  (`shared/release_test.ts`, run by `make release-check` with `EMO_RELEASE=1`)
  fails while any remain. Every dictionary item and every quality-group header
  (`QUALITY_GROUPS_REVIEW`) is still `pending`.
- A changed label or description meaning bumps `ui.copy` (§3.6).
- Adding a key: append it with all three labels; it does not bump `schema_v`.

### 5.2 `BODY_ZONES`

`forehead_eyes`, `jaw`, `head_back` (back view), `throat`, `neck`, `shoulders`,
`chest`, `solar_plexus`, `belly`, `lower_belly`, `lower_back`, `upper_back`,
`arms_hands`, `legs_feet`, `whole_body`, `nowhere`.

`whole_body` and `nowhere` are separate buttons, not zones of the figure. Which
zone each region of the figure maps to: ui.md §7.

### 5.3 `QUALITIES`

In display order (the order of the 2-column grid), with `group`:

| Group         | Keys                                                                     |
| :------------ | :----------------------------------------------------------------------- |
| `pressure`    | `heaviness`, `lightness`, `squeeze`, `expansion`, `lump`, `spaciousness` |
| `temperature` | `warmth`, `heat`, `cold`                                                 |
| `movement`    | `trembling`, `tingling`, `pulsing`, `aching`, `pulling`, `tickling`      |
| `tone`        | `numbness`, `emptiness`, `nausea`, `tension`, `relaxation`, `steadiness` |
| `none`        | `nothing`, `cant_tell`                                                   |

Display order: `heaviness`, `lightness`, `squeeze`, `expansion`, `lump`,
`warmth`, `heat`, `cold`, `trembling`, `tingling`, `pulsing`, `numbness`,
`emptiness`, `nausea`, `tension`, `relaxation`, `aching`, `pulling`, `tickling`,
`spaciousness`, `steadiness`, `nothing`, `cant_tell`. The resource qualities
`spaciousness` and `steadiness` sit before the null answers. Group headers
(`QUALITY_GROUPS`) are used only by the reserved `grouped` layout, which shows
the groups in the order pressure · temperature · movement · tone · none.

### 5.4 `WORDS`

Level 1 → level 2. Choosing level 2 is optional; a word may stop at level 1.
Stored as `l1` or `l1.l2` (`fear`, `fear.anxiety`).

| Level 1    | Level 2 keys                                                                                                                         |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `fear`     | `anxiety`, `worry`, `wariness`, `tense_waiting`, `panic`, `terror`, `self_consciousness`, `insecurity`                               |
| `anger`    | `irritation`, `frustration`, `resentment`, `indignation`, `rage`, `disgust`, `contempt`, `impatience`                                |
| `sadness`  | `longing`, `sorrow`, `loneliness`, `disappointment`, `grief`, `despondency`, `self_pity`, `helplessness`                             |
| `shame`    | `awkwardness`, `guilt`, `humiliation`, `embarrassment`, `worthlessness`                                                              |
| `joy`      | `interest`, `relief`, `calm`, `tenderness`, `thrill`, `gratitude`, `contentment`, `enthusiasm`, `warmth_to_someone`, `pride`, `hope` |
| `surprise` | `confusion`, `bewilderment`, `curiosity`, `stunned`                                                                                  |
| `empty`    | `numbness`, `boredom`, `detachment`, `cotton_wool`, `nothing`, `frozen`                                                              |
| `unknown`  | — (no level 2)                                                                                                                       |

`empty` and `unknown` are full options and look like every other one. `joy` is
labelled "joy / ease" (ru «радость / покой»): calm, relief and contentment live
under it. The resource words (`joy.pride`, `joy.hope`) and qualities exist
because positive granularity goes with resilience (Tugade, Fredrickson &
Barrett, 2004) and the concepts offered shape what is constructed
(`methodology.md` §2.2).

### 5.5 `WORD_CONFIDENCE`

`guess` (en "guessing", ru «угадываю», uk «вгадую»), `sure` ("sure", «уверенно»,
«впевнено»), `unknown` ("can't say", «не могу сказать», «не можу сказати»). The
ru and uk "sure" are adverbs: gender-neutral, and short enough for the
three-column buttons. `unknown` is labelled "can't say", never "don't know",
which is the level-1 word on the same screen; the stored key stays `unknown`.
The buttons show these labels through `checkin.step.6.confidence.*`
(`shared/i18n/keys.ts`).

### 5.6 `URGES`

`leave`, `shrink`, `freeze`, `move`, `hit`, `cry`, `shout`, `sleep`, `eat`,
`hug`, `talk`, `stay_silent`, `nothing`.

### 5.7 `CONTEXT_TAGS`

`work`, `people`, `alone`, `food`, `commute`, `home`, `screen`, `body_sport`,
`sleep` (before / after sleep), `other` (with `context_other`).

### 5.8 Labels

The en, ru and uk labels are in `shared/dictionaries.ts`; do not copy them into
documents. Label rules that guard against tempting mistakes:

- `alone` is ru «наедине», uk «наодинці»: gender-neutral (ru «один» is
  masculine).
- `self_pity` is "sorry for myself" / «жалко себя» / «шкода себе»: the felt
  state, not a self-judgement.
- The uk labels are first drafts. The choices most worth a second look in
  review: `lump` «клубок» (uk says «клубок у горлі»); `fear.self_consciousness`
  «скутість» (ru «стеснение»; alternative «сором'язливість»);
  `sadness.despondency` «пригніченість» (ru «уныние»; «зневіра» leans to
  despair); `surprise.stunned` «ошелешеність» (ru «оторопь»); `joy` «радість /
  легкість», because «спокій» is the level-2 `calm` on the same screen.

### 5.9 Descriptions

Every option of steps 2, 6 (both levels and the certainty), 7 and 9,
`whole_body` and `nowhere`, and the scales of steps 3, 4, 5 and 8 have a short
description in en/ru/uk (`shared/glossary.ts`; `SCALE_DESCRIPTIONS`,
`TERM_DESCRIPTIONS`). The 14 spatial zones have none: the figure defines them.
The ru key's meaning defines the description; en and uk describe the key, not
the dictionary sense of their own word. Descriptions are shown one tap away
during a check-in ("About these words" / "About this question") and in Settings
→ Words; opening one is not an interaction with the form and is not recorded.
Writing rules and their tests: copy.md §8.3.

Every description is `review: "pending"` until the owner's review;
`glossaryPendingReview()` lists them and the release gate fails while any
remain. While they are pending, edits stay in the current `ui.copy`; the change
that ends the review bumps `ui.copy` if any description's meaning changed; after
that every change of meaning bumps it (typo fixes do not).

---

## 6. Reminders as data

The reminder journal is the record of every moment the server planned: what
`trigger = random` entries answer, and what compliance is counted against
(`methodology.md` §1.1, §5.3). How moments are drawn and sent: architecture.md
§9; edge cases: reliability.md §2.

A journal row (`ReminderItem`, also in the export's `reminders.jsonl`):

| Field           | Meaning                                                                                                                                                                                                                                                                                              |
| :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | The reminder's UUID; an entry that answers it carries it as `reminder_id`                                                                                                                                                                                                                            |
| `local_date`    | The local day it was planned for                                                                                                                                                                                                                                                                     |
| `tz`            | The time zone the day was planned in (gives the local time of a moment nobody answered); missing on rows from servers that did not record it                                                                                                                                                         |
| `scheduled_for` | The planned instant                                                                                                                                                                                                                                                                                  |
| `sent_at`       | When it was sent, or `null`                                                                                                                                                                                                                                                                          |
| `status`        | `planned`, `sent`, `failed` (past its retry window, every subscription refused it), `cancelled`, `paused` (planned while reminders were paused; never sent)                                                                                                                                          |
| `reason`        | On `cancelled` rows: `settings` (a mid-day settings change left it outside the window or over the count), `overdue` (never tried in its window: the server was down), `no_device` (no device to send to), `tz_change` (a move to another zone); else `null`. A string, so a newer server may add one |
| `updated_at`    | Last change of the row                                                                                                                                                                                                                                                                               |

Clients receive only reminders whose time has passed; future times never leave
the server (api.md §2.8). An unanswered reminder is `sent` with no entry
carrying its id. A missed reminder is never rescheduled or accumulated, and no
count of missed reminders is ever shown (`methodology.md` §8).

---

## 7. What is deliberately absent

- Fields for "why", "what it means", "conclusion", "what I did".
- Free text longer than 160 code points (`note`) or 40 (`context_other`).
- Emoji or mood icons.
- User-defined tags or words.
- Sensor data (heart rate, HRV, sleep).
- Any derived or aggregated field in an entry. `untouched` and `ui` are not
  derived from the answers; they are facts about how the answers were given, so
  that derived values can later be computed honestly.
- Editing after save (§1).

---

## 8. Schema evolution

### 8.1 Entry payload (`schema_v`)

| Rule                     | Detail                                                                                                                                                                                                                                                                                        |
| :----------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current                  | `schema_v: 2` (`SCHEMA_V` in `shared/dictionaries.ts`; `KNOWN_MAX_SCHEMA_V` in `shared/entry.ts`) is the first released version. v1 existed only in an early draft and was never written: there is no v1 reader                                                                               |
| Before the first release | A field may still be added to v2 without a bump, as `stopped_at`, `ui.copy` and `ui.layout` were, only if every reader treats a missing one as its default: `stopped_at` → `null`, `ui.copy` → 1, `ui.layout` → unknown, `ui` → `null`. After the first release, a new field bumps `schema_v` |
| Bump when                | A field is added, removed, re-typed, or its allowed values change meaning. Adding a dictionary key does **not** bump (`retired` governs display)                                                                                                                                              |
| Writer                   | Always writes the newest version the client knows                                                                                                                                                                                                                                             |
| Reader, older version    | Normalised through the reader table (`READERS` in `shared/entry.ts`) into the current in-memory shape. The stored blob is never rewritten                                                                                                                                                     |
| Reader, newer version    | `schema_v > KNOWN_MAX_SCHEMA_V`: keep the ciphertext, flag `needs_newer_app` (`newer`), discard the plaintext, leave it out of History and export. Never throw, never tombstone                                                                                                               |
| Removing a field         | Never physically; the reader fills `null`                                                                                                                                                                                                                                                     |
| Unknown keys             | Readers ignore keys they do not know inside `ui`, so a newer app's entry still reads                                                                                                                                                                                                          |

The reader table is empty: its first row comes with `schema_v: 3`, and each row
says how an older version becomes the current shape.

Tests: one fixture per released version, `shared/fixtures/entry.v<N>.json` (only
`entry.v2.json`), must read through `readEntry` and validate as current
(`shared/entry_test.ts`).

### 8.2 Dictionaries

| Operation  | Allowed   | How                                                                                                                             |
| :--------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------ |
| Add key    | yes       | Append; all three labels required by the type; `review: "pending"` until the owner's review; the release gate forbids `pending` |
| Retire key | yes       | `retired: true`; hidden from new input; old entries still render; the export's dictionary includes it                           |
| Rename key | **never** | Add a new key and retire the old                                                                                                |
| Delete key | **never** | —                                                                                                                               |
| Reorder    | yes       | Display order is UI; data is unaffected                                                                                         |

### 8.3 IndexedDB

| Rule         | Detail                                                                                                                                                                                                                 |
| :----------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_VERSION` | Integer in `client/src/lib/idb/schema.ts` (database `emo`, version 3); every bump adds one step to `MIGRATIONS`, keyed by target version, run in order inside the upgrade transaction. A released step is never edited |
| Stores       | `entries` (index `idx_seq`), `outbox` (index `idx_attempts`), `keys`, `meta`, `draft`, `prefs`, `reminders`                                                                                                            |
| Migrations   | Additive only: a store is never dropped in place; a rename is create + copy + delete in the same upgrade step                                                                                                          |
| Multi-tab    | A blocked upgrade: reliability.md §1.1                                                                                                                                                                                 |
| Tests        | Open a fixture database at each historical version in fake-indexeddb, upgrade to current, assert the store and index set and a sample row (`client/src/lib/idb/schema_test.ts`)                                        |

Decrypted payloads, a plaintext `ts` index and a plaintext draft are never kept
on disk: entries are stored as ciphertext, the draft encrypted with the DEK
(ui.md §6.2).

### 8.4 Keyring

`key_version` is reserved for DEK rotation (architecture.md §5.3). Fixed now:
the server keeps every keyring; entries carry `key_version`; the AAD includes
it. A client that meets an unknown `key_version` treats the entry as
`undecryptable` (reliability.md §1.2) and re-fetches the keyring list once per
session.

### 8.5 SQLite (server)

| Rule            | Detail                                                                                                                                                                                                                                            |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Files           | `server/db/schema/NNN_<name>.sql` (`001_initial.sql` …), applied in numeric order, recorded in `schema_migrations(version, applied_at)`                                                                                                           |
| Transactional   | All pending files run inside **one** `BEGIN IMMEDIATE … COMMIT` (all or nothing). DDL in SQLite is transactional; a migration file must not contain statements that cannot run in a transaction (`PRAGMA journal_mode`, `VACUUM`)                 |
| Forward-only    | No down migrations. Rollback = restore the pre-migration copy and run the previous binary (ops.md §3.2)                                                                                                                                           |
| Pre-backup      | `VACUUM INTO 'backups/pre-migrate-<from>-to-<to>-<ts>.sqlite'` before the transaction; the last 3 are kept                                                                                                                                        |
| Data migrations | A separate numbered file; must be idempotent (re-runnable)                                                                                                                                                                                        |
| Compatibility   | A binary refuses to start when `MAX(schema_migrations.version)` is newer than its latest migration (downgrade protection), exit code 4 (2: a migration failed and was rolled back; 3: `DATA_DIR` not writable). `PRAGMA user_version` is not used |

Every migration gets a line in `CHANGELOG.md`; a step an operator must do by
hand is marked **Manual step** (ops.md §3.1).
