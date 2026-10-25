<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — to do

Open work only, checked against the code. A finished item is deleted, not
ticked; its write-up is the commit. Ids are kept so code comments and notes can
cite them.

## 1. Before the first release

- **R1 · Translations still drafts.** `make release-check` fails while any
  dictionary label (128 now, `pendingReview()` in `shared/dictionaries.ts`) or
  glossary description (113, every one, `glossaryPendingReview()` in
  `shared/glossary.ts`) is marked pending. The owner reviews them, and the ru/uk
  UI strings in `shared/i18n/ui.{ru,uk}.ts`, which have no marker (`copy.md`
  §1). Gate: `shared/release_test.ts`.
- **R2 · CI not yet proven.** `.github/workflows/ci.yml` (`development.md` §6)
  has not run on GitHub yet: after the first push, check every job once (a `v*`
  tag for `release`, then make the `ghcr.io` package public).
- **M65 · No device timings.** `llm/perf_log.md` does not exist; the release
  checklist needs the first timings on the reference phones (performance.md §6).
  Only Lighthouse with simulated throttling runs (`make perf`, `perf/run.ts`).
- **M63 · No screen-reader pass.** `make e2e` runs axe-core and the 44 px check
  on every screen; the manual VoiceOver and TalkBack run of the full flow (ui.md
  §10 item 6) has not been done.

## 2. Spec deviations

- **S1 · No swipe inside the check-in.** ui.md §5.3: left → next, right → back,
  with the drag feedback and commit rules. `paneSwipe`
  (`client/src/lib/swipe.ts`) is used by `Home.svelte`, `History.svelte` and
  `Settings.svelte` only; `client/src/components/flow/CheckInFlow.svelte` has no
  pointer handling. Either wire `paneSwipe` (or a step variant) into the flow
  with an e2e like `e2e/paneswipe.e2e.ts`, or change the spec.
- **S2 · The privacy notice has no way home.** `client/public/privacy.html` has
  no brand link to `/`; `methodology.html` has one
  (`<a class="brand" href="/">`). The thumb-reach rules and the home link apply
  to the static pages too.

## 3. Data integrity

- **D1 · Tombstones are purged after 90 days.** `server/services/maintenance.ts`
  deletes entry tombstones 90 days after the deletion. A device that has not
  synced for longer never pulls that deletion, and after a restore a stale
  device can upload the deleted entry again (architecture.md §6.3, §8.4). Decide
  whether that is intended; then state it in api.md and reliability.md or keep
  tombstones.
- **D2 · A purge can reuse a `seq`.** `seq` is `MAX(seq)+1` per account; when
  the purged tombstone was the account's newest row, the next write gets its
  number again and devices whose cursor already stands there never pull it
  (api.md §2.6, "Known defect"). Fix with a per-account counter that never goes
  back, plus a test.

## 4. Missing tests

- **T1 · E2E smoke as specified.** No test installs the app, signs in, saves a
  check-in offline (`context.setOffline(true)`), comes online and sees it on a
  second context. Closest: `e2e/history.e2e.ts` ("an offline delete reaches the
  other tab and device"). Add it to `e2e/` and to the CI e2e job.
- **T2 · No visual snapshots.** Nothing compares screenshots (10 presets × 4
  steps × 3 languages); `make capture` only records. Add baseline comparison in
  `e2e/`, or drop the requirement.
- **T3 · String tests not written** (`copy.md` §8.1): every `{param}` a key
  takes appears in its output in all languages (call with sentinels like `⟨n⟩`);
  no UI string contains `https?://` (today only the mails are checked,
  `shared/i18n/mail_test.ts`); `push.title` equals the fixed text in each
  language. File: `shared/i18n/i18n_test.ts`.

## 5. Low

- **L1 · `home.sync.stale` is too long in ru/uk** for its one line (`copy.md`
  §6): use ru «Не синхронизировано сутки», uk «Не синхронізовано добу» in
  `shared/i18n/ui.{ru,uk}.ts`, and check at 320 px.
- **L2 · Stale plural type.** `PluralBase` in `shared/i18n/interpolate.ts` still
  lists `checkin.step.2.summary.chosen`, which is a plain key (it is rightly
  absent from `PLURAL_BASES`); remove it from the type.
