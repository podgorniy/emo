<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — methodology

Which theories and measurement traditions each field of an entry rests on, what
was deliberately left out, and what that means for how the data may be analysed.
Nothing in any other document may contradict this file.

The published rendition is `client/public/methodology.html` (served at
`/methodology` and `/methodology.html`; en, uk, ru; the personal context below
is left out). A change here is made there too, in all three languages. Field
names match the export (JSONL; the CSV writes `affect.valence` as
`affect_valence`); the fields themselves are specified in `data.md`.

---

## 0. How firm each source is

Every source below carries one of three marks:

- **[A]** — established findings: they replicate, and there are meta-analyses.
- **[B]** — an actively researched model, with criticism and competing theories.
- **[C]** — a clinical tradition or a practical model without a strong
  experimental base. A source of vocabulary and procedure, never grounds for
  statistical conclusions.

---

## 1. How data is collected

### 1.1 Experience sampling and ecological momentary assessment [A]

Fields: `trigger`, `reminder_id`, `skipped`.

- Csikszentmihalyi & Larson (1987): the Experience Sampling Method (ESM).
  Shiffman, Stone & Hufford (2008): Ecological Momentary Assessment (EMA).
- The idea: many short measurements **in the moment**, in everyday surroundings,
  prompted by a random signal.
- Why: looking back ("how was your week?") is distorted by peaks, endings and
  the present state (Kahneman's peak-end rule; Robinson & Clore, 2002, the
  accessibility model: a retrospective report draws on beliefs about oneself,
  not on experience).
- For a person with 25 years of dissociation, looking back is especially
  uninformative: beliefs about their own states are missing or formulaic.

What follows for the record:

- `trigger = random`: signal-contingent sampling. The response window is 15
  minutes after the notification appears. An answer is a tap on it, or a
  check-in started on one's own while it is still on screen. Later, the entry is
  `manual` and the reminder counts as unanswered.
- `trigger = manual`: event-contingent sampling. A growing share of `manual`
  entries means more spontaneous noticing, which is itself a target outcome.
- `skipped`: compliance. The EMA standard is at least 70–80% of prompts
  answered; below that the data is systematically biased, because the hard
  moments are the ones skipped (§5.3).
- A short form (60 seconds or less): an EMA requirement for keeping compliance
  over weeks and months.

### 1.2 Measurement reactivity [A/B]

- Measuring changes what is measured (Barta, Tennen & Litt, 2012, a review of
  diary research).
- Here reactivity **is the goal**: turning attention to the body again and again
  is the intervention itself (affect labelling, §2.11; interoceptive training,
  §2.3).
- For analysis: a change in the state cannot be separated from a change in the
  skill of reading it. This is a fundamental limit; keep it in mind in every
  interpretation.

---

## 2. The models behind the fields

### 2.1 The circumplex model of affect → `affect.valence`, `affect.arousal` [A]

- Russell (1980); Russell & Barrett (1999), core affect.
- Any state can be placed on two continuous axes: valence (pleasant to
  unpleasant) and arousal (sluggish to activated). A named, discrete state is
  built on top of them.
- Why it matters: someone who **cannot yet** name what is going on can still
  rate pleasantness and energy. It is the lowest level of access, and the place
  to start.
- For analysis: the (valence, arousal) coordinates are the main raw variable.
  The word (`affect.word`) is secondary.

### 2.2 Constructed emotion and emotional granularity → `affect.word`, the two-level list [B]

- Barrett (2006, 2017, _How Emotions Are Made_). The competing position is basic
  emotions (Ekman, Panksepp). The debate is not settled; for keeping a diary it
  does not matter much.
- Granularity, or differentiation: telling close states apart ("anxiety" or
  "irritation" or "shame" rather than "bad").
- Evidence [A]: low granularity goes with poorer regulation, more impulsivity
  and alexithymia; high granularity with more adaptive strategies (Barrett et
  al., 2001; Kashdan, Barrett & McKnight, 2015, a review).
- The classic metric: the mean ICC between ratings of several states within a
  person across many moments; granularity = 1 − ICC (Tugade, Fredrickson &
  Barrett, 2004). **It does not apply here directly**: an entry holds one word,
  not ratings on a set of words. §5.1 lists stand-ins.
- The two-level list (8 broad words, then about 50 finer ones) is procedural
  scaffolding: someone with low granularity first picks a cluster, then refines
  it.

### 2.3 Interoception → `body.*`, `latency_sec` [A/B]

- Craig (2002, 2009): interoception as the basis of the subjective sense of self
  (the insula).
- Garfinkel et al. (2015): a three-part model that matters for analysis:
  1. **interoceptive accuracy** — objective precision (heartbeat counting, for
     example);
  2. **interoceptive sensibility** — one's own rating of one's sensitivity (the
     MAIA and BPQ questionnaires);
  3. **interoceptive awareness** — the metacognitive match between the two.

  The diary measures only sensibility (2), and awareness (3) indirectly through
  `affect.word_confidence`. Accuracy (1) **cannot be measured** by a diary; draw
  no conclusions about it.
- Khalsa et al. (2018): a consensus review of interoception in psychiatry.
- Interoceptive training: Price & Hooven (2018), MABT, a body-awareness therapy
  based on mindfulness; randomised trials of moderate quality [B].
- A questionnaire for a periodic outside measurement (every 3–6 months): MAIA-2
  (Mehling et al., 2018).

### 2.4 Body maps → `body.locations` [B]

- Nummenmaa et al. (2014, _PNAS_, Bodily maps of emotions): topographies that
  hold across cultures. Fear and anxiety: the chest and upper body. Anger: the
  arms, head and chest. Sadness: less activation in the limbs. Depression: an
  overall "switching off".
- For analysis: the spread of zones by valence or by word can be compared with
  these maps as a prior expectation. A mismatch is not an error; it is data.

### 2.5 Somatic markers → the case for the whole idea [B]

- Damasio (1994, _Descartes' Error_); Bechara et al. (1997), the Iowa Gambling
  Task.
- Bodily signals take part in decisions before they reach awareness. Criticism:
  Dunn, Dalgleish & Lawrence (2006) find the evidence weaker than the popular
  version. The general idea (the body informs choice) holds; the details of the
  mechanism do not.
- Relevance: `urge` records a tendency to act, the closest available correlate
  of a "marker".

### 2.6 Action tendencies → `urge` [A/B]

- Frijda (1986): an affective state as readiness to act (action readiness).
- Lang (1995): motivational systems of approach and avoidance.
- The `urge` list (leave, shrink, freeze, move, hit, cry…) maps directly onto
  fight, flight and freeze, plus approach. It is useful precisely because an
  urge is often read earlier and more easily than a named state.

### 2.7 Alexithymia → "nothing", "don't know", "can't tell" [A]

Fields: `body.qualities`, `affect.word`.

- Sifneos (1973) coined the term. Bagby, Parker & Taylor (1994): TAS-20, with
  three factors: difficulty identifying feelings (DIF), difficulty describing
  feelings (DDF) and externally oriented thinking (EOT).
- Thinking that is mostly operational and turned outward is exactly the
  described pattern of living "outside oneself": attention held on tasks and the
  world rather than on inner states. EOT shows up in `head_mode`.
- Valid "nothing" and "don't know" answers are **mandatory**. Without them a
  person with alexithymia picks a random word, and the data looks better than it
  is.
- Outside measurement: TAS-20 at the start and every 6 months. Expected change:
  lower DIF and DDF.
- About half of autistic adults have alexithymia (Kinnaird, Stewart &
  Tsakanikos, 2019, a meta-analysis). Where this applies, the trajectory and the
  expectations differ (§6).

### 2.8 Levels of emotional awareness → how the fields are ordered [B]

- Lane & Schwartz (1987), the Levels of Emotional Awareness Scale (LEAS). The
  ladder: (1) bodily sensations, (2) action tendencies, (3) single named states,
  (4) blends of them, (5) blends in oneself and in someone else.
- The record's fields sit on exactly this ladder: `body.*` (1), `urge` (2),
  `affect.word` (3). Several words or qualities in one entry mark a step up to
  level 4.

### 2.9 Experiential avoidance → `head_mode`, no "why" [A]

- Hayes et al. (1996, 2006), ACT; the AAQ-II questionnaire (Bond et al., 2011).
- Avoiding inner experience through thinking, activity and analysis.
  Intellectualising is one form of it.
- Mind-wandering: Killingsworth & Gilbert (2010, _Science_), experience sampling
  with 2,250 people. About 47% of the time, attention is not on the current
  activity, and a wandering mind predicts lower happiness. `head_mode` is a
  direct analogue of their question.

### 2.10 Rumination and processing mode → no "why", a short `note` [A]

- Nolen-Hoeksema (1991, 2008): rumination as a factor in depression.
- Watkins (2008): constructive and unconstructive repetitive thought. The
  **abstract** mode ("why is this happening to me", "what does it mean") does
  harm; the **concrete** mode ("what exactly, where, how") is neutral or helps.
- Kross & Ayduk (2011, 2017): self-distancing. Asking "why" from an immersed
  position intensifies affect without processing it.
- Hence the note turns away causes and meanings ("because", "means", "due to",
  "that's why") and abstract-mode questions ("why", "what's wrong with me"), and
  the form asks "what and where", never "why". Hedges ("probably", "I think",
  "it seems") are not the abstract mode but caution, close to
  `affect.word_confidence = guess` and to the distanced stance of ACT; they are
  not turned away ("thinking about the deadline" is a fact about attention). The
  validator itself: ui.md §8.

### 2.11 Affect labelling → why the diary is itself an intervention [A]

- Lieberman et al. (2007): naming affect lowers amygdala activity and raises
  ventrolateral prefrontal activity. Torre & Lieberman (2018), a review: the
  effect is robust and works as implicit regulation.
- Pennebaker (1997), expressive writing. **Not used as a model**: its protocol
  is long narratives with meanings and causes, which works against this purpose
  (§2.10). Only the finding is taken: putting affect into words regulates it.

### 2.12 Titration and somatic approaches → 60 seconds, small doses [C]

- Levine (1997, 2010), Somatic Experiencing: titration, pendulation, the window
  of tolerance (Siegel's term, 1999). Ogden (2006), Sensorimotor Psychotherapy.
- Gendlin (1978), Focusing and the "felt sense": the list of qualities (heavy,
  lump, tight…) comes from this tradition.
- The experimental base is weak; randomised trials of SE are few and small. It
  serves as a source of a **safety procedure** (do not flood) and of vocabulary,
  not as scientific grounds. A partial dose is still a dose: a check-in may stop
  at any step and keep what was answered (`data.md` §4).

### 2.13 Schema therapy → the "detached protector" as a clinical frame [B]

- Young, Klosko & Weishaar (2003). The Detached Protector mode: chronic
  disconnection from inner experience as protection, with the Emotional
  Deprivation schema as a typical root.
- Questionnaires: YSQ-S3, SMI. Not needed to analyse the diary; relevant for a
  therapist.

### 2.14 Motivational design → no streaks, no achievements [A]

- Deci & Ryan, Self-Determination Theory: external rewards undermine intrinsic
  motivation (Deci, Koestner & Ryan, 1999, a meta-analysis).
- For a person with a perfectionist, "in the head" mode, streaks turn the
  practice into one more task to complete, which reproduces the avoidance.

---

## 3. What was deliberately left out

| Left out                                  | Why                                                                                                                                                                                |
| :---------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PANAS and similar lists of 20 adjectives  | Long; demands distinctions that are not there yet; invites random picks                                                                                                            |
| Emoji faces and mood trackers             | A label instead of the body; low granularity gets locked in                                                                                                                        |
| Polyvagal theory (Porges) as a foundation | Popular in somatic circles, but its key neurophysiological claims are not supported (Grossman & Taylor, 2007; Grossman, 2023). The "ventral" and "dorsal" vocabulary is never used |
| HRV and wearable sensors                  | They put exteroception in place of interoception. In Garfinkel's terms sensibility is not accuracy, and sensibility is what needs training                                         |
| Cognitive columns (the ABC form of CBT)   | They add a layer of thinking about thinking                                                                                                                                        |

---

## 4. Field, basis, metric

What each field of the export rests on, and what to compute from it.

| Field                              | Basis                                                                          | What to compute                                                                                            |
| :--------------------------------- | :----------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `trigger`                          | ESM / EMA (§1.1)                                                               | the share of `manual` by week                                                                              |
| `skipped`, the gaps                | EMA compliance (§1.1, §5.3)                                                    | % answered; the pattern of gaps by time of day, day of week and context                                    |
| `latency_sec`                      | an indirect measure of what access costs, like reaction time in implicit tasks | the weekly median; its spread; latency by valence (longer towards the negative?)                           |
| `body.locations`                   | Nummenmaa (§2.4)                                                               | zone frequencies; zones × word; zones × valence                                                            |
| `body.qualities`                   | the Focusing and SE vocabulary (§2.12); LEAS level 1 (§2.8)                    | the number of distinct qualities; the share of "nothing" and "can't tell"                                  |
| `body.intensity`                   | none of its own                                                                | the correlation with `arousal`: expected positive; its absence marks a split between body and affect       |
| `affect.valence`, `affect.arousal` | Russell (§2.1)                                                                 | the distribution; dynamic metrics (§5.2)                                                                   |
| `affect.word`                      | granularity (§2.2); LEAS level 3                                               | distinct words; entropy; the share of level-2 against level-1 words; the share of `empty` and "don't know" |
| `affect.word_confidence`           | interoceptive awareness (§2.3)                                                 | the share of `sure`; its change over time                                                                  |
| `urge`                             | Frijda (§2.6); LEAS level 2                                                    | the distribution; `urge` × `valence`                                                                       |
| `head_mode`                        | avoidance and mind-wandering (§2.9)                                            | the mean; its correlation with latency and with "nothing"                                                  |
| `context_tag`                      | EMA context sampling                                                           | every metric above, split by context                                                                       |
| `note`                             | Watkins, the concrete mode (§2.10)                                             | nothing: it is not analysed by numbers; it is material for therapy sessions                                |

Use active time (`latency_sec − hidden_sec`) where time spent away from the app
would otherwise read as slow answering (`data.md` §3.1).

---

## 5. Notes for analysis

### 5.1 Stand-ins for granularity with one word per entry

The classic ICC method does not apply. Options:

- **Distinct words** in a window (a week, a month). Crude, but transparent.
- **Shannon entropy** of the word distribution in a window: H = −Σ pᵢ log pᵢ.
  Normalise by log(number of entries), or it grows with the amount of data.
- **The share of level-2 words** (the finer ones) among all chosen words.
- **Conditional granularity**: the number of different words within one
  (valence, arousal) cell. If (−2, 7) is always "anxiety", it is low; if
  "annoyance", "shame" and "wariness" turn up there too, it is growing.
- Optional, and not before 6 months: extend the form to 4–6 ratings for the
  words within a cluster, then compute the classic ICC.

### 5.2 Dynamic affect metrics [A]

- **Inertia** (emotional inertia): the lag-1 autocorrelation of `valence`
  (Kuppens, Allen & Sheeber, 2010). High inertia goes with depression and
  rigidity. As the channel recovers, inertia is expected to **fall**: the state
  starts responding to context.
- **Instability**: the MSSD or RMSSD of consecutive values (Jahng, Wood & Trull,
  2008). Caution: entries are unevenly spaced, so use interval-adjusted
  variants, or only pairs of entries within one day.
- **Variability**: the within-person SD. A rise in SD early on is normal and
  expected (a signal appears); do not read it as getting worse.
- Separate **within-day** and **between-day** variance (a multilevel model:
  entries within days within weeks). For one person this is an ordinary
  two-level model, or simply aggregating by day.

### 5.3 Gaps are not random

Fields: `skipped`, `stopped_at`; in the reminder journal `reminder_id`,
`status`, `reason` (`data.md` §6).

- In EMA, gaps fall more often on moments of strong affect or heavy load
  (missing not at random). Here a gap is also a likely marker of an avoidance
  episode.
- Analyse the pattern of gaps itself: time of day, day of week, the entry before
  (a gap after a negative entry?), context.
- **Do not impute.**
- The cancellation reason in the reminder journal (`reason`) separates technical
  gaps from a person's: `overdue` (the server was down) and `settings` (the
  window changed) are not gaps; `tz_change` is a move; `no_device` means
  notifications were off on every device (data about load too, but not a missed
  signal). Unanswered means `sent` with no entry carrying that `reminder_id`.
  Cancelled rows written before the reason was recorded carry none.
- A planned pause in reminders (a day, three days, a week) is an honest,
  analysable gap, not notifications quietly switched off. Moments that fall into
  a pause stay in the reminder journal as `paused`. They count neither as
  answers nor as gaps; analyse them separately, since the pause itself is data
  about load and avoidance.
- A partial entry ("Stop here", or a form left with some answers; `stopped_at`)
  counts as a gap for compliance, and its answered fields are observed data, not
  imputation: they are never filled up to a full entry.

### 5.4 Progress, and what only looks like it

The expected course by phase, qualitative, from clinical descriptions [C]:

1. **0–2 months**: many "nothing" and "don't know" answers, high latency, high
   `head_mode`.
2. **2–6 months**: fewer "nothing" answers, more negative and more intense
   entries — **not getting worse** but access appearing. SD rises. Gaps may rise
   too, as avoidance pushes back.
3. **6–12 months**: positive valence appears; more distinct words, more manual
   check-ins, lower latency, lower inertia.
4. **Later**: entries with several words or qualities at once (LEAS level 4).

Artefacts not to mistake for an effect:

- **Regression to the mean** in the first weeks.
- **Learning the interface**: latency also falls simply as the form becomes
  familiar. Check: latency by type of answer ("nothing" against a specific word)
  should diverge if access is what changed, not familiarity.
- **Season and day of week**: valence on a Monday against a Saturday. Compare
  week with week, not day with day.
- **Time-of-day bias**: random signals should cover the whole waking window
  evenly; check that they do. Every hour of the window is drawn equally often
  when the window holds "number of reminders × the gap between them" (6 hours
  for three, 2 hours apart). A narrower window draws the first and last hours
  more often, and the skew is strong: in a 5-hour window the second and fourth
  hours are never drawn. Reminders planned before 2026-10-10 drew the first and
  last hours about a third more often than the middle in every window. Compare
  time-of-day shares within one period and one window setting.
- **Changes to the instrument's wording**: questions and pole labels are part of
  the measurement. Every entry stores its wording version (`ui.copy`; no field
  means version 1) and the layout it was answered in (`ui.layout`; no field
  means unknown). Compare slider values, words and `untouched` within one
  version and one layout only (`data.md` §3.6), and do not count a shift at a
  version boundary as an effect. Version 2 made the arousal poles neutral, which
  may weaken the link between valence and arousal.

### 5.5 Minimum amounts

- At least ~12–15 entries a week for weekly aggregates.
- At least ~60–100 entries for autocorrelation or MSSD, using only pairs less
  than 8 hours apart.
- At least 8 weeks in each phase to compare before and after.
- n ≥ 100 entries for correlations between fields (intensity × arousal, say);
  fewer make the confidence intervals useless.

### 5.6 Outside anchors, not from the diary

To check that the diary's metrics reflect anything at all, every 3–6 months:

- TAS-20 (alexithymia): DIF and DDF expected to fall.
- MAIA-2 (interoceptive sensibility): Noticing, Emotional Awareness and Body
  Listening expected to rise.
- AAQ-II (avoidance): expected to fall.
- If needed, PHQ-9 / GAD-7 as a check that the rise of negative entries in phase
  2 has not turned into clinical depression or anxiety.

All four are freely available and take 10–15 minutes together.

---

## 6. Limits of the whole design

- **N = 1.** This is an idiographic study: every conclusion is about change
  within one person. Norms (how many words there "should" be) do not apply.
- **Skill and state are mixed** (§1.2): is a rise in recorded negative affect a
  rise in negative affect, or in the ability to notice it? The diary cannot
  tell. Only outside anchors and clinical context can.
- **If neurotype is the leading factor** (autism, or marked alexithymia as a
  trait), the goal shifts from "restoring access" to "building an explicit
  system of translation": body, then words, then action. The metrics stay the
  same; the expected pace and ceiling differ, and the share of
  `affect.word_confidence = guess` may stay high, which is normal.
- **The diary does not replace a therapist.** Somatic and affect-focused
  approaches (ISTDP, SE, EFT, schema therapy) rely on co-regulation in contact,
  which data cannot reproduce. The diary is a tool between sessions and a source
  of material for them.

---

## 7. Key references

- Bagby, Parker, Taylor (1994). The twenty-item Toronto Alexithymia Scale. _J
  Psychosom Res_.
- Barrett (2006). Solving the emotion paradox. _Pers Soc Psychol Rev_.
- Barrett (2017). _How Emotions Are Made_.
- Barta, Tennen, Litt (2012). Measurement reactivity in diary research. In
  _Handbook of Research Methods for Studying Daily Life_.
- Bond et al. (2011). AAQ-II. _Behav Ther_.
- Craig (2002). How do you feel? _Nat Rev Neurosci_; (2009) _Nat Rev Neurosci_.
- Csikszentmihalyi, Larson (1987). Validity and reliability of the
  Experience-Sampling Method. _J Nerv Ment Dis_.
- Damasio (1994). _Descartes' Error_.
- Deci, Koestner, Ryan (1999). A meta-analytic review of experiments examining
  the effects of extrinsic rewards on intrinsic motivation. _Psychol Bull_.
- Dunn, Dalgleish, Lawrence (2006). The somatic marker hypothesis: a critical
  evaluation. _Neurosci Biobehav Rev_.
- Frijda (1986). _The Emotions_.
- Garfinkel et al. (2015). Knowing your own heart. _Biol Psychol_.
- Gendlin (1978). _Focusing_.
- Grossman, Taylor (2007). Toward understanding respiratory sinus arrhythmia.
  _Biol Psychol_; Grossman (2023). Fundamental challenges and likely refutations
  of the five basic premises of the polyvagal theory. _Biol Psychol_.
- Hayes et al. (1996). Experiential avoidance and behavioral disorders. _J
  Consult Clin Psychol_; Hayes et al. (2006). Acceptance and Commitment Therapy:
  model, processes and outcomes. _Behav Res Ther_.
- Jahng, Wood, Trull (2008). Analysis of affective instability in ecological
  momentary assessment. _Psychol Methods_.
- Kashdan, Barrett, McKnight (2015). Unpacking emotion differentiation. _Curr
  Dir Psychol Sci_.
- Khalsa et al. (2018). Interoception and mental health: a roadmap. _Biol
  Psychiatry CNNI_.
- Killingsworth, Gilbert (2010). A wandering mind is an unhappy mind. _Science_.
- Kinnaird, Stewart, Tsakanikos (2019). Investigating alexithymia in autism: a
  systematic review and meta-analysis. _Eur Psychiatry_.
- Kross, Ayduk (2017). Self-distancing. _Adv Exp Soc Psychol_.
- Kuppens, Allen, Sheeber (2010). Emotional inertia and psychological
  maladjustment. _Psychol Sci_.
- Lane, Schwartz (1987). Levels of emotional awareness. _Am J Psychiatry_.
- Levine (2010). _In an Unspoken Voice_.
- Lieberman et al. (2007). Putting feelings into words. _Psychol Sci_; Torre,
  Lieberman (2018). _Emotion Review_.
- Mehling et al. (2018). MAIA-2. _PLoS ONE_.
- Nolen-Hoeksema, Wisco, Lyubomirsky (2008). Rethinking rumination. _Perspect
  Psychol Sci_.
- Nummenmaa et al. (2014). Bodily maps of emotions. _PNAS_.
- Ogden, Minton, Pain (2006). _Trauma and the Body_.
- Price, Hooven (2018). Interoceptive awareness skills for emotion regulation
  (MABT). _Front Psychol_.
- Robinson, Clore (2002). Belief and feeling: evidence for an accessibility
  model of emotional self-report. _Psychol Bull_.
- Russell (1980). A circumplex model of affect. _J Pers Soc Psychol_; Russell,
  Barrett (1999). _J Pers Soc Psychol_.
- Shiffman, Stone, Hufford (2008). Ecological Momentary Assessment. _Annu Rev
  Clin Psychol_.
- Sifneos (1973). The prevalence of "alexithymic" characteristics in
  psychosomatic patients. _Psychother Psychosom_.
- Tugade, Fredrickson, Barrett (2004). Psychological resilience and positive
  emotional granularity. _J Pers_.
- Watkins (2008). Constructive and unconstructive repetitive thought. _Psychol
  Bull_.
- Young, Klosko, Weishaar (2003). _Schema Therapy_.

---

## 8. What the app never does

The principles above, as rules every other document and the code follow:

| Never                                                                                   | Because             |
| :-------------------------------------------------------------------------------------- | :------------------ |
| Ask "why", or record causes, meanings, conclusions or stories                           | §2.9, §2.10         |
| Treat "nothing", "can't tell", "don't know", "nowhere" or a skip as less than an answer | §2.7                |
| Show streaks, scores, badges, counts of missed reminders or congratulations             | §2.14               |
| Use emoji, mood faces or colour-coding of states                                        | §3                  |
| Impute a gap, or fill a partial entry up to a full one                                  | §5.3                |
| Edit a saved entry (re-interpretation); deleting is a tombstone only                    | §2.10, `data.md` §1 |
| Claim anything about interoceptive accuracy                                             | §2.3                |
| Use polyvagal vocabulary, wearable or sensor data                                       | §3                  |
| Present the app as treatment or as a replacement for a therapist                        | §6                  |
