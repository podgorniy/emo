<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — Architecture

How Emo is built: scope, threat model, stack, accounts, the key hierarchy and
encryption, the server tables, local storage and sync, the reminder scheduler,
export and backup, and the mechanics of localisation. Routes and error codes
live in api.md; failure handling in reliability.md; the entry payload in data.md
§2; screens and behaviour in ui.md.

---

## 1. Scope

### 1.1 In scope

- Check-ins following the entry schema (data.md §2) and the screen order of the
  check-in flow (ui.md §6.2).
- Three random reminders a day by Web Push (§9).
- Accounts, sign-in by emailed code, devices, invite codes (§4).
- End-to-end encryption of all content: entries, appearance prefs, the form
  draft (§5).
- Working offline; sync between devices (§8).
- Export by the user, decrypted on the device (§10.1).
- Emergency Undo of a save on the Saved screen and the Home toast; it is a
  tombstone (§8.4).
- The History pane: a read-only list of this device's entries, and deleting any
  entry by tombstone (ui.md). Entries are immutable: no editing, no filling in
  later.
- Appearance: 10 theme presets, base colour and gradient, stored in the
  encrypted prefs (ui.md §13, ui.md §14). Themes are cosmetic only: measurement
  controls and the selection colour are the same in every theme (ui.md §1.7,
  ui.md §1.11, ui.md §14.1).
- Settings → About: not a medical device, crisis line link, what the server
  sees, the operator's privacy notice, source code (AGPL) (ui.md §11); served by
  `GET /api/instance`.
- Operation: Docker, backup and restore, configuration, logs (ops.md).

### 1.2 Out of scope

- Reports, metrics, charts. The architecture fixes only the module boundary: the
  open data model and the export format are such that the metrics of
  methodology.md §4 and methodology.md §5 can be built on the client later
  without migrations.
- Sensor data.
- Any reading of entry content on the server: aggregates, search, "smart"
  notifications.
- Native apps.
- Search, filters, summaries and charts over past entries (ui.md); the list
  itself is in scope.
- A theme editor, custom themes, theme sharing (ui.md §14.1).
- Importing an `emo-bundle` into an instance (ui.md §17). Only export, and
  reading it offline with `emo decrypt-bundle` (§10.1).
- Rotating the DEK (§5.3): `key_version` is reserved for it.

---

## 2. Threat model

The founding requirement: whoever gets the raw data must not be able to read it.

### 2.1 What Emo protects against

| Scenario                              | Protection                                                                                                                                                                                                                                                         |
| :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leak of the database file or a backup | Every entry, prefs blob and keyring wrap is AES-256-GCM ciphertext. The keys derive from the user's passphrase and never reach the server                                                                                                                          |
| Disk snapshot at the hosting provider | Same                                                                                                                                                                                                                                                               |
| Operator / admin with a shell         | Entry content is unreadable. Only metadata is visible (§2.2)                                                                                                                                                                                                       |
| Leak of the user list                 | Email is stored encrypted under a server key; lookup goes through an HMAC blind index (§5.7). A database dump without `.env` does not reveal addresses                                                                                                             |
| Session theft                         | Cookie `emo_session` is `HttpOnly; Secure; SameSite=Strict`; the device list allows revoking any session. A session allows sync, but **not** changing the keyring, deleting the account or deleting an entry: those need `X-Emo-Auth`, derived from the DEK (§5.1) |
| Guessing sign-in codes                | One live code per email (a new one voids the old), 10 minutes, 5 attempts; at most 10 failed checks per email per day; per-IP rate limits. At most 10 guesses a day per email (api.md §1.3)                                                                        |
| Account enumeration                   | `request-code` answers the same way, and before the mail is sent; every failed `verify` is the same `code_invalid`; an SMTP failure opens the mail circuit breaker for all addresses at once (api.md §2.1)                                                         |
| Mailbox compromise                    | The attacker can sign in, get metadata and the keyring, and guess the passphrase **offline** — hence the passphrase rule (§4.1). They cannot change the keyring or delete the account. If the recovery key was emailed, the mailbox gives full access (§5.6)       |

### 2.2 What Emo does not protect against

- **A compromised user device.** The unwrapped DEK is cached on the device
  (§5.4); otherwise a 60-second check-in is impossible. Plaintext still never
  reaches disk: the form draft is encrypted with the same DEK (§5.5).
- **A weak passphrase after a keyring leak.** Argon2id (§5.1) slows guessing.
  Client rule: English/ASCII only (`[\x20-\x7E]`), at least 8 characters. The
  strength meter is informational and never blocks, to avoid friction when
  typing on a phone.
- **Malicious JavaScript served by the server.** The instance is self-hosted;
  the operator is trusted for the code. This is a limit of any web E2E.
- **Metadata:** the number of entries, when they reached the server
  (`received_at`, which differs from `ts` when entries were queued offline), the
  wake window, time zone, push endpoints, and when reminders were sent. **Not**
  leaked: the entry time through its id (the id is a random UUID v4), or the
  content through ciphertext length (plaintext is padded to 2048 bytes, §5.5): a
  skipped entry and one with a note are the same size.
- **Old secrets with an old backup.** Changing the passphrase or the recovery
  key rewraps the same DEK. Whoever holds an old database backup **and** the old
  passphrase or recovery key can still unwrap the DEK. The real cure is DEK
  rotation (§5.3, not built). The new-recovery-key mail says "the old keys no
  longer work" — true for the live server, not for old copies.
- **Losing both the passphrase and the recovery key loses the data.** This is
  the price of E2E; the user is warned at registration. The mitigation is
  emailing the recovery key (§5.6), which moves trust to the mailbox.

### 2.3 What the server sees in plaintext

Only what reminders and sign-in need: `tz`, the wake window and reminder
settings, the interface locale, push subscriptions, and the reminder journal.
The email is stored encrypted under a server key (§5.7). Logs never carry blob
contents, email, codes, tokens, the passphrase or the recovery key (ops.md
§5.1).

**The sign-in address on the device.** The client keeps the normalised sign-in
address (trim → NFC → lower case) **inside the encrypted prefs** (E2E, DEK, AAD
`emo-prefs/v1`), so the hidden `username` field gives password managers an
address rather than a UUID (ui.md §12). It is never written in plaintext
anywhere (IndexedDB, `localStorage`, the CSS cache); in memory it exists after
sign-in in this tab or after unlock. The server receives one more copy of the
address, encrypted with the user's key, and learns nothing new. The cost:
whoever has the DEK (passphrase or recovery key) also sees the address in prefs,
and an `emo-bundle` carries it inside the encrypted prefs. The unlock screen
cannot decrypt prefs yet, so after a restart or a lock the `username` field is
absent there: a locked device never shows the address.

---

## 3. Stack

### 3.1 Server

- **Deno**, pinned to `>=2.9.6 <2.10.0` (`deno.json`, `.tool-versions`,
  `Dockerfile`). One process: HTTP API, the PWA's static files, the reminder
  scheduler. `Temporal` and `node:sqlite` are built in at this version; no
  unstable flags, no polyfill.
- **HTTP:** `Deno.serve` + Hono (JSR `@hono/hono`): routing, middleware,
  cookies.
- **Database:** SQLite through the built-in `node:sqlite` (`DatabaseSync`), one
  file `DATA_DIR/emo.sqlite`, one connection per process. PRAGMAs at every open:
  `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
  `busy_timeout=5000`, `cache_size=-20000`, `temp_store=MEMORY`. The driver is
  synchronous; the only transaction helper (`tx` in `server/db/index.ts`) uses
  `BEGIN IMMEDIATE`, and nothing inside a transaction may `await` — that would
  let other requests run between `BEGIN` and `COMMIT` (performance.md §4.1).
  Migrations are numbered SQL files in `server/db/schema/`, applied at start
  (§6).
- **Email:** SMTP through `npm:nodemailer`. No third-party mail APIs.
- **Web Push:** JSR `@negrel/webpush` (RFC 8030/8291/8292, native to Deno).
- **Server-side crypto:** WebCrypto: AES-256-GCM for email and readable invite
  codes, HMAC-SHA256 for the email blind index and login codes, HKDF for
  subkeys, random tokens (§5.7).

### 3.2 Client

- **Svelte 5** (runes), built by **Vite** (`npm:vite` +
  `@sveltejs/vite-plugin-svelte`) under Deno.
- **Service worker:** hand-written (`client/src/sw.js`), no Workbox; precache of
  the app shell, `/api/*` and `/healthz` network-only, no Background Sync API
  (iOS lacks it). §7.2.
- **Local storage:** IndexedDB through a small hand-written layer
  (`client/src/lib/db.ts`, schema and migrations in
  `client/src/lib/idb/
  schema.ts`). It holds ciphertext of entries, prefs and
  the draft, the sync cursor, the outbox, and the DEK as a non-extractable
  `CryptoKey` (§8.1). Store versioning — data.md §8.3.
- **Crypto:** WebCrypto AES-256-GCM and HKDF; Argon2id through `npm:hash-wasm`
  (pure WASM; the same code runs in the browser and in Deno tests), run in a Web
  Worker (`client/src/lib/kdf.ts`, `kdf.worker.ts`). If the worker cannot run
  it, it runs once on the main thread (diagnostic `kdf.fallback_main_thread`);
  if that fails too the browser is unsupported
  (`auth.passphrase.kdfUnsupported`). The worker is stopped after 10 s idle and
  on lock. The passphrase strength meter is a small dependency-free entropy
  heuristic (`shared/passphrase/validator.ts`, score 0–4).
- **Body map:** inline SVG with zones; each zone maps to a key of `BODY_ZONES`
  (data.md §5.1).

### 3.3 Shared code (`shared/`)

Imported by both server and client; the server needs only the protocol types,
validators, crypto (for `emo decrypt-bundle`) and the push/mail strings.

- `dictionaries.ts` — dictionaries with stable keys and labels in three
  languages (data.md §5.1).
- `i18n/` — UI, mail and push strings (§11).
- `entry.ts` — the entry type, `SCHEMA_V`, validators, `readEntry`, canonical
  JSON, padding to 2048 bytes.
- `crypto/` — keys, AAD, Argon2id, keyring assembly and unwrap, recovery-key
  format, test vectors (§5). Shared with `emo decrypt-bundle`.
- `export.ts` — JSONL, CSV and `dictionaries.json`, shared with
  `emo decrypt-bundle` (§10.1).
- `protocol.ts` — API request/response types and schemas (api.md §4).

### 3.4 Packaging and running

- `make build`: Vite builds the client into `client/dist`, the source archive is
  packed (`tools/pack_source.ts`), the size budget is checked, then
  `deno compile --include client/dist --include server/db/schema --output
  bin/emo server/main.ts`.
  The result is one executable with the static files and migrations inside.
- Docker image, multi-stage: stage 1 `denoland/deno:2.9.6` (pinned by digest)
  builds the binary; stage 2 `gcr.io/distroless/cc-debian12:nonroot` (pinned by
  digest) holds `/emo`, volume `/data`, user `nonroot`. The image has no shell,
  no `sqlite3`, no `curl`: every operation (serve, migrate, backup, restore,
  verify-backup, healthcheck, invite, stats, admin) is an `emo` subcommand.
- Docker is the supported way to deploy; the single binary also runs without it.
  Configuration (`.env`), Docker Compose, TLS, logs and the Makefile: ops.md,
  ops.md. The settings that change architecture are named where they apply:
  `REGISTRATION` (§4.1), `INVITES_BY_USERS` and `INVITES_PER_USER` (§4.4),
  `RECOVERY_MAIL_ENABLED` (§5.6), `DEFAULT_LOCALE` (§11.3), `SERVER_SECRET`
  (§5.7), the VAPID keys (§7.2).
- Immutable identifiers use `emo`: AAD and HKDF labels, the push tag, the
  binary, the manifest, file names, the IndexedDB name, Web Lock names. Changing
  any of them breaks existing data or devices.

---

## 4. Accounts and sign-in

### 4.1 Registration

1. The user enters an email and, if they have one, an invite code. With
   `REGISTRATION=open` (default) the invite is optional and only records who
   invited whom; with `REGISTRATION=invite` no account is made without one.
2. The server checks the invite (exists, not used up, not expired), queues a
   mail with a 6-digit code, and stores the hash of a usable invite in the
   login-code row. The invite is **not** spent yet. Without a usable invite the
   mail goes out only under `open`.
3. The user enters the code; the client also sends `tz` and `locale`. The server
   creates the account with them (id: UUID v7), spends the invite if it is still
   usable (under `invite` an unusable one is an error: `code_invalid`,
   `invite_expired`, `invite_already_used`), records the use in `invite_uses`,
   creates a session and returns `account.id`.
4. The client asks for a **passphrase**: English/ASCII only (`[\x20-\x7E]`), at
   least 8 characters (`shared/passphrase/validator.ts`). The four-segment
   strength meter is informational. Copy and the "suggest a passphrase" words
   (`client/src/lib/passphraseWords.ts`, five EFF words, about 64 bits) — ui.md
   §12.
5. The client generates the DEK (32 random bytes), derives `auth_key` (§5.1),
   wraps the DEK under the passphrase key and under a new recovery key, unwraps
   each wrap again in memory and compares it with the DEK (`assembleKeyring` in
   `shared/crypto/keyring.ts`; a revision that would lock the person out is
   never uploaded), and sends the keyring with `X-Emo-Auth`. This first write
   registers `auth_hash` (§5.2).
6. The recovery key is shown once. The screen offers three ways to keep it
   (§5.6); the user cannot go on until they have chosen at least one. It is
   never shown again; a new one can be generated (needs the passphrase). A key
   shown but not confirmed as saved is tracked
   (`client/src/lib/recoveryPending.ts`) and the app asks again.
7. Onboarding: install to the home screen (required for push on iOS),
   notification permission, wake window (§7.2).

### 4.2 Sign-in on a new device

1. Email → 6-digit code → session and `account.id`.
2. The client downloads the keyring, asks for the passphrase, unwraps the DEK,
   derives `auth_key` and keeps both (§5.4).
3. Full pull of entries from `seq` 0 (§8.3).

**Sign-in codes.** 6 digits, uniform, TTL 10 minutes, 5 attempts, then the code
is void. A new code voids every earlier code for that email (one row per
`email_hmac` in `login_codes`). Rate limits: 3 codes per email per 15 minutes,
10 code requests per IP per hour, 30 verify attempts per IP per 15 minutes, 10
failed checks per email per day (api.md §1.3). The mail is sent by a background
task; `202` comes before the send. For an unknown email the answer is
indistinguishable from success, and every failed check is the same
`code_invalid` (api.md §2.1). Codes are stored as an HMAC under a server subkey,
not a plain hash (§5.7).

**Why a code, not a magic link.** On iOS a link in a mail opens in Safari, not
in the installed PWA, and they have separate storage. The user would be signed
in where they do not record.

### 4.3 Sessions

- An opaque 256-bit token; the database keeps its SHA-256 (`token_hash`) and a
  separate random `id` for the device list and revoking.
- Cookie `emo_session`: `HttpOnly; Secure; SameSite=Strict; Path=/`, 365 days,
  **sliding**: when more than 24 h have passed since `last_seen_at`, the server
  moves `expires_at` to now + 365 days and sets the cookie again.
- At most 20 sessions per account; signing in drops the least recently used
  beyond that (reliability.md §4.2).
- Signing in again is **never needed to record**: the form works locally; only
  sync needs authentication. An expired session shows as a quiet "not synced"
  state, not a blocking screen. Signing in again: a tap on the sync dot on Home
  opens sign-in; the same action is in Settings → Devices (ui.md §3).
- The device list (user agent, last activity) is in Settings → Devices; any
  session can be revoked.
- CSRF: `SameSite=Strict` plus an exact `Origin` check (the full origin of
  `BASE_URL`) on mutations.
- Versions: the client sends `X-Emo-Client`, the server `X-Emo-Server` (semver).
  Compatibility window and `426` — reliability.md §3.

The three ways a device stops are defined here and only here; other documents
refer to them (ui.md §11, api.md §2.1, reliability.md §1.4):

- **Sign out on this device** (Settings → Devices): if the outbox holds unsent
  entries the user first confirms "discard N unsynced"; then
  `POST /api/auth/logout` (a network error is ignored), the other tabs are told,
  the keys are dropped, the whole IndexedDB database is deleted (entries,
  outbox, draft, DEK, `auth_key`, prefs, meta, reminders) and `localStorage` is
  cleared (the CSS cache); then the sign-in screen (`signOutDevice` in
  `client/src/lib/session.ts`).
- **Lock on this device** (Settings → Data): removes only the DEK and `auth_key`
  from memory and IndexedDB and stops the KDF worker (`lockDevice`); the
  session, ciphertext, outbox and prefs stay; the server is not called. The next
  open asks for the passphrase.
- **Revoking a session** from another device only stops that device's sync; its
  local data and DEK stay until it is signed out.

### 4.4 Invite codes

- An administrator creates codes with `make invite [USES=1] [EXPIRES=30d]`
  (ops.md §7): 12 characters of Crockford base32 (60 random bits); with `USES>1`
  the code is reusable.
- With `INVITES_BY_USERS=true` (default) each user can hold up to
  `INVITES_PER_USER` (default 5) live codes from Settings → Invites. User codes
  are always single-use (`max_uses = 1`, ui.md §11.8) and expire after 30 days.
- A use is recorded in `invite_uses` when the account is created, not when the
  code is requested. A user sees for their codes only the status and the number
  who joined — no email.
- The readable code (`code_enc`, so Settings can show an unused code) is dropped
  at its last use and when it expires.

### 4.5 Deleting the account

From Settings: the client asks for the passphrase and unwraps the DEK locally (a
deliberate act on this device), then calls `DELETE /api/account` with
`X-Emo-Auth`. Without the DEK proof the server refuses
(`403 auth_proof_invalid`), so a session alone cannot delete. In one transaction
the server hard-deletes every row of the account: entries, all keyring
revisions, sessions, push subscriptions, reminders, prefs, `mail_log`,
`invite_uses`, the invites it created, its login codes, the account. The token
hashes of its sessions stay in `gone_sessions` for 90 days without an account
id, so other devices get `401 account_gone`, show a message and wipe their
IndexedDB. The deleting device wipes itself the same way as sign-out. Backups —
§10.3.

---

## 5. Key hierarchy and encryption

All client crypto lives in `shared/crypto/` (constants in `constants.ts`, AAD in
`aad.ts`, operations in `e2e.ts`, keyring in `keyring.ts`, recovery key in
`recovery.ts`) and `client/src/lib/crypto.ts` (device caching). Binary values in
JSON are base64url.

### 5.1 Keys

| Key                                     | Derivation                                                                                                                                                       | Where it lives                                                                                                                                                                                                               |
| :-------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DEK** — data key                      | 32 random bytes, generated on the client at registration                                                                                                         | Wrapped only, on the server. Unwrapped: in memory and in this device's IndexedDB as a non-extractable AES-256-GCM `CryptoKey`                                                                                                |
| **KEK_pass**                            | `Argon2id(passphrase, salt)`, 32 bytes, imported as an AES-256-GCM key                                                                                           | Never stored. Computed when the passphrase is entered                                                                                                                                                                        |
| **Recovery secret `s`**                 | 16 random bytes (128 bits), generated on the client                                                                                                              | Only with the user, as the recovery key (format below)                                                                                                                                                                       |
| **KEK_recovery**                        | `HKDF-SHA256(ikm = s, salt = UTF-8(account_id), info = "emo-recovery/v1", L = 32)` → AES-256-GCM                                                                 | Never stored                                                                                                                                                                                                                 |
| **auth_key** — proof of holding the DEK | `HKDF-SHA256(ikm = raw DEK bytes, salt = UTF-8(account_id), info = "emo-auth/v1", L = 32)`, derived while the raw DEK bytes are in memory (generation or unwrap) | Client: IndexedDB `keys.auth`, encrypted under the DEK (§5.4); a bearer token, not an encryption key. Server: only `SHA-256(auth_key)` in the keyring row. Sent as base64url in `X-Emo-Auth` on **Proof** routes (api.md §1) |

The server checks `X-Emo-Auth` by hashing the 32 decoded bytes and comparing
with `auth_hash` in constant time (`verifyAuthProof` in `server/crypto.ts`).
Proof routes: `PUT /api/keyring/:key_version` (after the first),
`DELETE /api/account`, `DELETE /api/entries/:id`.

**Recovery key format.** `c = SHA-256("emo-recovery-check/v1" || s)[0..4]` (4
checksum bytes). `s || c` = 20 bytes = 160 bits = exactly 32 Crockford base32
characters (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`), shown as 8 groups of 4
joined by hyphens. Input is normalised: upper case, spaces and hyphens removed,
`O → 0`, `I`/`L → 1`; `U` is not in the alphabet and is rejected. A wrong length
or checksum gives "check the key" **before** any unwrap attempt, so a typo never
looks like a wrong key.

**Argon2id parameters.** Default `m = 65536 KiB (64 MiB), t = 3, p = 1`, salt 16
bytes, output 32 bytes. New keyring revisions always use the default. The
parameters are stored in each keyring revision; the server accepts
`m_kib ∈ [32768, 1048576]`, `t ∈ [1, 16]`, `p ∈ [1, 4]` (`keyringProblem`), so
32 MiB is the floor for any keyring (performance.md §3.1).

### 5.2 Keyring on the server

```json
{
  "key_version": 1,
  "rev": 3,
  "kdf": {
    "alg": "argon2id",
    "m_kib": 65536,
    "t": 3,
    "p": 1,
    "salt_b64": "..."
  },
  "dek_wrapped_pass": { "nonce_b64": "...", "ct_b64": "..." },
  "dek_wrapped_recovery": { "nonce_b64": "...", "ct_b64": "..." }
}
```

Each wrap is AES-256-GCM over the 32 raw DEK bytes, 12-byte nonce, 48-byte
output, AAD `"emo-keyring/v1" || account_id || key_version`. A wrong passphrase
fails the GCM tag; no separate verifier exists. The server refuses a revision
whose shape is wrong (`keyringProblem`: `alg`, parameter ranges, salt 16 bytes,
nonce 12 bytes, ciphertext 48 bytes).

The keyring is stored as **revisions**: each write is a new row
`(account_id, key_version, rev)`; old rows are never overwritten or deleted
(except by account deletion). The current revision is `MAX(rev)`. Writing a new
revision needs `If-Match` with the current `rev` and `X-Emo-Auth`; a stale
`If-Match` is `409 keyring_conflict`, which the client retries once against the
fresh revision. The first write (no keyring yet) registers `auth_hash`, which is
the same for every revision of one `key_version` (api.md §2.3).
`GET /api/keyring` returns the newest revision; `?all_revisions=1` returns all,
newest first. An operator can roll back a bad or malicious revision (ops.md §7).

### 5.3 Keyring operations

- **Change passphrase:** new salt, new KEK_pass, rewrap the DEK, new revision
  (`If-Match` + `X-Emo-Auth`); the recovery wrap is carried over byte for byte.
  Data is not re-encrypted; `auth_key` does not change (it depends only on the
  DEK). Needs the network: the server holds the revision order.
- **Recover with the recovery key:** unwrap the DEK with the recovery key,
  derive `auth_key`, set a new passphrase, generate a new recovery key (new
  `s`), write a new revision. The new recovery key is shown only after the
  server stored the revision; until then nothing changes on the device
  (`recoverAndUpload` in `client/src/lib/keyring.ts`). Old-backup limit: §2.2.
- **New recovery key:** needs the passphrase; new `s`, new recovery wrap, the
  passphrase wrap carried over; the three delivery channels repeat (§5.6).
- **Unlock falls back to an older revision** when the newest does not open
  (damaged): unlock tries revisions newest first, deriving each KEK once per
  distinct salt and parameters (`unwrapFirstWithPassphrase`). Settings then
  offers "Re-save keys", which writes a fresh revision from the one that opened
  (reliability.md §1.2).
- **DEK rotation** (`key_version + 1`) is not built. It would re-encrypt and
  re-upload every entry while the server keeps both keyrings; `key_version` is
  carried in every blob and AAD for it.

### 5.4 Keys on the device

The unwrapped DEK is imported as a `CryptoKey` with `extractable: false` and
stored in IndexedDB `keys.dek`. `auth_key` is stored next to it in `keys.auth`,
encrypted under the DEK (AES-256-GCM, random 12-byte nonce, AAD
`"emo-auth-store/v1"`). The raw DEK bytes exist only in memory between unwrap
and import and are then zeroed (`importAndWipe`). The browser never hands the
key bytes to script; the key is bound to the origin and the device. The current
keyring revision and account are cached in `meta` (`meta.keyring`,
`meta.account`), so unlock works offline.

The passphrase is asked for only: on a new device, after an explicit lock, after
site data was cleared.

This trades protection against a local attacker for a check-in that fits in 60
seconds (methodology.md §1.1). The trade is deliberate.

### 5.5 Encrypting an entry

- The plaintext payload is the entry JSON (data.md §2), serialised canonically
  (keys sorted, `canonicalizeJson` in `shared/entry.ts`) so tests are
  deterministic.
- **Padding:** the UTF-8 bytes of the canonical JSON are padded with ASCII
  spaces (`0x20`) to a multiple of 2048 bytes (normally exactly 2048).
  `JSON.parse` ignores trailing whitespace, so a reader does nothing. Without
  padding the ciphertext length would tell the server which entries were skipped
  and how long the note is. Hashes and canonical-JSON tests are computed
  **before** padding.
- The entry `id` is a UUID v4 (`crypto.randomUUID()`), lower case; a
  time-ordered UUID would reveal `ts`. The server rejects any other form.
- AES-256-GCM, random 96-bit nonce, 128-bit tag. A nonce is never reused with a
  key; the fixed nonces in `e2e.ts` parameters exist only for test vectors.
- AAD = `"emo-entry/v1" || account_id || entry_id || key_version`. It binds the
  blob to its slot: moving a blob between entries or accounts breaks the tag.
- **AAD encoding (all AADs):** the parts are UTF-8 strings joined by a `0x00`
  byte; `key_version` is a decimal string (`buildAad` in
  `shared/crypto/aad.ts`).
- The server receives `{ id, key_version, nonce_b64, ct_b64 }`; ciphertext over
  16 KiB is `413`.

Two more objects are encrypted with the DEK:

| Object                                                                           | Padding           | AAD                                               | Where it lives                               |
| :------------------------------------------------------------------------------- | :---------------- | :------------------------------------------------ | :------------------------------------------- |
| prefs (`{ appearance: AppearancePref, email?: string }`, ui.md §14.7, ui.md §12) | none              | `"emo-prefs/v1" \|\| account_id \|\| key_version` | IndexedDB `prefs`, server `prefs` (≤ 32 KiB) |
| check-in form draft (ui.md §6.2)                                                 | 2048, as an entry | `"emo-draft/v1" \|\| account_id`                  | IndexedDB `draft` only; never sent           |

While the device is locked (no DEK) the draft lives only in memory.

All labels in one place:

| Label                      | Use                                                       |
| :------------------------- | :-------------------------------------------------------- |
| `emo-entry/v1`             | entry AAD                                                 |
| `emo-keyring/v1`           | DEK wrap AAD                                              |
| `emo-prefs/v1`             | prefs AAD                                                 |
| `emo-draft/v1`             | draft AAD                                                 |
| `emo-auth-store/v1`        | AAD of `auth_key` stored on the device                    |
| `emo-auth/v1`              | HKDF info for `auth_key`                                  |
| `emo-recovery/v1`          | HKDF info for KEK_recovery                                |
| `emo-recovery-check/v1`    | recovery-key checksum prefix                              |
| `emo-server-blob/v1`       | HKDF info of the server subkey for email and invite codes |
| `emo-server-login-code/v1` | HKDF info of the server subkey for login codes            |
| `emo-email/v1`             | AAD of `accounts.email_enc`                               |
| `emo-invite-code/v1`       | AAD of `invites.code_enc`                                 |
| `emo-secret-check`         | message of the `SERVER_SECRET` check value (§6.2)         |

**Test vectors.** `shared/fixtures/crypto/v1.json` holds a fixed passphrase,
recovery secret, salt, nonces and `account_id`, and the expected keyring,
`auth_key`, entry, prefs and draft ciphertext (generated by
`tools/gen_crypto_vectors.ts`). Every future version must decrypt them and
reproduce them byte for byte. This is the main protection for data that must
stay readable for years; never regenerate the vectors to make a change pass.

### 5.6 Recovery key delivery

The recovery key is made on the client and the server does not need it. But a
key shown once is easily lost, and losing it and the passphrase loses all data.
The recovery-key screen therefore offers three channels:

| Channel              | How                                                                                                                                                                                                            | Who sees the key                                                                            | Availability                                                                                                                                                         |
| :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Save / share**     | The client builds `emo-recovery-YYYY-MM-DD.txt` (key, email, instance address, instructions) and calls the Web Share API; fallback: a file download. The user picks Files, Notes, a password manager, own mail | Only the user and the app they picked. The server takes no part                             | Recommended; first on the screen                                                                                                                                     |
| **Send to my email** | The client posts the key to `POST /api/account/recovery-mail`; the server sends the mail to the account's address during the request and does not store the key                                                | The server, in memory for the request; the mail provider; anyone with access to the mailbox | When `RECOVERY_MAIL_ENABLED=true` (default); otherwise `403 recovery_mail_disabled`. One line beside the button warns that whoever reads the mail can read the diary |
| **Write it down**    | 8 groups of 4 Crockford base32 characters                                                                                                                                                                      | Only the user                                                                               | Always                                                                                                                                                               |

Consequences of the mail channel, part of the threat model (§2):

- Sign-in also goes through mail. After the key is mailed, **mailbox = sign-in
  - decryption**. Protection against the server and a dump holds; protection
    against whoever has the mail does not.
- The server sees the key in plaintext for a moment. For a self-hosted instance
  where the operator is the user this is acceptable; for an instance with other
  users it is trust in the operator, who is already trusted for the code (§2.2).
- The mail advises moving the key to a password manager and deleting the mail;
  nothing relies on that.

Server rules for the mail channel: the key is never written to the database or
logs; the endpoint needs an authenticated session (no DEK proof); 3 mails per
account per day, counted in `mail_log` — the slot is taken atomically and given
back when the send fails, so neither a race nor an SMTP outage changes the count
(reliability.md §1.7); a failed send is `503`, success `202`; the mail has no
links, only the key and text, so it does not look like phishing and never opens
in the wrong app (§4.2). It is localised by `accounts.locale` (§11.2).

Sending is **never automatic**: the user presses the button. Automatic sending
would take the choice away from those who keep the key out of mail on purpose.

When a new recovery key is generated (§5.3) the screen and the three channels
repeat; old mails become useless, and the mail with the new key says so.

### 5.7 Server-side secrets

`SERVER_SECRET` (256 bits, hex) protects what the server must read but a dump
must not reveal:

- `email_hmac` = `HMAC-SHA256(SERVER_SECRET, normalizeEmail(email))`, where
  normalisation is trim → NFC → lower case. It is the lookup key; the order of
  normalisation is permanent because the index is long-lived.
- Two subkeys are derived from the secret with HKDF-SHA256 (empty salt), so the
  raw secret is used for `email_hmac` only: `emo-server-blob/v1` and
  `emo-server-login-code/v1`.
- `accounts.email_enc` and `invites.code_enc` are AES-256-GCM under the blob
  subkey, stored as `nonce(12) || ciphertext || tag(16)`, with AAD
  `emo-email/v1` or `emo-invite-code/v1`, so a blob of one column never opens as
  another. Rows written with the raw secret and no AAD still open;
  `emo rotate-secret` rewrites them.
- Login codes are stored as hex `HMAC-SHA256` under the login-code subkey: a
  plain hash of a 6-digit code falls to 10⁶ guesses with read access to the
  database.
- Invite codes are looked up by SHA-256 of the normalised code (upper case,
  spaces and hyphens removed).
- `meta.secret_check` holds `HMAC(SERVER_SECRET, "emo-secret-check")`; a
  mismatch at start means the secret was swapped (reliability.md §1.5).

Without `SERVER_SECRET` no email can be decrypted and no account found at
sign-in; without the VAPID keys every push subscription is void. Both live in
`.env`, backed up apart from the database (§10.2).

---

## 6. Server data model

### 6.1 Tables

Everything in plaintext is metadata for sign-in and reminders. The source of
truth is `server/db/schema/*.sql`; this is the shape.

```sql
accounts(
  id                TEXT PRIMARY KEY,          -- UUID v7
  email_enc         BLOB NOT NULL,             -- AES-GCM under the server blob subkey (§5.7)
  email_hmac        BLOB NOT NULL UNIQUE,      -- HMAC-SHA256(SERVER_SECRET, normalised email)
  tz                TEXT NOT NULL,             -- IANA, updated by the client
  locale            TEXT NOT NULL DEFAULT 'en', -- ru | uk | en; for mail and push
  wake_start        TEXT NOT NULL DEFAULT '09:00',
  wake_end          TEXT NOT NULL DEFAULT '22:00',
  reminders_per_day INTEGER NOT NULL DEFAULT 3,
  min_gap_min       INTEGER NOT NULL DEFAULT 120,
  reminders_paused_until TEXT,                 -- ISO; no reminders before it; NULL = not paused (004)
  created_at        TEXT NOT NULL
);

keyrings(account_id, key_version, rev, kdf_json, dek_wrapped_pass, dek_wrapped_recovery,
         auth_hash BLOB NOT NULL,             -- SHA-256(auth_key), same for every rev of a key_version
         created_at, PRIMARY KEY(account_id, key_version, rev));   -- append-only; current = MAX(rev)

sessions(
  id            TEXT PRIMARY KEY,             -- random id for the device list and revoking; not the token
  token_hash    TEXT NOT NULL UNIQUE,         -- SHA-256 of the token
  account_id, user_agent, created_at, last_seen_at, expires_at
);
gone_sessions(token_hash PRIMARY KEY, deleted_at);   -- sessions of deleted accounts, 90 days, no account_id

invites(
  code_hash     TEXT PRIMARY KEY,             -- SHA-256 of the normalised code
  code_enc      BLOB,                         -- the code, readable for Settings; NULL once used up or expired
  created_by    TEXT,                         -- account_id, or NULL (admin CLI)
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  max_uses      INTEGER NOT NULL DEFAULT 1,   -- user codes always 1
  uses          INTEGER NOT NULL DEFAULT 0
);
invite_uses(code_hash, account_id, used_at, PRIMARY KEY(code_hash, account_id));

login_codes(id, email_hmac UNIQUE,            -- one live code per email: a new one replaces the row
            code_hash, attempts, invite_hash, -- invite_hash: only on a registration code
            expires_at, created_at);

push_subscriptions(id, account_id, endpoint UNIQUE, p256dh, auth, user_agent, created_at, failed_count);

prefs(
  account_id    TEXT PRIMARY KEY,
  key_version   INTEGER NOT NULL,
  nonce         BLOB NOT NULL,
  ciphertext    BLOB NOT NULL,                -- ≤ 32 KiB; the server never reads it
  updated_at    TEXT NOT NULL
);

entries(
  id            TEXT NOT NULL,                -- UUID v4, set by the client
  account_id    TEXT NOT NULL,
  seq           INTEGER NOT NULL,             -- monotonic per account, set by the server
  key_version   INTEGER NOT NULL,
  nonce         BLOB,                         -- NULL on a tombstone
  ciphertext    BLOB,                         -- NULL on a tombstone
  deleted       INTEGER NOT NULL DEFAULT 0,
  received_at   TEXT NOT NULL,                -- upload time; on a tombstone, deletion time
  PRIMARY KEY(account_id, id),
  UNIQUE(account_id, seq)
);

reminders(
  id            TEXT PRIMARY KEY,             -- UUID v4
  account_id    TEXT NOT NULL,
  local_date    TEXT NOT NULL,                -- YYYY-MM-DD in the account's tz
  tz            TEXT NOT NULL,                -- the tz the day was planned in
  scheduled_for TEXT NOT NULL,                -- UTC
  sent_at       TEXT,
  status        TEXT NOT NULL,                -- planned | sent | failed | cancelled | paused
  reason        TEXT,                         -- on cancelled: settings | overdue | no_device | tz_change (005)
  updated_at    TEXT NOT NULL                 -- changes with every status change
);
```

Foreign keys cascade from `accounts` to `sessions`, `push_subscriptions`,
`prefs`, `entries` and `reminders`; deletion also removes the rest explicitly
(§4.5).

`reminders` is the **journal of reminders**. It exists because a reminder the
user never opened leaves no entry at all (`skipped = true` means opened and
declined). Without it, compliance and the pattern of misses cannot be computed
(methodology.md §1.1, methodology.md §5.3). The client downloads the journal and
matches it with entries by `reminder_id` on the device, in plaintext. `reason`
is a column rather than more statuses, so older clients still read the journal.
The unique index `reminders(account_id, local_date, scheduled_for)` only stops
duplicate rows; "one schedule a day" is the generation transaction's job (§9.1).
The reminder pull pages on `max(updated_at, scheduled_for)` (indexed), the
moment a row became visible to the client (api.md §2.8).

Indexes and query rules — performance.md §4.2.

### 6.2 Service tables

No user content:

- `schema_migrations(version, applied_at)`.
- `meta(key, value)`: `secret_check` (§5.7); `epoch` — 128 random bits (hex),
  created with the database, replaced by `emo restore`, sent in every
  `X-Emo-Epoch` (§8.3); `scheduler_lease` (§9.1); `maintenance_at` (§6.3).
- `mail_log(account_id, kind, sent_at)`: the recovery-mail limit.
- `ops_counters(ts, name, value)`: scheduler lag, push and mail failures — no
  identifiers (ops.md §5.4).

Migrations are numbered SQL files, forward-only, all pending ones in **one**
`BEGIN IMMEDIATE` transaction, after an automatic
`VACUUM INTO backups/pre-migrate-<from>-to-<to>-<ts>.sqlite` (the last 3 are
kept). A database newer than the binary does not start (data.md §8.5, ops.md
§3).

### 6.3 Housekeeping

Every 6 hours the scheduler's lease holder runs maintenance in one transaction
(`server/services/maintenance.ts`; the last run is kept in
`meta.maintenance_at`, so a restart does not repeat it):

- expired sessions and login codes are deleted;
- `gone_sessions` older than 90 days are deleted;
- `ops_counters` older than 48 h are deleted;
- `code_enc` of expired invites is cleared;
- **tombstones** (`entries.deleted = 1`) whose `received_at` is older than 90
  days are deleted;

then `PRAGMA wal_checkpoint(RESTART)`.

---

## 7. Saving and onboarding

### 7.1 Saving a check-in

```
build payload → canonical JSON → pad to 2048 bytes → AES-GCM (DEK)
  → one IndexedDB transaction: entries(ciphertext) + outbox(item) + delete draft
  → UI "saved" → sync()
```

The transaction (`commitEntry` in `client/src/lib/db.ts`) means a crash leaves
either the draft or the saved entry, never both or neither. On a full disk
(`QuotaExceededError`) the entry is held in memory until a write works or the
server has it; it is never dropped (reliability.md §1.1). The UI never waits for
the network. Sync status is one dot on Home, no text (ui.md §3).

### 7.2 Onboarding and PWA

- `client/public/manifest.webmanifest`: `name`/`short_name` `Emo`, `id` and
  `start_url` `/`, `display: standalone`, `background_color` and `theme_color` =
  `ground` of the Calm preset (`#E4EDF1`), icons 192, 512 and maskable 512, a
  "Check in now" shortcut to `/now`. The build appends a content hash to icon
  URLs. The `theme-color` meta tag follows the active theme's `ground`, set by
  `/boot.js` before first paint and on every theme change. Icon list — ui.md
  §16.2.
- iOS Safari outside standalone → an "Add to Home Screen" screen with
  instructions; without it push is impossible (ui.md §12).
- Notification permission is asked after install, on an explicit tap (§7.3).
- `navigator.storage.persist()` is requested after onboarding; the answer goes
  to `meta.persisted`, with no UI either way (reliability.md §5.1).
- CSP has no `'unsafe-inline'` (reliability.md §4): the theme is applied before
  first paint by the external `/boot.js` through CSSOM, from the cache
  `localStorage['emo-css']` (colour values only, never the theme name). With
  "Match system" on (ui.md §13) the cache holds a light and a `dark` set and
  `/boot.js` picks by `prefers-color-scheme`. Components never use `style="…"`
  attributes (CSP blocks them): only classes and Svelte `style:` directives
  (CSSOM).

### 7.3 Push subscription

- The client takes the public VAPID key from `GET /api/push/vapid` and, on every
  app open, checks its subscription against it and against the server's list
  (`client/src/lib/push.ts`): a rotated subscription, new VAPID keys or a server
  restored without the subscription lead to subscribing again
  (`POST /api/push/subscriptions` with `replaces?`).
- Settings → Reminders shows the state: unsupported, needs install, denied,
  default, off, on (reliability.md §2.4).

### 7.4 Service worker

- Install precaches the shell into `emo-shell-<hash>` (the build writes the
  precache list and the hash into `client/dist/sw.js`); activation deletes old
  caches.
- `skipWaiting` only on the page's `SKIP_WAITING` message, after the user
  accepts "Update ready — Restart", so a form is never reloaded mid-entry
  (reliability.md §3).
- `/api/*` and `/healthz` are network-only; app routes are served from the
  shell.
- Notifications and taps — §9.2.

---

## 8. Offline and sync

### 8.1 Local storage (IndexedDB)

Database `emo`, `DB_VERSION` 3; migrations are additive and never edited once
released (`client/src/lib/idb/schema.ts`, data.md §8.3).

| Store       | Contents                                                                                                                                                                                                 |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entries`   | `{ id, seq, key_version, nonce_b64, ct_b64, deleted, received_at, check? }` — ciphertext as on the server; `check` is this device's decryption result (`entryCheck.ts`), never uploaded. Index `idx_seq` |
| `outbox`    | `{ id, op, key_version, nonce_b64, ct_b64, attempt_count, created_at }`; `op` is `put` (upload, the default) or `delete` (send the `DELETE`)                                                             |
| `meta`      | key/value: see below                                                                                                                                                                                     |
| `keys`      | `dek` — non-extractable `CryptoKey`; `auth` — `auth_key` encrypted under the DEK (§5.4)                                                                                                                  |
| `reminders` | copy of the reminder journal, by id                                                                                                                                                                      |
| `prefs`     | prefs ciphertext + `updated_at` + `dirty` (a local change not yet uploaded)                                                                                                                              |
| `draft`     | the encrypted form draft                                                                                                                                                                                 |

Main `meta` keys: `account_id`, `account`, `keyring` (§5.4); `cursor_seq`,
`server_epoch`, `last_sync_ok_at` (end of the last good sync pass — "Synced ·
{time}" in the dot's tooltip, ui.md §3), `reminders_since`, `settings` (last
seen server settings), `tz_sent`, `locale`, `clock_skew_sec`, `instance` (cache
of `GET /api/instance` for About), `diag` and `diag_counts` (ring buffer of the
last 100 error codes, reliability.md §1.8), `evicted`, `persisted`, `lock` (the
sync lease, §8.3).

Plaintext never reaches disk, the draft and prefs included. Decryption happens
in memory (History, export). The one exception by design is the CSS cache in
`localStorage` (§7.2).

### 8.2 Protocol core

The full contract (every route, request and response shape, the error envelope,
codes, limits, rate limits) is api.md. The core of sync:

```
PUT    /api/entries/:id   { key_version, nonce_b64, ct_b64 }  → 201 | 200 { seq, received_at }
       same id, same blob → 200; other blob → 409 entry_blob_mismatch; id is a tombstone → 410 entry_deleted
DELETE /api/entries/:id   (X-Emo-Auth)                        → 200 { seq }  (tombstone; unknown id too; repeat → same seq)
GET    /api/entries?since=<seq>&limit=500                     → { items, next_seq, max_seq, has_more }
GET    /api/reminders?since=<iso>                             → { items, next_since, has_more }  (only scheduled_for ≤ now)
PUT    /api/prefs         { key_version, nonce_b64, ct_b64 }  → 200 { updated_at }
GET    /api/prefs                                             → 200 { key_version, nonce_b64, ct_b64, updated_at } | 404
GET    /api/settings                                          → 200 { …settings, receiving_reminders, reminders_paused_until }
PUT    /api/settings      { tz, locale, wake_start, wake_end, reminders_per_day, min_gap_min }  → 200 (full replace)
PUT    /api/settings/pause { days: 1 | 3 | 7 }                → 200 (as GET)
DELETE /api/settings/pause                                    → 200 (as GET)
```

The server `seq` is a monotonic counter per account; a tombstone takes a new
`seq`, so it reaches every device through the pull. The client keeps
`cursor_seq` and pulls the tail; the `seq` of an upload is stored on the row,
but the cursor moves only by pulling. Deletion always wins. `received_at` in
pulled items lets the client notice a wrong device clock: more than 300 s apart
sets `meta.clock_skew_sec` (reliability.md §5.3). Every response carries
`X-Emo-Epoch` (api.md §3).

### 8.3 The sync pass

`runSync` in `client/src/lib/sync.ts`. While the client is outside the server's
compatibility window nothing is sent (reliability.md §3).

0. Take the Web Lock `emo-sync` (without Web Locks: a 30 s lease in `meta.lock`
   with the tab id). A second tab or window waits, then runs its own pass —
   never in parallel (reliability.md §1.3). A call while this tab's pass runs
   does not start another; it asks for one more pass after it.

   0a. **Epoch.** If the `X-Emo-Epoch` of any response differs from
   `meta.server_epoch`, or the pull returns `max_seq < cursor_seq`, the server
   was restored from a backup and lost data. The client puts every local entry
   back in the outbox — live entries as `put`, tombstones as `delete` — sets
   `cursor_seq = 0` (`requeueAllEntries`), runs steps 1–5, and stores the new
   epoch only after that round completed. Prefs the server no longer has (`404`)
   are uploaded again in step 4. Uploads are idempotent, so this restores
   everything that exists on at least one device (api.md §3, ops.md §4.3).
1. **Push the outbox**, one item at a time, oldest first.
   - `put`: `PUT /api/entries/:id`. On success the item is removed and the row
     gets its `seq` (`markUploaded`).
   - `409 entry_blob_mismatch` → id collision (a UUID v4 collision, practically
     impossible): the entry is decrypted, re-encrypted under a new UUID v4 (the
     AAD binds the id), queued again, and the old row becomes a local tombstone
     (`meta.renamed`, diagnostic `sync.conflict`). Skipped if the entry was
     deleted meanwhile or the device is locked.
   - `410 entry_deleted` → deleted on another device: the outbox item and the
     local ciphertext are **removed**, a local tombstone stays. Never rename in
     this case — that would resurrect a deleted entry.
   - `delete`: `DELETE /api/entries/:id` with `X-Emo-Auth`; while locked it
     waits for an unlocked pass.
   - A transient error (offline, 5xx, 429, 401) increments `attempt_count`,
     stops the push and fails the pass; a permanent one increments it and goes
     on.
   - Every write back to the outbox applies only while the item is still the one
     that was sent (`markUploaded`, `settleOutboxItem`), because a delete may
     replace it meanwhile (§8.4).
2. **Pull entries**: `GET /api/entries?since=cursor_seq&limit=500` until
   `has_more` is false. A blob that fails the GCM tag or has an unknown
   `schema_v` is kept as it is and marked; the pull never stops for it
   (reliability.md §1.2, data.md §8.1). Every pass re-checks the rows marked
   other than `ok` (`entryCheck.ts`): the mark is cleared as soon as the running
   build can read the entry.
3. **Pull the reminder journal** from `meta.reminders_since` until `has_more` is
   false.
4. **Prefs** (`syncPrefs` in `client/src/lib/prefs.ts`; skipped while locked): a
   local change (`dirty`) is uploaded with `PUT`; otherwise `GET`, and a blob
   with a different `updated_at` is decrypted and applied (theme). Last write
   wins. A `404` uploads what this device has. Then, if this tab signed in with
   an address the prefs do not hold yet, the address is written in and uploaded
   — only after the exchange, so this device's appearance never overwrites the
   server's (§2.3).
5. **Settings:** when the device's `tz` changed since this device last sent it
   (`meta.tz_sent`), or the interface language differs from the server's, the
   client fetches fresh settings and sends `PUT /api/settings` over them, so
   another device's reminder window is never overwritten with an old copy
   (§9.3).

The pass then records clock skew and sets `meta.last_sync_ok_at`.

**Triggers:** after a save or a delete, at app open,
`visibilitychange → visible`, the `online` event, and every 5 minutes while the
app is visible. A failed pass retries with backoff from 1 s, doubling, up to 30
s; never after a 401, which waits for the next sign-in (reliability.md §1.3).
There is no pull-to-refresh: the page disables overscroll.

"Realtime" means: with a network, an entry reaches the server and the other
devices within seconds of their opening. WebSocket or SSE are not needed for an
append-only log with three entries a day.

**Sync status** (the Home dot, ui.md §3): `synced` (outbox empty), `pending`, or
`stale` when the oldest waiting item is older than 24 h (§8.5).

### 8.4 Deletion and several devices

Entries are append-only, the client sets the UUID, so there are no conflicts by
construction. Settings (`tz`, window) are last-write-wins on the server; the
`tz` rule of step 5 keeps two devices in different zones from pulling the
account back and forth.

**Deleting an entry** (Undo, ui.md §6.5; History, ui.md §15.10): the row becomes
a local tombstone and a `delete` op replaces any pending upload in the outbox,
**in one IndexedDB transaction** (`writeTombstone`), so a storage error leaves
neither and the entry stays saved. It does not take the `emo-sync` lock — a pass
may hold it as long as a request hangs — and never waits for the network: the
`DELETE` goes with the next pass, which the delete asks for. Undo decrypts the
row first to refill the form. The `DELETE` and the tombstone always stay.

The server deletes tombstones 90 days after the deletion (§6.3).

### 8.5 Storage on iOS

Safari may clear the storage of sites not installed after 7 days without use. An
installed PWA is better protected, but not absolutely. Hence sync at every open,
the persistence request (§7.2), and an explicit warning (`stale`) when the
outbox holds items older than 24 hours.

---

## 9. Reminders

### 9.1 The scheduler

`server/services/scheduler.ts`. It ticks every minute inside the server process.

A tick runs only in the process that holds the lease `meta.scheduler_lease`
(`{ holder, expires_at }`, 120 s, renewed at every tick and every 30 s during a
tick; `server/services/lease.ts`). A second process on the same database (a
second container started by mistake) does not tick and logs `scheduler_standby`
(at most every 10 minutes): reminders are never doubled. An in-process flag
skips a tick while the previous one runs (`scheduler_tick_skipped`); lag over
180 s logs `scheduler_lag_high` and makes `/healthz` unhealthy (ops.md §5.3).

A day is planned for every account that has a push subscription, or had a
reminder sent in the last 30 days (`NO_DEVICE_PLAN_MS`): a device switched off
leaves `cancelled`/`no_device` rows in the journal rather than nothing, and only
after a month without a sent reminder does the account stop getting rows
(methodology.md §5.3). At most 1000 accounts are planned per tick, written in
transactions of 500.

Each tick, in this order: expire overdue rows (step 3), plan (steps 1 and 4),
send (step 2), and maintenance when due (§6.3).

1. **Generate the day.** If the account has no schedule for its current
   `local_date` (in its `tz`) and the local time is ≥ `wake_start − 1 h`,
   generate `reminders_per_day` whole-minute moments in
   `[wake_start, wake_end]`, pairwise ≥ `min_gap_min` apart (`sampleMoments`).
   - When the window holds `reminders_per_day × min_gap_min`, sampling is
     **circular**: the window is bent into a ring, the gaps are `min_gap_min`
     plus a uniform share of the slack, and the set is turned by a uniform
     offset. Every moment is then uniform over the whole window — each hour is
     sampled equally often (methodology.md §5.4) — and across the ring's seam
     the time before the first and after the last also add up to ≥
     `min_gap_min`.
   - A narrower window (and the rest of a day, step 4) keeps the count:
     rejection sampling, at most 1000 attempts, then a fallback (uniform points
     in the window shrunk by the gaps, the i-th shifted by i gaps). This
     sampling favours the first and last hour.
   - The "no schedule yet" check (rows cancelled by a move to another tz do not
     count) and the inserts of `status = planned` rows share **one**
     `BEGIN IMMEDIATE` transaction; with a synchronous driver and one writer,
     that guarantees one schedule a day. A draw that hits a minute already taken
     by a `tz_change` row is redrawn on the next tick.
   - Local times convert to UTC with `Temporal.ZonedDateTime`; a time skipped by
     a DST jump resolves to the next valid instant, a repeated one to the
     earlier ("compatible"; reliability.md §2.2).
2. **Send** every `planned` row with `scheduled_for ≤ now` (at most 500 per
   tick, oldest first) to every subscription of the account, **outside** any
   transaction, at most 20 sends at once (performance.md §4.3). Push headers:
   `TTL: 1800`, `Urgency: high`, `Topic: emo` — an undelivered reminder is
   replaced by the next and never arrives more than 30 minutes late; send
   timeout 10 s. The status is written in one short transaction after the sends:
   - at least one subscription accepted → `sent`, `sent_at`;
   - none accepted → retried on later ticks while
     `scheduled_for ≥ now − 30 min`;
   - no subscriptions → `cancelled`, `reason = no_device`;
   - a push service answering `401`/`403`/`404`/`410` → the subscription is
     deleted (none left → `no_device`);
   - other failures (not timeouts, connection errors or `429`) count once per
     subscription per reminder in `failed_count`; at 5 the subscription is
     deleted (reliability.md §1.6).
3. **Overdue.** A `planned` row with `scheduled_for < now − 30 min` is never
   sent late: `failed` if every subscription refused it during its retry window,
   otherwise `cancelled`, `reason = overdue` (the server was down). A missed
   moment is not moved. The record of refusals is in memory, so after a restart
   an unsent row expires as `cancelled`.
4. **Late start.** If today has no schedule and the window has already begun
   (the server came up late, or the account was created mid-day), moments are
   generated only in what remains of the window, starting 5 minutes from now,
   with as many moments as fit at `min_gap_min`; with less than 60 minutes left
   the day is skipped (reliability.md §2.1). Every status change updates
   `updated_at`.
5. **Settings change mid-day** (`PUT /api/settings`): new settings drive
   generation from the next local day. Of today's `planned` rows, those outside
   the new window, and the latest ones beyond `new count − sent today`, become
   `cancelled`, `reason = settings` (`cancelForNewSettings`). Nothing is added
   today. A new `tz` is handled by §9.3.
6. **Pause.** The user can pause reminders for 1, 3 or 7 days
   (`PUT /api/settings/pause`, `accounts.reminders_paused_until` = now + N × 24
   h; a new pause replaces a running one) and resume at any time (`DELETE`). The
   schedule is generated as usual; a moment that falls before the end of the
   pause is not sent but gets status `paused` (step 2). The gap stays in the
   journal and in the `reminders.jsonl` export and can be analysed apart from
   misses (methodology.md §5.3). An ended pause is not shown (`GET` returns
   `null`).

**Settings limits** (`server/routes/settings.ts`): `reminders_per_day ∈
[1..6]`,
`min_gap_min ∈ [30..240]`, `wake_end > wake_start` on the same day (a window
across midnight is not supported), and
`wake_end − wake_start ≥
(reminders_per_day − 1) × min_gap_min + 60 min` (5 h
for three reminders 2 h apart; otherwise `422 window_too_short`). Uniform
coverage of the window starts at `reminders_per_day × min_gap_min` (6 h for
three); a window between the two bounds is accepted and keeps its count with the
rejection sampling.

**What the client sees.** The journal is served only for the past
(`scheduled_for ≤ now`): future moments never leave the server, otherwise the
random sampling would stop being unpredictable to the participant
(methodology.md §1.1).

Uniform coverage is under test (time-of-day bias is an artefact, methodology.md
§5.4): χ² over hourly bins for one and three moments a day
(`server/services/scheduler_test.ts`).

### 9.2 Push payload and tapping a reminder

```json
{
  "title": "What's in the body?",
  "url": "/now?reminder=<id>",
  "tag": "emo",
  "renotify": true
}
```

The title is fixed and comes from `shared/i18n/push.ts` by `accounts.locale`: ru
«Что в теле?», uk «Що в тілі?», en «What's in the body?». The forbidden words
never appear in a notification (copy.md §8.2). The `tag` is always `emo`: a new
notification replaces the old one, they never pile up; `renotify: true` makes
the replacing one sound again, so an unanswered one never silences the next.

The service worker shows the notification with `data: { url, shownAt }`
(`shownAt`: when it appeared). On a tap it opens or focuses a window with `url`;
if more than 15 minutes have passed since `shownAt`
(`REMINDER_RESPONSE_WINDOW_MIN` in `shared/protocol.ts`; `sw.js` keeps its own
copy), it opens `/now` instead — a `manual` entry, and the reminder stays
unanswered. The window counts from appearance, not from `scheduled_for`: a push
with a TTL may arrive late. An entry the person starts themselves (Home "Now",
`/now`) while a notification younger than 15 minutes is visible on the device
answers it: `random` with its `reminder_id`, and the notification is closed
(`client/src/lib/reminderLink.ts`, reliability.md §2.3).

To an open window the service worker passes the address as an `open-url`
message. If a form is open there, the tap is spent and changes nothing: the
address does not change, an open help sheet and its history entries stay, the
draft keeps its `trigger` and `reminder_id`. In any other view an open sheet is
first closed with its history entries (`unwindAll`), then the address changes.
How `trigger` is set — ui.md §6.1.

### 9.3 Time zones

The client sends its IANA `tz` when it changed on this device since it last sent
it (`meta.tz_sent`), so two devices in different zones never pull the account
back and forth (§8.3 step 5). The next day is planned in the current zone. On a
`tz` change the `planned` rows that in the new zone fall outside the window or
on another local date become `cancelled`, `reason = tz_change`
(`cancelForNewTz`): travelling never brings a reminder at night or two days'
worth in one. The rest are sent as planned; a day left with no rows is planned
again in the new zone from now (step 4 of §9.1). Otherwise what was built for
today is not recomputed (the settings rule is step 5). `tz_offset_min` in an
entry is recorded by the device independently. DST rules — reliability.md §2.2.

### 9.4 Platform limits

- iOS: push only for a PWA on the home screen (iOS ≥ 16.4); permission only on a
  user gesture.
- No platform gives a PWA local scheduled notifications — hence the server
  scheduler.
- Android/Chrome: the system may drop a subscription; the client checks at every
  open and subscribes again (§7.3).

---

## 10. Export, backup, deletion

### 10.1 User export

From Settings, after decryption in memory (`client/src/lib/export.ts`, formats
in `shared/export.ts`):

| File                         | Contents                                                                                                                                                                                                                                                                                                                                                                   |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entries.jsonl`              | One entry per line: the open payload (data.md §2) as it is plus `received_at` — keys only. The dictionaries with all labels come as `dictionaries.json` of the same `schema_v`                                                                                                                                                                                             |
| `entries.csv`                | A flat table, arrays joined by `;`, UTF-8 with a BOM for Excel; keys as they are. Columns: `CSV_COLUMNS` in `shared/export.ts` (`ui_copy` empty without `ui`, 1 without the field; `ui_layout` empty without the field); optional `*_label` columns in the language chosen at export, after them. New columns are only ever appended, so earlier columns keep their places |
| `reminders.jsonl`            | The reminder journal (past rows only, as in the API) with the day's `tz` and the cancel `reason`                                                                                                                                                                                                                                                                           |
| `emo-bundle-YYYY-MM-DD.json` | A portable encrypted copy (format below)                                                                                                                                                                                                                                                                                                                                   |

Files are handed over with `Blob` + download. The server has no export: it has
nothing readable to export. A device that evicted old entries for lack of space
(`meta.evicted`) fetches all entries from the server into memory for the export
(it does not write them to IndexedDB) and lays its own over them; offline it
exports what it has and says the old entries are missing
(`settings.data.export.partial`): a lost row would read as an unanswered
reminder (methodology.md §5.3).

**`emo-bundle` v1** (fixed; fields are only ever added; type `EmoBundleV1`):

```json
{
  "format": "emo-bundle", "version": 1,
  "exported_at": "2026-10-07T10:00:00.000Z", "app_version": "0.1.0",
  "instance": "emo.example.org", "account_id": "0192f1c4-…",
  "keyrings": [ { "key_version": 1, "rev": 3, "kdf": { … }, "dek_wrapped_pass": { … }, "dek_wrapped_recovery": { … } } ],
  "entries":  [ { "id": "…", "key_version": 1, "nonce_b64": "…", "ct_b64": "…", "deleted": false, "received_at": "…" } ],
  "prefs":    { "key_version": 1, "nonce_b64": "…", "ct_b64": "…", "updated_at": "…" },
  "reminders": [ { "id": "…", "local_date": "…", "tz": "Europe/Kyiv", "scheduled_for": "…", "sent_at": "…", "status": "sent", "reason": null } ]
}
```

`keyrings` holds the current revision. No plaintext email is in the bundle (the
encrypted `prefs` carries it, §2.3). `prefs` may be `null`; tombstones have
`null` nonce and ciphertext. Ciphertext and AAD are as on the server, so
decrypting needs only the passphrase or the recovery key.

**`emo decrypt-bundle FILE --out DIR [--recovery]`** — a subcommand of the same
binary (`server/cli/decrypt_bundle.ts`); it works offline with no server and no
database. It asks for the passphrase (or the recovery key with `--recovery`),
uses the `shared/` code the client uses, and writes `entries.jsonl`,
`entries.csv`, `reminders.jsonl` and `dictionaries.json` to `DIR`. Entries are
checked as in the client (`readEntry`): those that fail go only to
`entries.jsonl`, marked `_invalid`; entries from a newer app version are not
written; both counts are printed. So the encrypted export is useful even if the
instance is gone (ops.md §7.4).

### 10.2 Operator backup and restore

Procedures are in ops.md §4; what matters to the architecture:

- `make backup` runs `emo backup` in the container:
  `PRAGMA wal_checkpoint(TRUNCATE)` and
  `VACUUM INTO 'backups/emo-YYYYMMDD-HHMM.sqlite'` through `node:sqlite`, a copy
  to the host, rotation `KEEP=30`. It refuses to run without `BACKUP_ENV_DIR`,
  where it copies `.env`.
- Entry content in a backup is ciphertext. **`.env` with `SERVER_SECRET` and the
  VAPID keys** is backed up separately and kept away from the database (§5.7).
- `make verify-backup FILE=…` checks a copy without touching the live database.
- `make restore FILE=…` stops the service and runs `emo restore`:
  `PRAGMA integrity_check`, `MAX(schema_migrations.version)` ≤ the binary's,
  file swap, `-wal`/`-shm` removed, **a new epoch** in `meta.epoch`; then start.
  Clients see the new epoch and upload everything they hold (§8.3 step 0a); only
  what no device has is lost.

### 10.3 Deleted accounts and backups

Deletion — §4.5. Operator backups are not purged of deleted accounts at once:
the entries there are ciphertext without keys, but `email_enc` is readable with
`SERVER_SECRET`. So the backup retention (`KEEP`, default 30 days, which also
bounds the other database copies in `backups/`, ops.md §4.1) is also the time
after which a deleted account's email is gone everywhere; the operator tells
users this.

---

## 11. Localisation mechanics

Three languages from the first release: `en`, `uk`, `ru` (BCP 47; Ukrainian is
`uk`, never `ua`). Adding a language is one strings file plus a label in each
dictionary item. How to write strings — copy.md §1.

### 11.1 Data carries no language

- Entries hold only dictionary keys (data.md §2). Changing a label is an
  interface change, never a data migration.
- The only free text is `note` (and `context_other`); its language is not
  recorded. Labels for any entry are rebuilt from its keys in any language.
- Export carries keys plus the full dictionary with every label; analysis picks
  its output language itself.

### 11.2 What is translated

| Layer                                                                                   | Where                                                         | Read by             |
| :-------------------------------------------------------------------------------------- | :------------------------------------------------------------ | :------------------ |
| Dictionary labels (`BODY_ZONES`, `QUALITIES`, `WORDS`, `URGES`, `CONTEXT_TAGS`, …)      | `shared/dictionaries.ts`, `label: { ru, uk, en }`             | client, export      |
| Glossary descriptions                                                                   | `shared/glossary.ts`, `shared/glossary/*.ts`                  | client              |
| UI strings: screens, hints, slider poles, aria labels of body zones, onboarding, errors | `shared/i18n/ui.{en,uk,ru}.ts`, keys in `shared/i18n/keys.ts` | client              |
| Push title                                                                              | `shared/i18n/push.ts`                                         | server (§9.2)       |
| Mails: sign-in code, recovery key                                                       | `shared/i18n/mail.ts`                                         | server              |
| Stop-words of the `note` validator                                                      | `shared/i18n/note-stopwords.ts`                               | client (ui.md §8.2) |
| Forbidden words                                                                         | `shared/i18n/forbidden.ts` + tests                            | tests               |
| Built-in privacy notice                                                                 | `client/public/privacy.html` (en/uk/ru)                       | browser             |

Not translated: the manifest name `Emo`, logs, dictionary keys, the API.

### 11.3 Strings and locale

- No runtime i18n library. Each language is a typed object
  `Messages = Record<MessageKey, string>`; TypeScript requires completeness, so
  a missing key does not compile. Parameters are `{name}` placeholders filled by
  `fill`; plural keys have `.one` / `.few` / `.many` / `.other` forms chosen
  with `Intl.PluralRules` (`shared/i18n/interpolate.ts`; the client binds one
  language at a time, `shared/i18n/format.ts` binds all three for the server and
  tests). Plural keys — copy.md §5.
- English ships in the app shell (the default, and the text of a boot that fails
  before the language is known); `ru` and `uk` are lazy chunks, loaded before
  they are applied (`client/src/lib/i18n.ts`, performance.md §1.1).
- Locale choice: at first run, the first of `navigator.languages` whose
  two-letter base is supported, else `en`; after that, explicit in Settings.
  Stored in IndexedDB `meta.locale` and sent to the server in
  `PUT /api/settings` → `accounts.locale` (§8.3 step 5), so mail and push use
  the same language. Before the client reports one, mail uses `DEFAULT_LOCALE`
  (default `en`); registration sends the locale with the code.
- `<html lang>` is set on every change; dates and times use
  `Intl.DateTimeFormat` with the interface language.
- No runtime fallback to `en`: completeness is guaranteed by types and tests,
  never by showing another language.
- Uk and ru labels run 20–40 % longer than English; dictionary button layouts
  are checked on the longest language; soft hyphens (`­`) break words that do not
  fit a button (copy.md §6).

### 11.4 Dictionary labels are an instrument

The labels of `WORDS` (8 categories, 60+ refinements), `QUALITIES` and `URGES`
are not interface strings but a measurement instrument (methodology.md §2.2,
methodology.md §2.12). A literal translation does not guarantee equivalent
meaning. Therefore:

- Dictionary translations are reviewed by the owner of the data spec, not the
  developer. A draft label carries `review: "pending"`
  (`shared/dictionaries.ts`); the reviewer removes the marker.
- The release gate fails while any `pending` label or glossary description
  remains (`shared/release_test.ts`, run with `EMO_RELEASE=1` by
  `make release-check`).
- One key for all languages: entries made under different interface languages
  compare by key, even where label nuances differ.

### 11.5 Invariants under test

- Completeness: every `MessageKey` and every dictionary key has all three
  languages (this repeats the type check for the exported dictionaries).
- The forbidden words appear in no UI or push string in any language (copy.md
  §8.2).
- `note` length is counted in code points, not bytes or UTF-16 units: 160
  Cyrillic characters are 160.
- The stop-word corpora pass and fail as specified, in every language,
  apostrophes included (ui.md §8.2).
