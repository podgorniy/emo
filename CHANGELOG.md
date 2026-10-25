<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Changelog

All notable changes, in the [Keep a Changelog](https://keepachangelog.com/)
format; versions follow [Semantic Versioning](https://semver.org/) as defined in
`llm/development.md` §7.1. Every migration has a line; a step an operator must
do by hand is marked **Manual step**.

## [Unreleased]

Nothing has been released yet; the first release will be 0.1.0 (`VERSION`).

### App

- Check-ins: nine steps — where in the body (a front/back figure), what it is
  like, how strong, unpleasant or pleasant, how charged, a word with how sure,
  an urge, where attention was, the situation with an optional one-line note.
  Every step has its null answers on screen, sliders wait for a touch and show
  no numbers, and nothing asks "why": the note refuses why-phrases. Stopping
  early saves the steps answered (`stopped_at`); Undo is offered on Saved and
  for 10 s on Home.
- Each entry records the instrument it was taken with (`ui`: controls, layout,
  theme, copy version), so answers can be compared within one wording.
- End-to-end encryption: entries, the draft and preferences are encrypted on the
  device under a key the server never sees, unlocked by a passphrase, with a
  recovery key (optionally mailed). Lock forgets the key on this device; Sign
  out also wipes the device's data.
- Offline first: everything is saved locally and synced in the background across
  devices; the sync dot explains its state on a tap. Installable as a PWA, with
  a "Check in now" shortcut and an update card.
- Reminders at three random moments a day (count and waking window configurable,
  evenly spread, pause for 1 day / 3 days / 1 week). A reminder is answered
  within 15 minutes of its notification; the log keeps unanswered, paused and
  cancelled moments with the reason, so gaps stay visible.
- Panes: Check-in, History and Settings, by swipe, ← / →, dots on a phone and
  tabs on a desktop. History lists this device's check-ins by day, opens a
  record read-only and deletes it. Settings: reminders, language, appearance,
  devices, data and keys, invites, words, about.
- Phone layout for the thumb: controls rest in the bottom third of the screen,
  sheets stand on the on-screen keyboard; desktop gets a wide layout with
  keyboard shortcuts.
- Ten themes, base colours and gradients for seven of them, "Match the system"
  (Calm by day, Dusk at night), light and motion effects with a still option;
  the measuring controls and the indigo highlight are the same in every theme.
- English, Ukrainian and Russian. Descriptions of every term from each step and
  in Settings → Words. The methodology at `/methodology` (offline too, without
  an account).
- Export: spreadsheet (CSV), JSON and an encrypted bundle readable offline with
  `emo decrypt-bundle`.
- Sign-in by emailed code; anyone may create an account unless the server is
  invite-only. Users can make invite codes and see how many joined.

### Operations

- Self-hosting with Docker: `make init DOMAIN=… EMAIL=…`, `make up` with
  built-in HTTPS (Caddy and Let's Encrypt, `COMPOSE_PROFILES=https`), or behind
  your own reverse proxy (`llm/ops.md`).
- Updates: `make update` on the server, `make deploy` / `make deploy-rsync` from
  your own machine; each backs up, restarts, smoke-tests and stops when new
  lines here mark a manual step. Images are tagged by commit for rollback;
  `make prune` keeps the newest three.
- `make cron`: nightly backups and, with `PING_URL`, a 5-minute health ping;
  `make backup-pull` copies snapshots off the host; `make verify-backup` drills
  a restore.
- Every operation is an `emo` subcommand (`invite`, `stats`, `mail-test`,
  `login-code`, `decrypt-bundle`, …), run with `make`; `make smoke SEND=1` sends
  a sample sign-in mail and shows the SMTP answer.
- **Manual step** for an operator who wants to keep a server invite-only: set
  `REGISTRATION=invite` in `.env` before updating. The default, `open`, lets
  anyone with an email create an account and mails a sign-in code to any address
  that asks (within the per-address and per-IP limits). `GET /api/instance`
  reports the mode as `registration`.

### Legal

- AGPL-3.0-or-later. The server offers the source of its exact build at
  `/source.tar.gz`, and `SOURCE_URL` defaults to it; set it only to link a
  repository instead.
- A built-in privacy notice in English, Ukrainian and Russian at
  `/privacy.html`; set `PRIVACY_NOTICE_URL=/privacy.html` to show it in About.

### Database migrations

- `001_initial`: the schema (accounts, sessions and the tombstones of deleted
  accounts' sessions, keyring revisions, login codes, invites and their uses,
  entries, prefs, reminders, push subscriptions, mail log, operational counters,
  meta and the migration ledger).
- `002_reminders_unique`: one reminder row per moment of a day's schedule.
- `003_reminders_visible_at`: the reminder pull pages on the time a row became
  visible to the client; replaces the `(account_id, updated_at)` index.
- `004_reminders_pause`: `accounts.reminders_paused_until`, the end of a
  reminder pause (`PUT`/`DELETE /api/settings/pause`); reminders planned during
  it get the status `paused`.
- `005_reminders_reason`: `reminders.reason`, why a cancelled reminder was never
  sent (`settings`, `overdue`, `no_device`, `tz_change`); empty on older rows.
