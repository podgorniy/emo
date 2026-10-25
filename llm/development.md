<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — development

Working on the code: the toolchain, the dev loop, the repository layout, the
tests, CI, the release process and the conventions every change follows. Running
an instance is `ops.md`; the root `README.md` "Development" section is the short
version of this file.

## 1. Requirements

| Item      | Version / note                                                                                                                                                                                                                                                                              |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deno      | **2.9.6**, pinned in three places that move together: `.tool-versions` (`deno 2.9.6`), `deno.json` (`"deno": ">=2.9.6 <2.10.0"`) and the `Dockerfile` (`denoland/deno:2.9.6@sha256:…`). `Temporal` is built in, without unstable flags; the server refuses to start on a runtime without it |
| Node, npm | Not needed. npm packages (Vite, Svelte, Playwright, Lighthouse) run under Deno with `nodeModulesDir: "auto"`; `deno.lock` is committed                                                                                                                                                      |
| Browser   | Chromium's headless shell for `playwright-core`, installed by `make e2e-browser` (run automatically by `make e2e`, `make capture`, `make perf`). Its version must match `playwright-core` in `deno.json` (1.58.2) and `PLAYWRIGHT` in the `Makefile`: change both together                  |
| Docker    | Only for `make docker-build` / `make up` (`ops.md`)                                                                                                                                                                                                                                         |
| `.env`    | `make init` once; `make dev` reads it and overrides `PORT`, `BASE_URL` and `DATA_DIR` inline                                                                                                                                                                                                |

## 2. Make targets for development

- `make dev [DEV_PORT=8081]`: The Deno server with `--watch` on `DEV_PORT`
  (8081) serving the built `client/dist`, and Vite with hot reload on `:5173`
  proxying to it (§3.1)
- `make dev-tunnel`: Prints how to reach `make dev` over HTTPS from a phone,
  then runs it (§3.2)
- `make build`: `deno task build`: Vite build → `client/dist`,
  `tools/pack_source.ts` (the source archive served at `/source.tar.gz`), the
  size-budget check (`perf/check_budget.ts` against `perf/budgets.json`), then
  `deno compile -A --node-modules-dir=none --exclude-unused-npm --include client/dist --include server/db/schema --output bin/emo server/main.ts`
  `bin/emo` is for tests and releases: never point it at `./data` while
  `make up` runs. The container's database is operated through `make invite`,
  `make stats` and `make cli ARGS="…"`.
- `make test`: `deno test -A` with `LOG_LEVEL=warn`: every `*_test.ts` in
  `shared/`, `server/`, `client/src/lib/` and `tools/` (unit and integration)
- `make lint`: `deno lint`; `deno check` of the server, `shared/`, `perf/`,
  `tools/`, `e2e/` and `client/src/lib`; `svelte-check`
  (`deno task check:client`); `tools/check_repo.ts` (SPDX headers, no inline
  styles, §8); the tests in `shared/i18n/` (completeness, forbidden words)
- `make fmt` / `make fmt-check`: `deno fmt` / `deno fmt --check` over the
  repository
- `make ci`: `fmt-check` → `lint` → `test` → `build`: exactly what CI runs on
  every push
- `make e2e`: `build`, `e2e-browser`, then `deno test -A e2e/*.e2e.ts` against
  `bin/emo` (§5.3)
- `make capture [ARGS="…"]`: `build`, `e2e-browser`, then
  `tools/capture_reach.ts`: screenshots and control boxes of every reach-audit
  state (§5.4)
- `make perf`: `build`, `e2e-browser`, then `perf/run.ts`: Lighthouse, sizes and
  benches into `perf/report/` (§5.5)
- `make e2e-browser [E2E_BROWSER_FLAGS=--with-deps]`: Installs Chromium's
  headless shell for `playwright-core`; a no-op once installed. `--with-deps`
  adds the system libraries on a fresh Linux (CI)
- `make seed [ENTRIES=1000]`: A test account with N random ciphertext entries in
  the `make dev` database (`perf/seed.ts`) for perf runs; refuses unless
  `BASE_URL` is `localhost` or `127.0.0.1`
- `make release-check`: `EMO_RELEASE=1 deno test shared/release_test.ts`: fails
  while any dictionary label or glossary description is still a draft
- `make release-binaries`: `build`, then `bin/emo-x86_64-unknown-linux-gnu` and
  `bin/emo-aarch64-unknown-linux-gnu` with the flags of `build:server`

Every operator target of `ops.md` §1 takes `DEV=1` to run against the `make dev`
instance with the host's Deno instead of the container: `make invite DEV=1`,
`make stats DEV=1`, `make accounts DEV=1`.

## 3. Dev loop

### 3.1 `make dev`

- Its own instance next to `make up`: `PORT=DEV_PORT` (8081),
  `BASE_URL=http://localhost:DEV_PORT` and `DATA_DIR=./data-dev`, set inline
  over `.env`, so the two never share a browser origin and its local data.
  `make dev DEV_PORT=8090` picks another port.
- `DEV_MODE=true`: the CSP without `upgrade-insecure-requests` (dev is plain
  http), temporary VAPID keys when `.env` has none, and `BASE_URL`, `SMTP_HOST`,
  `SMTP_FROM` and the source archive are not required.
- **Mail is printed to the terminal** (stderr), even with `SMTP_HOST` set, so a
  local sign-in never mails a real address. `DEV_MAIL=smtp` in `.env` sends dev
  mail through `SMTP_HOST` after all.
- Open `http://localhost:5173` while editing the client (hot reload);
  `http://localhost:8081` serves the last built client.
- A port already in use is named on startup: another `make dev`, or the
  container of `make up` (`make down`).

### 3.2 Development over HTTPS on a phone

Service worker, push and `Secure` cookies need HTTPS on a real phone. `make dev`
serves `localhost` only; for device testing use `make dev-tunnel`, which prints
the two ways and starts the dev server:

- a local Caddy with `tls internal`
  (`caddy reverse-proxy --from <name>.local --to localhost:8081`) plus Caddy's
  root CA installed on the phone, or
- a tunnel to a stable hostname:
  `cloudflared tunnel --url http://localhost:8081` or `tailscale funnel 8081`.

Push on iOS requires the PWA to be installed from that hostname; keep it stable
between sessions. Its address goes in as `DEV_BASE_URL`
(`make dev-tunnel DEV_BASE_URL=https://<name>…`), not in `.env`, whose
`BASE_URL` is the `make up` instance's.

## 4. Repository layout

```
Makefile  deno.json  deno.lock  package.json  Dockerfile  compose.yml  Caddyfile
.env.example  .tool-versions  VERSION  CHANGELOG.md  LICENSE (AGPL-3.0-or-later)  README.md
.github/               workflows/ci.yml (the one workflow, §6), dependabot.yml
shared/                code used by the client, the server and `emo decrypt-bundle`
  dictionaries.ts      keys and en/ru/uk labels, QUALITY_GROUPS, SCHEMA_V, forInput (without retired keys)
  glossary.ts, glossary/  term and scale descriptions (one file per group)
  i18n/                keys.ts, ui.{en,ru,uk}.ts, interpolate.ts, format.ts, push.ts, mail.ts,
                       forbidden.ts, note-stopwords.ts (rules: copy.md)
  entry.ts             entry type, validators, readEntry, canonical JSON, padding to 2048 bytes
  export.ts            JSONL, CSV, dictionaries.json
  crypto/              e2e (DEK, KEK, AES-GCM), keyring, aad, argon2, recovery key, vectors
  passphrase/          validator.ts (ASCII only, at least 8 characters)
  fixtures/            entry.v2.json, crypto/*.json (test vectors)
  protocol.ts          API types and schemas; schema.ts the combinators for them
  theme/               schema.ts, presets.ts (10), tint.ts, validate.ts, fonts.ts, fx.ts
  version.ts, brand.ts semver helpers; the brand constants
server/
  main.ts              bootstrap (env checks, migrations, Deno.serve, scheduler) and the CLI dispatcher
  app.ts               Hono: middleware, static files, routes, /healthz
  config.ts            env → Config, validateEnv
  crypto.ts            server keys: email (AES + HMAC), login codes, invites
  secret_check.ts      the SERVER_SECRET check stored in meta
  client_ip.ts         TRUSTED_PROXIES and X-Forwarded-For
  log.ts, tasks.ts, dist.ts, http.ts, version.ts
  db/schema/NNN_*.sql  migrations; db/index.ts connection, transactions, migrations
  middleware/          auth (session), csrf, proof (X-Emo-Auth)
  routes/              auth, invites, keyring, entries, prefs, reminders, settings, sessions, push, account
  services/            mail, push, scheduler, lease, rate_limit, accounts, maintenance, ops_counters
  cli/                 backup, restore, open, ops (invite, stats), admin + admin_cli (accounts,
                       account-delete, login-code, keyring-revert, entry-delete, rotate-secret),
                       decrypt_bundle, mailtest, prompt (the command list: ops.md §1.1)
  testing/harness.ts   the real app on in-memory SQLite with recording mail and push
client/
  index.html, vite.config.ts, tsconfig.json
  src/main.ts, App.svelte, sw.js (the service worker template), boot.css, fonts.css, fx.css
  src/lib/             api, crypto, kdf (+ kdf.worker), idb/ (schema, migrations), db, sync, machine,
                       draft, checkin, unlock, keyring, theme, panes, i18n, history, export,
                       phone layout: viewport, layout.svelte, band, reach, sheets, swipe, press
  src/components/      flow/, home/, history/, settings/, auth/, common/
  public/              manifest.webmanifest, icons, mark.svg, boot.js, fonts/<family>/*.woff2,
                       privacy.html, methodology.html (+ .css)
e2e/                   Playwright on the built binary (§5.3); the reach audit: audit.e2e.ts, states.ts,
                       reach_pending.ts, keyboard.ts (the on-screen keyboard stub); report/ (gitignored)
perf/                  run.ts, lighthouse.ts, check_budget.ts, budgets.json, seed.ts; report/
tools/                 check_repo, pack_source, capture_reach (make capture), gen_fonts, gen_icons,
                       gen_crypto_vectors
design/                reference screenshots (*.png), icon-master.{png,svg}, prototype/ (HTML mock-ups)
llm/                   the specification (reading order: llm/README.md)
```

`client/dist`, `bin/`, `data/`, `data-dev/`, `backups/`, `node_modules/` and the
`report/` folders are build or run output, never edited by hand.

## 5. Tests

### 5.1 Unit (`deno test`)

`*_test.ts` next to the code they test; client tests run under Deno with
`fake-indexeddb`. What they hold:

- `shared/entry.ts`: validators of every field, the note validator in three
  languages, length in code points, stable canonical JSON. Schema reading: an
  entry with `schema_v = 99` is kept and flagged without breaking pull;
  `locations: []` is rejected.
- `shared/i18n`, `shared/glossary_test.ts`: completeness, forbidden words,
  glossary rules (`copy.md` §8).
- Crypto: keyring wrap/unwrap; a wrong passphrase fails; entry round trip; a
  swapped `entry_id` in the AAD fails; browser/Deno parity through `hash-wasm`;
  **test vectors** `shared/fixtures/crypto/*.json` reproduce byte for byte
  (keyring, `auth_key`, entry, prefs, draft); recovery key encode/decode,
  `O/I/L` normalisation, a typo in any character caught by the checksum; every
  entry's ciphertext (skipped, full, a 160-character Cyrillic note) has the same
  length; entry ids are UUID v4.
- Scheduler: gaps ≥ `min_gap_min`, every moment inside the window, even coverage
  over 10 000 runs (χ² over hourly bins), the fallback for a narrow window, `tz`
  changes, idempotent generation per day, late generation into the rest of the
  window, both DST transition days; with two processes on one DB only the lease
  holder ticks; changing the window mid-day cancels today's reminders outside it
  and adds none; `GET /api/reminders` never returns `scheduled_for > now`.
- Sync: the same blob `PUT` again → 200; a different blob → 409 and
  re-encryption under a new id; a tombstoned id → 410 and the entry leaves the
  outbox instead of coming back; `seq` monotonic; the tombstone wins; `since`
  pagination; an epoch change → re-upload of everything local and a pull from
  zero; `max_seq < cursor_seq` → the same.
- Auth: an invite burns exactly once; code TTL and attempt limit; a new code
  voids the old; the 11th failed check in a day → 429, also for an unknown
  email; `verify` answers for unknown email, wrong, expired and exhausted code
  are byte-identical; `request-code` answers before the mail is sent; an open
  mail circuit → 503 for every address.
- DEK proof: `PUT /api/keyring`, `DELETE /api/account` and
  `DELETE /api/entries/:id` without `X-Emo-Auth`, or with another's → 403; the
  first keyring write registers the hash; a stale `If-Match` → 409; revisions
  are never overwritten.
- Recovery mail: the key never reaches the DB or the log stub; the endpoint
  rejects an unauthenticated request; 3 per day; the mail has no links.
- Form state machine: no jumping ahead, back keeps answers, `skipped` from any
  screen, `latency_sec` and `hidden_sec` counted (9 minutes in the background →
  `hidden_sec ≈ 540`); a draft idle for ≥ 10 minutes is finalised as
  `abandoned`, otherwise restored, **also after a restart**; `untouched` holds
  exactly the untouched sliders; the draft on disk is ciphertext.
- Phone layout (ui.md §4.5): `band_test` (band height and top, `stageMin`,
  scroll rest), `viewport_test` (keyboard inset under iOS zoom and `offsetTop`,
  height without keyboard, `liftBy`), `sheets_test` (sheet stack depth),
  `swipe_test` (axis, drag response 0.6 / 0.2, ±140 px, commit).
- Prefs: round trip, last-write-wins on `updated_at`, > 32 KiB → 413.
- Themes: all 570 built-in themes (7 tintable presets × 9 base colours including
  the original × 9 gradient states, plus 3 fixed presets) pass contrast,
  including `muted / surface`; every `figureSel = bloom = #4F46E5` (light) or
  `#8EA2FF` (dark), selection-to-figure contrast ≥ 3:1, `warm = false`; the
  resolver overwrites the fixed fields of `v` (ui.md §14.1) even when a preset
  sets others.
- Logs: a log sink stub asserts nothing of the never-logged list (`ops.md` §5.1)
  reaches it.

### 5.2 Integration

The real Hono app on `:memory:` SQLite (`server/testing/harness.ts`; mail and
push are stubs that record their calls), in `server/api_test.ts`, the
`server/routes/*_test.ts` and `server/cli/*_test.ts`. Scenarios: invite → code →
account → keyring → 3 entries → pull from another "device" → tombstone (through
`DELETE /api/entries/:id` with `X-Emo-Auth`) → upload of the deleted id → 410.
Restore: snapshot → 5 new entries from two "devices" → `emo restore` of the
snapshot → both devices see the new epoch and re-upload → all 5 on the server
again. `server/protocol_test.ts` checks every server response against
`shared/protocol.ts`.

### 5.3 End-to-end (`make e2e`)

Playwright (`playwright-core`, headless Chromium) against the compiled binary:
`e2e/harness.ts` starts `bin/emo` (or `EMO_BIN`) on a free port with a temporary
`DATA_DIR` and `DEV_MODE=true`, reads sign-in codes from the mail it prints and
mints invites with `emo invite`. Every `e2e/*.e2e.ts` runs; between them:

- zero `securitypolicyviolation` events on every screen (`csp.e2e.ts`), and
  axe-core (WCAG 2.x A/AA) plus a 44 × 44 px target check on every screen
  visited;
- the crypto vectors reproduced in Chromium (`vectors.e2e.ts`);
- flows: account, check-in, saved and undo, forms, now, routes, panes and swipe,
  sheets, history, export, glossary, locale, theme and fx, sync dot, offline
  band, update card, PWA (overscroll, manifest shortcut, reminder tap), legal
  pages, wordmark, account switch.

The accessibility acceptance list is ui.md §10. A failed run leaves
`e2e/report/`.

### 5.4 Reach audit and `make capture`

`e2e/audit.e2e.ts` (ui.md §4.10) walks every phone state of `e2e/states.ts` at
390×844, 375×667, 390×664, 844×390 and 390×844 with a 34 px bottom inset (en),
plus ru and uk at 375×667 and 844×390; `REACH_FULL=1` runs every language at
every size. It checks the thumb band, the instrument exceptions and the keyboard
(a stubbed visual viewport, `e2e/keyboard.ts`: each text field and its submit
must sit whole between the viewport top and the keyboard). Each configuration
walks all its states in one context, starting with sign-up, against its own
server: a signed-in `storageState` cannot be carried over (device keys are
non-extractable `CryptoKey`s in IndexedDB), and a separate server keeps the
per-address sign-in limit apart. The bottom inset is emulated through CDP
`Emulation.setSafeAreaInsetsOverride` (`harness.emulateSafeArea`), so every
`env(safe-area-inset-*)` sees it.

Known failures are listed in `e2e/reach_pending.ts` and reported in
`e2e/report/reach_audit.json`; a new failure fails the test. Switches:
`REACH_STRICT=1` also fails on a listed state that passes or an entry nothing
matched; `REACH_WRITE=1` rewrites the list from this run (`REACH_WRITE=add` adds
to it); `REACH_ONLY=390x844@en,…` runs just those; `REACH_JOBS=n` (default 5)
configurations side by side; `REACH_VERBOSE=1` logs each state.

`make capture` only records; the gate is `make e2e`. It writes
`e2e/report/capture/<config>/<NN>-<state>.png` (and `+kb` shots with the
keyboard drawn as a grey box) and `inventory.json` with every control's box.
`ARGS`: `--matrix review|default|full` (default `review`: en at 390×844 and
375×667), `--config 390x844@en,…`, `--out DIR`, `--keyboard=false`.

### 5.5 Performance (`make perf`, `make build`)

`make build` fails when a bundle exceeds `perf/budgets.json` (the budgets are
performance.md §1.1). `make perf` starts `bin/emo` with a temporary `DATA_DIR`
and runs Lighthouse (mobile, simulated throttling) as one user flow over
sign-in, Home, step 1 and Settings, plus the size table and the Deno benches
(`shared/entry.bench.ts`, `server/services/scheduler.bench.ts`); it writes
`perf/report/` (`summary.md`, `lighthouse.html`, `lighthouse.json`) and fails
when a Lighthouse category or a size is below its minimum (benches are
informational). Device timings on the reference phones are manual
(performance.md §6).

## 6. CI

One GitHub Actions workflow, `.github/workflows/ci.yml`; no matrix (one Deno
version from `.tool-versions`, `ubuntu-24.04`). Deno's cache is keyed on
`deno.lock`, Playwright's browser cache on `deno.lock` too. Secrets: only the
`GITHUB_TOKEN` GitHub provides; never instance secrets.

| Trigger                     | Job                                                                                                                                                                                                                                                                               |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| push (any branch, `v*` tag) | `ci`: `make ci` (fmt-check, lint incl. SPDX, inline-style and forbidden-word checks, unit + integration tests incl. the crypto vectors, build incl. the size budget)                                                                                                              |
| pull_request                | `ci`, and `e2e`: `make e2e E2E_BROWSER_FLAGS=--with-deps` (CSP, axe, flows, crypto vectors, the reach audit's default matrix: only failures not listed as pending fail); `e2e/report/` uploaded on failure                                                                        |
| tag `v*`                    | `release` after `ci`: `make release-check`; the tag must equal `v` + `VERSION`; `make docker-build`, push `ghcr.io/<owner>/emo:X.Y.Z` and `:latest`; `make release-binaries` attached to the GitHub release as `emo-linux-x86_64` and `emo-linux-arm64` (release notes generated) |
| schedule (Monday 04:00 UTC) | `perf`: `make perf` on the latest tag; `perf/report/` uploaded; fails on the Lighthouse minimums                                                                                                                                                                                  |

Once a tag has published `ghcr.io/<owner>/emo`, a server can run that image
instead of building its own: `EMO_IMAGE=ghcr.io/<owner>/emo` in `.env` (and
`docker login ghcr.io` with a read-only packages token if the repository is
private); `make update` then pulls.

## 7. Release process

### 7.1 Versioning

| Rule             | Detail                                                                                                                                                                                                                                                         |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semver           | `MAJOR` = incompatible API or data change requiring a manual step; `MINOR` = features, migrations that need no manual step; `PATCH` = fixes                                                                                                                    |
| Single source    | `VERSION` at the repository root. The server imports it as text (`server/version.ts`, embedded by `deno compile`: `X-Emo-Server`, `/healthz`); Vite injects it into the client (`__EMO_VERSION__`); it is an image tag. `package.json`'s `version` is not read |
| `CHANGELOG.md`   | Keep a Changelog format, under `## [Unreleased]` until a release; every migration gets a line; every step an operator must do by hand is marked **Manual step** (§8)                                                                                           |
| Git tag `vX.Y.Z` | CI builds and pushes `ghcr.io/<owner>/emo:X.Y.Z` and `:latest` on the tag, and attaches Linux binaries to the GitHub release (§6)                                                                                                                              |
| Client version   | The app sends `X-Emo-Client: X.Y.Z`; the server logs it and applies the compatibility window of reliability.md §3                                                                                                                                              |

### 7.2 Pinning

| What               | Where                                                                                                                                                                                     |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deno version       | `deno.json` → `"deno": ">=2.9.6 <2.10.0"`, plus the exact version in the `Dockerfile` (`FROM denoland/deno:2.9.6@sha256:…`) and `.tool-versions`                                          |
| Base image         | `gcr.io/distroless/cc-debian12:nonroot` pinned by digest in the `Dockerfile`                                                                                                              |
| Proxy image        | `caddy:2.11.7-alpine` pinned by digest in `compose.yml`                                                                                                                                   |
| Updates            | Dependabot (`.github/dependabot.yml`): weekly PRs for the image digests (Dockerfile, compose) and the CI actions; `denoland/deno` is ignored there and moves by hand, in all three places |
| Playwright         | `playwright-core` in `deno.json` and `PLAYWRIGHT` in the `Makefile`, the same version                                                                                                     |
| Dependencies       | `deno.lock` committed; `deno install --frozen` in the `Dockerfile`; changes only through an explicit PR. The client runtime allowlist is performance.md §3.4                              |
| Browsers supported | iOS/Safari ≥ 16.4, Chrome/Edge ≥ 111, Firefox ≥ 115 — declared in `README.md`; no polyfills below                                                                                         |

### 7.3 Licence headers

Every source file starts with the SPDX header; `tools/check_repo.ts` (in
`make lint`) fails on any missing one, over `client/src`, `client/public`,
`client/index.html`, `server`, `shared`, `perf`, `tools` and `e2e` (skipping
`node_modules`, `dist` and `report`):

| File         | Header                                                                                                                           |
| :----------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `.ts`, `.js` | first non-empty line `// SPDX-License-Identifier: AGPL-3.0-or-later`                                                             |
| `.sql`       | `-- SPDX-License-Identifier: AGPL-3.0-or-later`                                                                                  |
| `.css`       | `/* SPDX-License-Identifier: AGPL-3.0-or-later */`                                                                               |
| `.svelte`    | the first line inside the first `<script>`, or `<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->` when the file has no script |
| `.html`      | the identifier within the first three lines                                                                                      |

Config files and docs carry it too by convention (`# …` in `Makefile`, YAML,
`Dockerfile`, `Caddyfile`; `<!-- … -->` in Markdown). `LICENSE` at the root is
the GNU AGPL v3 text. AGPL §13 is met by Settings → About → "Source code"
linking to `SOURCE_URL`: by default the archive of the running build itself
(`/source.tar.gz`); when it points to a repository, the release checklist (§7.4)
verifies the link resolves to the tagged source. Dependencies must be
AGPL-3.0-compatible (MIT, BSD, ISC, Apache-2.0, MPL-2.0, LGPL-2.1-or-later,
LGPL-3.0, GPL-3.0 are; GPL-2.0-only is **not**; check anything else before
adding it); self-hosted fonts are OFL, which is compatible for bundling.

### 7.4 Release checklist

1. `make ci` green on `main`.
2. Device timings recorded (performance.md §6) if any client code changed.
3. `CHANGELOG.md` section for the version; `VERSION` bumped.
4. `make release-check` passes (no draft dictionary label or glossary
   description).
5. Tag `vX.Y.Z` → CI publishes the image and the binaries.
6. Upgrade the owner's instance with `ops.md` §3.1; `make smoke`.
7. Install the PWA fresh on one iOS and one Android device, do one check-in
   offline, come online, confirm it syncs.
8. Open Settings → About on the upgraded instance: the version matches the tag,
   "Source code" opens the source of that tag.
9. Once per minor release: the restore drill (`ops.md` §4.4) and a test restore
   on a scratch instance with one connected device, confirming the epoch
   re-upload works.

## 8. Conventions

- **SPDX header on every source file** (§7.3).
- **No inline styles.** The strict CSP blocks them (reliability.md §4.1): no
  `style=` attribute in `.svelte` or `.html` markup and no `<style>` block in
  `.html` (`tools/check_repo.ts`). Use a class or Svelte's `style:` directive; a
  Svelte component's own `<style>` block is fine (it compiles to CSS).
- **Format only the files you touched:** `deno fmt <paths>`, not a bare
  `deno fmt` / `make fmt`, which would also rewrite notes that are not yours
  (the owner's root note `ideas.md` is never reformatted).
- **CHANGELOG.md:** Keep a Changelog; user-facing lines in plain words; every
  migration has a line; a step an operator must do by hand is marked **Manual
  step** in bold. `make update` and `make deploy-rsync` stop on newly added
  `**Manual step**` lines until `MANUAL=done` (`ops.md` §3.1).
- **Migrations** are forward-only files `server/db/schema/NNN_name.sql`, applied
  in one transaction at startup.
- **UI copy** goes through `shared/i18n` keys in all three languages and passes
  the forbidden-word test (`copy.md`).
- **One rule lives in one file** in `llm/`; code comments cite the spec section
  they implement.

## 9. Toolchain notes

- Vite and `@sveltejs/vite-plugin-svelte` run under Deno with
  `nodeModulesDir: "auto"`; Svelte 5 runes compile as usual.
- `deno compile --include client/dist` embeds the built client; the server reads
  it through `import.meta.url`. Compile with
  `--node-modules-dir=none
  --exclude-unused-npm`: `./node_modules` also holds
  Vite, Lighthouse and Playwright, which otherwise make the binary about four
  times larger.
- `node:sqlite` (`DatabaseSync`) is built into Deno and works inside
  `deno compile`; WAL, `foreign_keys` and `busy_timeout` read back as set, and
  BLOBs round-trip as `Uint8Array`.
- `@negrel/webpush`: `generateVapidKeys()` makes non-extractable keys by
  default; pass `{ extractable: true }` to export them to `.env`. Browsers want
  the raw uncompressed P-256 public key (65 bytes) in base64url as
  `applicationServerKey`.
- `hash-wasm` Argon2id is pure WASM; on Apple Silicon m = 64 MiB, t = 3, p = 1
  takes about 155 ms.
- The service worker is a template (`client/src/sw.js`); a Vite plugin in
  `client/vite.config.ts` writes the precache list and a content-hash cache name
  into `client/dist/sw.js`. There is no automatic `skipWaiting`: the app shows
  "Update ready — Restart".
- Lighthouse 13 runs under Deno through `puppeteer-core`, attached to the
  Chromium that Playwright signed in. Lighthouse 12+ has no PWA category
  (installability and offline are e2e checks). Best practices lose a few points
  to the console lines Chrome writes for the expected `401` on `/api/session`
  (signed out) and `404` on `/api/prefs` (never written).
- `Temporal` is global in Deno 2.9.6 and works in `deno compile` (DST arithmetic
  verified); no polyfill.
