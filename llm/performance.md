<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — performance

Budgets, fonts, client runtime rules, the dependency allowlist, SQLite and
server rules, and how they are enforced and measured. A change that breaks a
number in §1 is a regression and blocks the merge, unless this file is updated
in the same change with a reason.

---

## 1. Targets

Reference devices and network:

| Name            | Device                                      | Network                                                           | Why                                                      |
| :-------------- | :------------------------------------------ | :---------------------------------------------------------------- | :------------------------------------------------------- |
| **Android-ref** | Pixel 3a class (Snapdragon 670, 4 GB)       | Lighthouse "Fast 3G" (1.6 Mbps down, 150 ms RTT), 4× CPU slowdown | The realistic low end of what a user installs the PWA on |
| **iOS-ref**     | iPhone XR (A12), iOS ≥ 16.4, standalone PWA | the same throttling via a proxy where possible                    | The oldest iOS that supports web push                    |
| **Desktop**     | any laptop, Chrome / Firefox / Safari       | no throttling                                                     | Secondary; must not regress but has no separate budget   |

Every time in §1.2 is the **p75** over at least 5 runs on the reference device,
measured as in §6.

### 1.1 Size

The gzip budgets marked **gated** are in `perf/budgets.json` and checked by
`perf/check_budget.ts` on every `make build` (§5).

- **App shell JS, initial (gzip): ≤ 120 KB, gated.** Every entry chunk and what
  it imports statically: Home and step 1 with English strings and the theme
  presets. Settings (with Appearance and Devices), History and its record, the
  auth screens, export, the glossary, the passphrase word list, the moving
  background and the ru/uk strings are lazy chunks.
- **Any single lazy chunk (gzip): ≤ 60 KB, gated.** Every `.js` chunk outside
  the shell, unless it has a budget of its own (`<name>_chunk_gzip_kb`).
- **History pane chunk (gzip): ≤ 8 KB, gated.** ui.md §15.12. The open record's
  code is a second chunk, `HistoryRecord` ≤ 4 KB (gated), fetched with the first
  rows.
- **Moving background (gzip): lazy budget (≈ 1.7 KB).**
  `client/src/components/common/Aura.svelte` + `lib/aura.ts` (ui.md §13 item
  5a); loaded when idle on a screen that shows it, never for Ink, Mono, Paper.
- **Glossary chunk (gzip): lazy budget.** `shared/glossary.ts`, every
  description in en, ru and uk (ui.md §6.5); never in the shell: loaded only
  through `client/src/lib/help.ts` `import()`; precached.
- **Passphrase word list (gzip): lazy budget (≈ 22 KB).**
  `client/src/lib/passphraseWords.ts`, fetched on the "Suggest a passphrase" tap
  only.
- **CSS, initial (gzip): ≤ 20 KB, gated.** Tokens and components; a theme is CSS
  variables, not a CSS file.
- **`hash-wasm` Argon2: lazy budget.** Its WASM is inlined in its own lazy
  chunk, loaded only by the KDF Worker on passphrase screens.
- **Total SW precache (raw): ≤ 1.2 MB, gated.** Every build file (shell, lazy
  chunks, icons, the built-in pages `privacy.html` and `methodology.html`, so
  they open offline) plus the default theme's fonts (§2).
- **Fonts per theme: ≤ 350 KB.** §2.3; `tools/gen_fonts.ts` fails above it.
- **`manifest.webmanifest` icons: ≤ 60 KB total, gated.** `icon-*`,
  `apple-touch-*`, `badge-*` PNGs in the build.
- **`deno compile` binary: ≤ 140 MB uncompressed.** The Deno runtime dominates;
  informational, not a gate.
- **Docker image: ≤ 200 MB.** `gcr.io/distroless/cc-debian12:nonroot` + the
  binary; informational.

The last `make perf` table is in `perf/report/summary.md`.

### 1.2 Time — client

- **Cold start → interactive Home: ≤ 2.0 s Android-ref, ≤ 1.5 s iOS-ref.** First
  visit, empty cache, TTI on Home with the Now button focusable.
- **Warm start → Home: ≤ 600 ms Android-ref, ≤ 500 ms iOS-ref.** Installed PWA,
  SW cache hit, theme applied before the first paint (no flash).
- **Now tap → step 1 painted: ≤ 150 ms Android-ref, ≤ 120 ms iOS-ref.** Includes
  the body-map SVG; the state machine is already in memory.
- **Step transition: ≤ 16 ms JS on both.** The new step is final and interactive
  in the tap's frame; then a 180 ms compositor-only arrival (transform, no
  opacity) that never delays input: + 0 s to `latency_sec` (ui.md §5.1; < 0.2 ms
  of script); no layout thrash.
- **Save (payload → encrypt → IDB write → "Saved"): ≤ 50 ms Android-ref, ≤ 40 ms
  iOS-ref.** Excludes the network; `sync()` is fire-and-forget.
- **Argon2id unwrap (m = 64 MiB, t = 3): ≤ 2.5 s Android-ref, ≤ 1.2 s iOS-ref.**
  In a Worker; the UI shows progress. Rule in §3.1 if exceeded.
- **Full pull of 3 000 entries — processing: ≤ 3 s on both.** Parse + IDB writes
  for 6 pages × 500, network **unthrottled**, no decryption. Transfer is
  separate: each entry is ≈ 2.8 KB of base64 (a fixed 2 064-byte blob,
  architecture.md §5.5), so 3 000 entries ≈ 8.5 MB (≈ 6.5 MB gzipped) — about 35
  s on Fast 3G. Home and the check-in stay usable during the pull (they need no
  history); the new-device screen shows `auth.newDevice.downloading` progress.
  The epoch re-upload after a restore has the same size and is measured, not
  gated.
- **Decrypt 3 000 entries (export): ≤ 2 s Android-ref, ≤ 1.5 s iOS-ref.** In
  memory, Worker allowed.
- **History open → first rows: ≤ 1 s / ≤ 2 s on both.** With 1 100 / 3 000
  entries: from the tap on the History dot or tab to the first rows painted,
  every entry decrypted (the `ts` sort needs them all, ui.md §15.12). The DOM
  holds only the rendered pages.
- **History: open a record: one frame on both.** The data is decrypted already;
  the record's chunk was fetched with the first rows.
- **Theme switch: ≤ 100 ms on both.** CSS variables + variant props; the form is
  not re-mounted; the new theme's fonts may still be loading (swap). The `fx`
  variables and the moving background's contrast guard add < 1 ms.
- **Settings pane open: ≤ 100 ms on both.** Its lazy chunk was prefetched on
  idle.
- **Moving background: 0 ms idle on both.** Drift is CSS keyframes on the
  compositor (0 ms of script a frame); script runs only while a lean settles (≤
  0.3 ms a frame); no frames at all after 20 s without input, while hidden, on
  History and Settings (a still picture), and under reduced motion; never
  mounted in the check-in or on Saved. Three 200 px layers scaled up (≈ 1.4 MB
  GPU each at DPR 3), no `filter` and no `backdrop-filter`.
- **Note validator per keystroke: ≤ 2 ms on both.** One precompiled regex.

### 1.3 Time — server

| Metric                                | Budget                         | Notes                                                                                                                                                                    |
| :------------------------------------ | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/entries/:id`                | ≤ 10 ms p95                    | A single insert, WAL                                                                                                                                                     |
| `GET /api/entries?since&limit=500`    | ≤ 30 ms p95                    | Indexed range scan + 500 × 2 064-byte blobs                                                                                                                              |
| Login code request                    | ≤ 30 ms p95                    | HMAC + insert + enqueue; the response does not wait for SMTP (`api.md` §2.1). The background send has a 10 s timeout                                                     |
| Scheduler tick                        | ≤ 200 ms p95 at design ceiling | The plan, send and expire steps (§4.3); `server/services/scheduler.bench.ts` measures a tick while 5 000 accounts start their day and a peak minute of 100 due reminders |
| `/healthz`                            | ≤ 5 ms                         | `SELECT 1` and the in-memory scheduler heartbeat                                                                                                                         |
| Startup incl. migrations (no pending) | ≤ 1 s                          |                                                                                                                                                                          |

### 1.4 Lighthouse (mobile, throttled, against the built binary)

| Category       | Minimum                                                                                                                                  |
| :------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| Performance    | ≥ 90                                                                                                                                     |
| Accessibility  | ≥ 90 (target 100; ui.md §10 is the checklist)                                                                                            |
| Best practices | ≥ 90                                                                                                                                     |
| PWA            | installable and offline-capable; Lighthouse 12+ has no PWA category, so `e2e/pwa.e2e.ts` and `e2e/legal.e2e.ts` (offline pages) cover it |

The minimums live in `perf/lighthouse.ts` (`MINIMUM`).

---

## 2. Fonts

### 2.1 Principle

Fonts are the largest asset class. A user sees **one** theme at a time. The
service worker precaches the **default theme's (Calm)** fonts with the build;
any other theme's fonts are fetched when that theme first uses them and kept in
the worker's font cache (`emo-fonts-<hash>`, cache-first), so they work offline
from then on (`reliability.md` §3).

### 2.2 Format and subsets

- woff2 only, self-hosted under
  `client/public/fonts/<family>/<family>-<subset>-<weight>[-italic].woff2` with
  each family's `OFL.txt`. `tools/gen_fonts.ts` vendors them from pinned
  `@fontsource` packages and writes `client/src/fonts.css`; run it after
  changing the manifest and commit the output. The file names are not hashed;
  the service worker's font cache is named after a hash of every font file of
  the build instead, so a changed font is fetched again and the old cache is
  dropped.
- Subsets: `latin` and `cyrillic` only. Every Ukrainian letter
  (`Ґ ґ Є є І і Ї ї`) is in the `cyrillic` block, so `cyrillic-ext` is not
  shipped.
- `unicode-range` on every `@font-face` (the packages' own ranges), so a
  Latin-only session never downloads the Cyrillic file.
- `font-display: swap` with a metric-adjusted local fallback per family
  (`size-adjust`, `ascent-override`, `descent-override`, computed with Capsize
  against Arial/Roboto, Times New Roman/Noto Serif or Courier New/Roboto Mono;
  `fontStack` in `shared/theme/fonts.ts`), so the swap shifts layout by no more
  than CLS 0.02.
- JetBrains Mono is in the manifest of the mono-label themes (Paper, Ink,
  Archive); elsewhere the recovery key and invite code UI loads it on demand.

### 2.3 Per-theme font manifest

Source of truth: `FONT_MANIFEST: Record<PresetId, FontFile[]>` in
`shared/theme/fonts.ts`, with `FontFile = { family, weight, style, subsets }`.
The precache list of the default theme's fonts is generated from it at build
time (`client/vite.config.ts`); nothing else may reference font files. Weights
are the ones the preset's `f.ui`, `f.display`, `f.displayWeight` and the
component specs use (ui.md §14.4: body 400, UI 500/600, heading =
`displayWeight`). Four early presets had Latin-only families; `FONT_MIGRATION`
replaces them so every preset has Cyrillic (ui.md §14.5).

Measured sizes of the shipped files (latin + cyrillic):

| Preset         | UI family / weights      | Display family / weights   | Mono               | Files | Size     |
| :------------- | :----------------------- | :------------------------- | :----------------- | :---- | :------- |
| calm (default) | Onest 400, 500, 600      | Onest 500 (shared)         | on demand          | 6     | ≈ 64 KB  |
| mono           | Golos Text 400, 500, 600 | Golos Text 700             | on demand          | 8     | ≈ 75 KB  |
| lavender       | Manrope 400, 500, 700    | Manrope 800                | on demand          | 8     | ≈ 85 KB  |
| paper          | Golos Text 400, 500      | Literata 400, 400 italic   | JetBrains Mono 400 | 10    | ≈ 126 KB |
| night          | Onest 400, 500, 600      | Unbounded 700              | on demand          | 8     | ≈ 98 KB  |
| ink            | IBM Plex Sans 400, 600   | IBM Plex Sans 600 (shared) | JetBrains Mono 400 | 6     | ≈ 101 KB |
| seaglass       | Manrope 400, 500         | Manrope 800                | on demand          | 6     | ≈ 64 KB  |
| archive        | Golos Text 400, 500      | Literata 500, 500 italic   | JetBrains Mono 400 | 10    | ≈ 129 KB |
| dusk           | Onest 400, 500, 600      | Unbounded 500              | on demand          | 8     | ≈ 97 KB  |
| sand           | Rubik 400, 500, 600      | Rubik 600 (shared)         | on demand          | 6     | ≈ 79 KB  |

`client/public/fonts/` holds exactly the 46 files these entries name (23 faces ×
2 subsets). A preset over **350 KB** must drop a weight.

### 2.4 Rules

- Never load a weight that no component uses. Every preset's UI 400 and its
  `displayWeight` (italic too for an editorial heading, JetBrains Mono 400 for
  mono labels) must be in its manifest, and every manifest file must exist;
  `shared/theme/theme_test.ts` fails otherwise.
- Settings → Appearance theme cards are painted with the **current** fonts (only
  the colours differ), so previewing does not trigger ten font downloads. The
  live preview card loads the selected theme's fonts only.
- No `@import`, no Google Fonts, no `font-display: block`, no font
  `<link rel="preload">`.

---

## 3. Client runtime rules

### 3.1 Cryptography

- **Argon2id runs in a dedicated Worker**: `client/src/lib/kdf.worker.ts`; the
  main thread shows a progress bar driven by elapsed vs expected time (hash-wasm
  gives no progress callback) and the text "Unlocking…".
- **Parameters are per keyring**: New keyrings use `m = 65536 KiB, t = 3, p = 1`
  (`ARGON2_DEFAULT_PARAMS`, `shared/crypto/constants.ts`). Existing keyrings
  keep their stored parameters. Never below 32 MiB: the server refuses
  `m_kib < 32768` (`ARGON2_FALLBACK_PARAMS`, `api.md` §2.3). The client never
  silently downgrades a keyring.
- **WASM is lazy**: Argon2 is fetched only on the passphrase, unlock and
  change-passphrase screens; it is precached so these screens work offline.
- **AES-GCM via WebCrypto only**: No JS AES. Per-entry encrypt/decrypt ≤ 1 ms.
- **Entries decrypt only when needed, in a Worker**: Entries are stored and
  synced as ciphertext; decryption happens only for export and the History pane
  (when it opens, ui.md §15.12). Decrypting many entries runs in
  `client/src/lib/decrypt.worker.ts` in batches of 200; the DEK is handed over
  as the non-extractable `CryptoKey` (a structured clone stays non-extractable,
  architecture.md §5.4). Where the Worker cannot run, the same batches run on
  the main thread, yielding between them (`decrypt.fallback_main_thread`).
- **Canonical JSON once**: Serialise with sorted keys in `shared/entry.ts`;
  never re-stringify on the hot path.

### 3.2 Storage

- **One IDB connection**: Opened once in `client/src/lib/db.ts` (a small wrapper
  over the IndexedDB API; the schema and upgrades in `idb/schema.ts`) and shared
  as a module singleton; `versionchange` closes it and reloads the app.
- **Batched writes**: A pull page is written in one transaction (≤ 500 puts).
- **`navigator.storage.persist()`**: Asked after onboarding and on each open
  (`reliability.md` §5.1); the result goes to `meta`.
- **Sync holds a Web Lock**: `navigator.locks.request('emo-sync', …)`: a second
  tab waits, then runs a cheap pass from the cursor (`reliability.md` §1.3).
  Without Web Locks: a `meta.lock` row with a 30 s lease.
- **Cross-tab messages**: The single `BroadcastChannel('emo')` carries
  `{type: 'prefs' | 'locale' | …}` (`client/src/lib/channel.ts`); a receiving
  tab applies them without a reload.
- **No plaintext at rest except the encrypted draft**: The draft is encrypted
  with the DEK like an entry (ui.md §6.2).

### 3.3 Rendering

- **The body map is static SVG**: One `<svg>` per view; zone fills toggle a
  class; the silhouette is not re-rendered on selection. Hit targets are
  absolutely positioned `<button>`s sized once per resize via `ResizeObserver`.
- **Transitions are transform/opacity only**: Never animate width, height, top
  or left; `will-change` only during a gesture.
- **Theme = CSS variables + props**: Switching theme updates `:root` variables
  and a store; the form is not re-mounted (ui.md §14.3).
- **Lazy routes**: Settings, History (`client/src/lib/panes.ts`), the auth
  screens (`components/auth/screens.ts`), export, the History record, the
  glossary, the passphrase words, the moving background and the ru/uk strings
  are `import()`ed. Settings and the auth screens are prefetched with
  `requestIdleCallback` once Home is up (a device without keys loads the auth
  chunk at boot); export loads on first use; History loads on first open, never
  prefetched, and its record chunk follows its first rows.
- **Fonts and colours before first paint**: The external `/boot.js` (precached,
  < 1 KB, a plain `<script src>` before the app bundle) reads the cached CSS
  variables and font-family names from `localStorage` (values only, no theme
  name) and sets them via CSSOM. No inline script (CSP, `reliability.md` §4.1).
- **No layout reads in input handlers**: The swipe handler uses pointer
  coordinates only.

### 3.4 Dependencies (allowlist)

`deno.json` `imports` is the complete list. Adding a runtime dependency requires
a row here with its measured gzip cost and the reason no existing code covers
it.

| Package                                   | Role                                          | Gzip cost (approx.)         | Notes                                          |
| :---------------------------------------- | :-------------------------------------------- | :-------------------------- | :--------------------------------------------- |
| `svelte` 5                                | UI                                            | ≈ 15 KB runtime             | runes; no store library                        |
| `hash-wasm` (argon2id only)               | KDF                                           | ≈ 11 KB chunk with its WASM | KDF Worker only, lazy                          |
| `@hono/hono`                              | HTTP server                                   | n/a                         | server only                                    |
| `nodemailer`, `@negrel/webpush`           | mail, Web Push                                | n/a                         | server only                                    |
| `vite`, `@sveltejs/vite-plugin-svelte`    | build                                         | 0                           |                                                |
| `typescript`, `svelte-check`              | type checks (`make lint`)                     | 0                           |                                                |
| `@capsizecss/core`, `@capsizecss/metrics` | font fallback metrics in `tools/gen_fonts.ts` | 0                           | tool only                                      |
| `@std/assert`, `fake-indexeddb`           | tests                                         | 0                           |                                                |
| `playwright-core`, `axe-core`             | `e2e/`                                        | 0                           | headless Chromium shell via `make e2e-browser` |
| `lighthouse`, `puppeteer-core`            | `make perf` (`perf/lighthouse.ts`)            | 0                           |                                                |
| `@types/nodemailer`                       | types                                         | 0                           |                                                |

Built in, no package: `node:sqlite` (`DatabaseSync`) and `Temporal` (the pinned
Deno, `deno.json` `"deno": ">=2.9.6 <2.10.0"`; the server refuses to start
without `Temporal`). Written in the repo instead of a dependency: the IndexedDB
wrapper (`client/src/lib/db.ts`), runtime schemas (`shared/schema.ts`), the
passphrase strength estimator (`shared/passphrase/validator.ts`: informational,
English ASCII only `[\x20-\x7E]`, length ≥ 8), and the "Suggest a passphrase"
list (the EFF Large Wordlist, CC BY 3.0 US, filtered:
`client/src/lib/passphraseWords.ts`, 6 968 words, 5 per phrase ≈ 64 bits).

Explicitly **not allowed** on the client: date libraries (`Intl` suffices), i18n
runtimes, state managers, CSS frameworks, icon packs (inline SVG icons only),
polyfills for browsers below the support line (iOS 16.4, Chrome 110, Firefox
115).

---

## 4. Server

### 4.1 SQLite configuration

Set at every connection open (`getDb`, `server/db/index.ts`):

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -20000; -- 20 MB
PRAGMA temp_store = MEMORY;
```

**One connection per process**, shared by HTTP and the scheduler. `node:sqlite`
(`DatabaseSync`) is synchronous and runs on the event-loop thread, so a second
connection buys no parallelism; worse, if code awaited inside a transaction on
one connection, a write on the other would block the whole event loop for up to
`busy_timeout` and then fail.

- **No `await` inside a transaction**: The only transaction helper is
  `tx(db, () => { … })` (`BEGIN IMMEDIATE` … `COMMIT`, `ROLLBACK` on a throw),
  taking a **synchronous** callback; it is typed so an `async` function does not
  compile (`server/db/tx_types_test.ts`). Push sends, SMTP, `fetch` and crypto
  happen before or after, never inside.
- **Short transactions**: Scheduler: the day plans are written in transactions
  of 500 accounts; each send result is one small transaction after the network
  call.
- **`busy_timeout`**: 5000 only for external writers (`emo backup` run via
  `docker compose exec` is a second process).
- **Checkpoint**: `wal_checkpoint(RESTART)` after the 6-hourly housekeeping
  (`server/services/maintenance.ts`, run by the lease holder);
  `wal_checkpoint(TRUNCATE)` at the start of `emo backup` and on shutdown.

### 4.2 Indices (in migrations)

| Index                                                           | Purpose                                              |
| :-------------------------------------------------------------- | :--------------------------------------------------- |
| `entries(account_id, id)` PRIMARY KEY                           | idempotent PUT                                       |
| `entries(account_id, seq)` UNIQUE                               | pull by cursor                                       |
| `reminders(status, scheduled_for)`                              | due rows per tick                                    |
| `reminders(account_id, local_date)`                             | "is today planned" check                             |
| `reminders(account_id, local_date, scheduled_for)` UNIQUE       | no duplicate moments                                 |
| `reminders(account_id, max(updated_at, scheduled_for))`         | `GET /api/reminders?since`                           |
| `sessions(token_hash)` UNIQUE, `sessions(account_id)`           | session lookup; devices list, revoke, account delete |
| `sessions(expires_at)`                                          | purge                                                |
| `push_subscriptions(endpoint)` UNIQUE, `(account_id)`           | upsert by endpoint; fan-out per account              |
| `login_codes(email_hmac)` UNIQUE                                | one live code per email; verify                      |
| `login_codes(expires_at)`                                       | purge                                                |
| `accounts(email_hmac)` UNIQUE                                   | login lookup                                         |
| `keyrings(account_id, key_version, rev)` PRIMARY KEY            | latest revision (`ORDER BY rev DESC LIMIT 1`)        |
| `gone_sessions(token_hash)` PRIMARY KEY                         | `account_gone` lookup on the 401 path only           |
| `invite_uses(code_hash, account_id)` PRIMARY KEY, `(code_hash)` | joined counts                                        |
| `invites(created_by)`                                           | a user's own codes                                   |

`persistent_rate_limits(key, ts)` is created by the rate limiter at start, not
by a migration (`api.md` §1.3). `mail_log` has no index; it holds at most a few
rows per account and day.

### 4.3 Scheduler tick (every 60 s)

Code: `server/services/scheduler.ts`. Only the holder of the scheduler lease
plans and sends (architecture.md §9.1); sends happen outside any transaction
(§4.1).

- **1. Plan**: One query fetches the accounts that have a push subscription or
  had a reminder sent in the last 30 days, each with its latest planned
  `local_date` (rows cancelled by `tz_change` excluded); code keeps those whose
  local today has no plan yet (a day without room is remembered in memory). At
  most 1 000 accounts are planned per tick, written in transactions of 500, so a
  whole time zone starting its day at the ceiling takes 5 ticks, an hour before
  its window opens. The query reads every eligible account each tick: ≈ 40 ms at
  5 000 accounts on the bench.
- **2. Send**: `planned` rows with `scheduled_for <= now`, oldest first, at most
  500 a tick → their subscriptions → push.
- **3. Expire**: `planned` rows more than 30 min overdue → `cancelled`,
  `reason = 'overdue'`.
- **Concurrency**: Push sends run with a concurrency limit of **20**; each send
  has a 10 s timeout and `TTL: 1800`; a tick never overlaps the previous one (a
  busy flag; a skipped tick logs `scheduler_tick_skipped`).
- **Heartbeat**: After each tick the time goes to an in-memory value read by
  `/healthz`; lag > 180 s → healthz 503 and the log `scheduler_lag_high`.

### 4.4 HTTP

- **Static assets**: Hashed files under `/assets/` →
  `Cache-Control: public, max-age=31536000, immutable`; `index.html`, `sw.js`,
  `manifest.webmanifest` and other files revalidate (`reliability.md` §4.1).
- **Compression**: The build writes brotli (quality 11) and gzip (level 9)
  siblings of every compressible file over 1 KB
  (`.js .css .html .svg .json .webmanifest .txt .wasm`); the server sends the
  sibling `Accept-Encoding` allows, brotli first. API JSON of 1 KB or more is
  gzip-compressed on the fly.
- **Body limits**: API JSON ≤ 64 KiB per request; entry ciphertext ≤ 16 KiB
  (normal entries are exactly 2 064 bytes: plaintext padded to 2 048 + tag; the
  limit leaves room for schema growth); prefs ≤ 32 KiB (`api.md` §1.4).
- **Pagination**: `limit` ≤ 500, enforced.
- **Keep-alive**: default `Deno.serve` settings; no per-request database open.

### 4.5 Capacity

- **Design ceiling**: ≈ 5 000 accounts × 3 reminders a day ≈ 15 000 pushes a day
  ≈ 10 a minute on average, peaks ≈ 100 a minute — one process handles this with
  headroom.
- **Typical instance**: 1–100 accounts; every budget is trivial at this scale;
  the ceiling exists so the code has no heavy per-account work per tick.
- **Container memory limit**: **256 MB** (`compose.yml`,
  `deploy.resources.limits.memory`); expected RSS ≈ 60–90 MB idle.
- **CPU**: 1 vCPU is enough; crypto on the server is HMAC and AES for the email
  only.
- **Disk**: ≈ 2.2 KB per entry row (2 064-byte blob + row overhead) → 5 000
  accounts × 1 000 entries a year ≈ 11 GB a year worst case; a typical instance
  (≤ 100 accounts) < 250 MB a year.
- **Binary**: `deno compile` output ≈ 100–140 MB (the Deno runtime); embeds only
  the npm packages the server imports (`--exclude-unused-npm`).

---

## 5. Budget enforcement

- **Bundle sizes (§1.1).** `deno task check:budget` (`perf/check_budget.ts`),
  part of `deno task build` / `make build`, reads
  `client/dist/.vite/manifest.json`, gzips each chunk and compares with
  `perf/budgets.json`. Fails when the shell JS or CSS, any lazy chunk or the
  icons exceed their budget.
- **Precache total.** The same script sums the files of the built `sw.js`
  precache list. Fails above 1.2 MB.
- **Font manifest.** `shared/theme/theme_test.ts` (`make test`) fails when a
  preset's weight has no file; `tools/gen_fonts.ts` fails when a preset exceeds
  350 KB (only when the fonts are regenerated).
- **Lighthouse.** `make perf` (`perf/run.ts`, `perf/lighthouse.ts`) builds the
  binary, starts it with a throwaway data directory, signs in through Playwright
  and runs Lighthouse (mobile, throttled) as one user flow: the sign-in screen
  on a first visit, Home, step 1 and Settings. Fails when any category is below
  §1.4.
- **Crypto and scheduler benches.** `deno bench` of `shared/entry.bench.ts`
  (note validator, entry encryption, Argon2id unwrap) and
  `server/services/scheduler.bench.ts` (ticks at the design ceiling), printed in
  the `make perf` report. Informational.
- **Device timings (§1.2).** Manual, before each release, on Android-ref and
  iOS-ref. A p75 regression of more than 20 % against the previous run blocks
  the release.

`make ci` (fmt-check, lint, test, build) runs the bundle, precache and font
checks. `make perf` runs every automated check and writes one report to
`perf/report/` (`summary.md`, `lighthouse.html`, `lighthouse.json`).

---

## 6. Measurement protocol

1. `make build && make docker-build` on the release commit.
2. Run the container locally with the production `compose.yml` and a throwaway
   `.env`.
3. **Automated:** `make perf` → the Lighthouse report, bench output and size
   table in `perf/report/`.
4. **Device:** install the PWA on Android-ref via Chrome and throttle to "Fast
   3G" through a local proxy or Chrome remote debugging; measure cold start
   (clear site data first), warm start, Now → step 1, save, Argon2 unlock (lock
   in Settings, then unlock), the pull of a seeded account with 3 000 entries
   (`make seed ENTRIES=3000` on a dev instance; the default is 1 000), and
   export. Repeat 5 times, take p75.
5. Repeat step 4 on iOS-ref with Safari Web Inspector timelines.
6. Record the numbers with the date and commit next to the previous run; if a
   number regressed by more than 20 %, open an issue before tagging.

---

## 7. Known trade-offs

| Trade-off                                | Reason                                                                                                                                               |
| :--------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| Argon2 cost vs unlock time               | 64 MiB / t = 3 for a passphrase-wrapped key; up to 2.5 s once per device rather than a weaker KDF. 32 MiB is only the floor the server accepts       |
| Fonts per theme rather than system fonts | Themes are part of the product's acceptability for daily use; precaching only the default theme's fonts keeps the cost bounded                       |
| No `/metrics` endpoint                   | A metrics endpoint would be one more unauthenticated surface on a privacy-focused server; `make stats` (ops.md §5.4) covers the single-operator case |
| Scheduler in-process                     | A separate worker process would add deployment surface for no benefit below the design ceiling                                                       |
