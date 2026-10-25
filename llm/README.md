<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — documentation (`llm/`)

The documents that describe Emo as built and how to work with it and on it. This
file holds the doc map, the order of precedence, the names and formats that
never vary, and the rules for editing these documents. Start here.

Emo is a self-hosted, end-to-end-encrypted PWA for 60-second body and affect
check-ins, with three random reminders a day. A Deno + Hono server with SQLite
stores only ciphertext; a Svelte 5 client does all the reading, encrypting and
writing on the device. The code lives beside this folder (root `README.md`).

## 1. Doc map

| File              | Owns                                                                                                                                                                                            | Read when                                                                   |
| :---------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| `methodology.md`  | Why every field exists; what the app must never do                                                                                                                                              | First, once. Nothing may contradict it                                      |
| `data.md`         | The entry payload, every field, dictionaries (keys; labels live in code), reminder journal, schema evolution                                                                                    | Before touching data, the form's answers, dictionaries or any stored format |
| `architecture.md` | Threat model, stack, accounts, keys and crypto, server tables, sync, reminders, export, localisation mechanics                                                                                  | Before any server, crypto or sync work                                      |
| `api.md`          | Every route, request and response, error envelope and codes, limits, rate limits, the seq/epoch contract                                                                                        | When implementing a route or client sync                                    |
| `ui.md`           | UI and behaviour: principles, navigation, Home, reach and layout, motion, check-in flow, body map, note field, desktop, accessibility, Settings, auth, appearance, themes, History pane, assets | Before any client work                                                      |
| `copy.md`         | Rules for UI strings: forbidden words, editorial splits, plurals, lengths, string tests                                                                                                         | When writing any UI, push or mail string                                    |
| `reliability.md`  | Failure modes, reminder edge cases, service worker, security headers, startup, test matrix                                                                                                      | While coding anything that can fail; before a release                       |
| `performance.md`  | Budgets, fonts, client runtime rules, dependency allowlist, SQLite rules, enforcement                                                                                                           | When adding a dependency, a font, a table or a query, or measuring          |
| `ops.md`          | Running an instance: install, config, upgrade and rollback, backup and restore, observability, secrets, administration                                                                          | When installing, upgrading or operating an instance                         |
| `development.md`  | Working on the code: dev setup, make targets, repo layout, tests, e2e, reach audit, perf, CI, release, versioning, licence headers, conventions                                                 | Before the first change to the code                                         |
| `todo.md`         | Open work only                                                                                                                                                                                  | When choosing what to do next                                               |

Reference images: `../design/*.png`. Prototype sources:
`../design/prototype/*.dc.html` — reference only, not production code. The
prototype uses inline `style="…"` attributes everywhere; production components
must not, because the CSP forbids inline styles (reliability.md §4.1).

## 2. Precedence when documents disagree

1. `methodology.md` — principles. Never overridden.
2. Data: `data.md`. Dictionary keys live only in `shared/dictionaries.ts` and
   are listed in `data.md` §5.
3. UI and behaviour: `ui.md`; UI strings: `copy.md`.
4. Architecture and crypto: `architecture.md`.
5. Routes, limits, error codes: `api.md`. A code used anywhere else must exist
   there.
6. Failure behaviour, headers, service worker: `reliability.md`.
7. Operational procedure: `ops.md`.
8. Developer workflow: `development.md`.
9. For data the code owns — UI copy (`shared/i18n/keys.ts` and
   `shared/i18n/ui.*.ts`), dictionary labels (`shared/dictionaries.ts`),
   descriptions (`shared/glossary.ts`), theme presets (`shared/theme/`),
   protocol types (`shared/protocol.ts`) — the code wins over any document.
   Elsewhere, when a document and the code disagree, find out which is wrong and
   fix it in the same change.

## 3. Fixed names and formats

The identifier `emo` in encryption labels, headers, binary and file names is
permanent: changing it would make existing data unreadable. The display name is
a UI string and can change without touching data. Rows marked **permanent**
cannot change once a real entry has been written.

| Thing                                                     | Value                                                                                                                                                                                                                       |
| :-------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product / manifest name                                   | `Emo`                                                                                                                                                                                                                       |
| AAD strings (**permanent**)                               | `emo-keyring/v1`, `emo-entry/v1`, `emo-prefs/v1`, `emo-draft/v1` (`shared/crypto/constants.ts`), each followed by the ids named in architecture.md §5                                                                       |
| AAD encoding (**permanent**)                              | Parts joined with a `0x00` byte; `key_version` written as a decimal string (architecture.md §5.5)                                                                                                                           |
| HKDF `info` strings (**permanent**)                       | `emo-auth/v1` (auth key from the DEK), `emo-recovery/v1` (KEK from the recovery secret); recovery checksum prefix `emo-recovery-check/v1`                                                                                   |
| Recovery key (**permanent**)                              | 128 random bits + 32-bit checksum = 32 Crockford base32 characters, shown as 8 groups of 4; `KEK_recovery = HKDF-SHA256(s, account_id, "emo-recovery/v1")` (architecture.md §5.1)                                           |
| Entry ids (**permanent**)                                 | UUID v4 (`crypto.randomUUID()`); the server rejects other versions, because a time-ordered id would reveal when the entry was written                                                                                       |
| Plaintext padding (**permanent**)                         | Entries and the draft: canonical JSON padded with ASCII spaces to a multiple of 2048 bytes, so every entry has the same size and the server cannot tell skipped entries or note length (architecture.md §5.5)               |
| Entry schema (**permanent**)                              | `schema_v: 2` is the first released version; v1 was a draft and was never written, so there is no v1 reader (`data.md` §8.1)                                                                                                |
| Push notification                                         | `tag: "emo"`; `Topic: emo`, `TTL: 1800` (30 min), `Urgency: high` — a newer reminder replaces an undelivered one                                                                                                            |
| Session cookie                                            | `emo_session`                                                                                                                                                                                                               |
| HTTP headers                                              | `X-Emo-Client`, `X-Emo-Server` (semver from `VERSION`), `X-Emo-Epoch` (database epoch), `X-Emo-Auth` (proof of DEK possession), `X-Emo-Account` (the account this device holds), `X-Emo-Dry-Run` (smoke test only)          |
| Binary / image / compose service / DB file                | `bin/emo` (`/emo` in the image), `emo`, `emo`, `emo.sqlite`                                                                                                                                                                 |
| Base image                                                | `gcr.io/distroless/cc-debian12:nonroot` — no shell, no `sqlite3`, no `curl`; every operation is an `emo` subcommand (ops.md §1.1)                                                                                           |
| Recovery file / export bundle                             | `emo-recovery-YYYY-MM-DD.txt` / `emo-bundle-YYYY-MM-DD.json` (`format: "emo-bundle"`, architecture.md §10.1)                                                                                                                |
| Web Locks / channel                                       | `emo-sync`, `emo-draft`; `BroadcastChannel('emo')` (one channel, typed messages)                                                                                                                                            |
| IndexedDB database                                        | `emo` (`data.md` §8.3)                                                                                                                                                                                                      |
| Locales                                                   | `en`, `ru`, `uk` (BCP 47; never `ua`)                                                                                                                                                                                       |
| Licence                                                   | `AGPL-3.0-or-later`, SPDX header in every source file; "Source code" link in Settings → About: the running build's own archive (`/source.tar.gz`) unless `SOURCE_URL` names a repository (ops.md §2.4, development.md §7.3) |
| Measurement highlight                                     | `#4F46E5` on light grounds, `#8EA2FF` on dark — identical in every theme (ui.md §1.7)                                                                                                                                       |
| Measurement controls                                      | Slider · 2-column grid in dictionary order · chips for word level 2 · solid body figure without labels · certainty buttons — identical in every theme (ui.md §1.11, ui.md §14.1)                                            |
| Forbidden words (whole word, any UI, push or mail string) | en mood, emotion, feeling · ru настроение, эмоция, чувство · uk настрій, емоція, почуття (`shared/i18n/forbidden.ts`; inflected forms: copy.md §8.2)                                                                        |
| Default crisis link                                       | `https://findahelpline.com` (`CRISIS_URL`, ops.md §2.4)                                                                                                                                                                     |

## 4. Invariants

Rules that are easy to break by accident. Each is specified in full where the
reference points.

- A destructive action — keyring change, account deletion, entry deletion —
  needs `X-Emo-Auth` = HKDF(DEK); a session alone cannot wipe or lock out an
  account. Keyring revisions are append-only (architecture.md §5.3, api.md
  §2.3).
- Lock = forget the DEK and auth key on this device, keep everything else. Sign
  out = end the session **and** wipe this device's local data, after confirming
  unsynced entries (architecture.md §4.3).
- Account deletion is immediate, with no grace period, and needs the DEK proof;
  backup retention (`KEEP`, 30 days) is how long a deleted email can survive in
  backups (architecture.md §4.5, architecture.md §10.3).
- Other devices of a deleted account get `401 account_gone`, from session hashes
  kept 90 days in `gone_sessions` (no account id) (api.md §2.5).
- The form draft on disk is encrypted with the DEK and padded like entries; no
  plaintext answers on disk (ui.md §6.4).
- An untouched slider saves its midpoint **and** its name in `untouched`
  (`data.md` §3.6).
- `latency_sec` is wall time; `hidden_sec` is the part the app was hidden
  (`data.md` §3.1).
- Uploading a deleted entry returns `410 entry_deleted`; the client drops it,
  never re-uploads it under a new id (api.md §2.6).
- A restore changes the database epoch; clients then re-upload everything they
  hold (architecture.md §8.3, ops.md §4.3).
- Clients receive only reminders whose time has passed; future times never leave
  the server (api.md §2.8).
- Only the process holding the scheduler lease sends reminders, so a second
  container cannot double-send (architecture.md §9.1).
- A settings change mid-day cancels today's planned reminders outside the new
  window or over the new count (`reason: settings`); nothing new is generated
  until tomorrow (architecture.md §9.1, reliability.md §2.3).
- Login: mail is sent asynchronously; every verify failure looks the same; a new
  code invalidates older ones; 10 failed verifications per email per 24 h
  (api.md §2.1, api.md §1.3).
- Accepted trade-off: someone who knows an email can block **new** sign-ins for
  it for 24 h; existing sessions and local check-ins are unaffected; the
  operator can issue a code by hand (api.md §1.3).
- For 5 minutes after a failed send, every code request gets the same
  `503 mail_unavailable`, so an outage does not reveal which emails have
  accounts (api.md §2.1).
- `tz` and `locale` are sent when the code is checked; the invite is stored with
  the login code, so the client does not resend it. Sign-up is open unless
  `REGISTRATION=invite` (api.md §2.1).
- Passphrase: printable ASCII only (`[\x20-\x7E]`), at least 8 characters; the
  strength meter informs and never blocks (architecture.md §4.1).
- `426 upgrade_required` on a major-version mismatch, or when the client is more
  than one minor version behind (reliability.md §3).
- One SQLite connection per process; no `await` inside a transaction
  (performance.md §4.1).
- No error-report endpoint: users "Copy diagnostics" (content-free) and send it
  to the operator (reliability.md §1.8).
- The note validator hard-blocks why-phrases; content-free counters
  (`note.rejected`, `note.rejected_resolved`, `note.rejected_cleared`) show
  whether it should become a hint (ui.md §8.2, reliability.md §1.8).
- `script-src` allows `'wasm-unsafe-eval'` (Argon2 WASM); the dev server runs
  without the CSP header (reliability.md §4.1).
- Admin fallbacks: `emo login-code`, `emo account-delete`, `emo keyring-revert`
  (ops.md §7).
- New-device download: the ≤ 3 s budget covers processing only; transfer is
  listed separately (≈ 8.5 MB, about 35 s on slow 3G for 3 000 entries)
  (performance.md §1.2).
- Safety and legal text lives in Settings → About (also reachable from the
  sign-in screen): not a medical device, the methodology (`/methodology`), not a
  replacement for a therapist, the crisis link, what the server can see, the
  operator's privacy notice and contact, source code (ui.md §11, copy.md §2.1,
  ops.md §2.6).

## 5. Editing these documents

- **Describe the system as it is**, in the present tense. No version lines, no
  change notes, no decision dates, no "previously" or "no longer". History is
  git and `CHANGELOG.md`.
- **A rule lives in exactly one file.** Other files link to it as `file.md §N`
  (`ui.md §4.1`) and never restate it.
- **Where the code owns the data** (copy, labels, presets, protocol types),
  state the rule and point to the file; do not copy tables out of the code.
- Number sections fresh (`## 1.`, `### 1.1`), without gaps. When a section moves
  or is renumbered, fix every link to it, in documents and in code comments.
- **All documents are in English.** Russian and Ukrainian appear only as data:
  dictionary labels, forbidden words, stop-phrases.
- **New dictionary key:** append it in `shared/dictionaries.ts` with en/ru/uk
  labels and `review: "pending"`, and add the key to `data.md` §5. Never rename
  or delete an existing key (`data.md` §8.2).
- **New error code:** add it to `api.md` and to the `ErrorCode` union in
  `shared/protocol.ts` first, then its message to the UI copy (copy.md §2).
- **A methodology change** is made in `methodology.md` and in
  `client/public/methodology.html`, in all three languages.
