<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — reliability

How Emo behaves when something fails, the reminder edge cases, the service
worker lifecycle, security headers and account caps, client startup, clocks, and
what the tests must cover. Endpoint shapes and error codes are in `api.md`;
every code named here exists there. Schema evolution (entry payload,
dictionaries, IndexedDB, keyring, SQLite migrations) is in data.md §8.1. Fixed
identifiers used below never change once data exists (README.md, "Fixed names
and formats").

Principles:

1. **Data over UI.** A failure may degrade a screen, never lose a saved entry or
   a draft the user can still see.
2. **Never crash a batch on one item.** Pulls, decrypts and exports skip and
   count bad items.
3. **The UI never blocks on the network.** Every network failure is a quiet
   status, not a modal, except where the user explicitly started a network
   action (sign-in, sending the recovery mail).
4. **Plaintext never touches disk.** Entries, prefs and the in-progress draft
   are stored encrypted with the DEK. Without the DEK, the draft lives in memory
   only.
5. **Forward-only, transactional, backed-up migrations** on both the server
   (SQLite) and the client (IndexedDB).

User-facing wording is in `shared/i18n/ui.en.ts` (keys in
`shared/i18n/keys.ts`); this file names the key where one exists and otherwise
says what the screen tells the person.

---

## 1. Failure-mode catalogue

Each scenario gives its detection, the behaviour, what the user sees, and the
tests (U = unit, I = server integration in `server/api_test.ts` and the route
tests, P = Playwright in `e2e/`; see §6).

### 1.1 Client storage (IndexedDB)

- **`QuotaExceededError` on writing an entry or the draft.** Detected by the IDB
  error name. Keep the item in memory in an `unsaved` list and retry the write
  after the next successful `sync()`. Server-confirmed ciphertext may be evicted
  from the local `entries` cache first, oldest synced first, keeping the last
  500 (`evictSyncedEntries`), until the write succeeds; this sets
  `meta.evicted`. Outbox items are never dropped. User sees: sync dot pending;
  Settings → Data says storage is full and how many entries are kept in memory
  until synced (`errors.storageFull`). Test: U (`sync_test.ts`, `db_test.ts`).
- **The browser evicted the `keys` store (DEK and auth key gone), ciphertext
  present.** On startup `keys.get('dek')` is undefined while `meta.account_id`
  exists. Route to **Unlock** (passphrase or recovery key); unlocking re-derives
  the auth key too. Entries, outbox and prefs are untouched; after unlock the
  draft decrypts again. User sees: the Unlock screen (`auth.unlock.body`). Test:
  U, P.
- **The browser evicted everything (no `meta`) while the session cookie
  survives.** `meta` is empty and `GET /api/session` → 200 (gives `account.id`).
  Treat as a new device on an existing account: fetch the keyring → Unlock →
  full pull from `seq = 0`. User sees: Unlock, then Home with the sync dot
  pending until the pull completes (`auth.newDevice.downloading` progress).
  Test: I, P.
- **The browser evicted everything and the cookie.** `meta` empty,
  `GET /api/session` → 401. The sign-in flow (existing-account path). Test: P.
- **A `draft` store write fails (DEK missing, quota).** The write rejects. The
  form continues in memory. Abandon detection uses an in-memory last-interaction
  timestamp; if the page is killed, the draft is lost (no `abandoned` entry can
  be written — accepted). User sees nothing. Test: U.
- **IDB open blocked by another tab holding an older `DB_VERSION`.**
  `onblocked`. Post `{type: 'db-upgrade'}` on `BroadcastChannel('emo')`; other
  tabs close their connection and reload after the current step completes (never
  mid-save). The other tab briefly shows that it is reloading. Test: U
  (`idb/schema_test.ts`).
- **IDB corrupted or cannot open.** `open` rejects with a non-version error,
  retried once. Show the recovery screen (`errors.storageDamaged`: entries
  already synced are safe on the server). Primary "Try again"
  (`errors.storageDamaged.retry`) reloads: an open that failed once, such as a
  lost WebKit connection, often works on the next load. Secondary "Reset this
  device" (`errors.storageDamaged.reset`) first asks in a destructive confirm
  (`errors.storageDamaged.confirm.*`: check-ins not yet on the server will be
  lost; everything synced comes back; Cancel · Reset this device). Confirmed, it
  deletes the database, keeps the cookie and does a full pull (the app asks for
  the passphrase first: the keys were local). Test: U, P (`system.e2e.ts`).
- **An entry write fails with an error other than quota on Save / Stop here /
  Skip check-in.** `commitEntry` rejects. The form stays on its step with every
  answer and the draft as they were; the next tap tries again; a step change
  clears the line; diagnostics event `checkin.save_failed`. Nothing is lost.
  User sees `checkin.save.failed` above the footer's ways out (ui.md §6.5).
  Test: P (`saved.e2e.ts`).
- **Undo's tombstone write fails (Saved screen).** `emergencyUndo` rejects. The
  check-in stays saved: Saved brings back Done / Undo and restarts its 5 s;
  diagnostics `checkin.undo_failed`. If only the draft's write after the
  deletion fails, the form still comes back from memory. Undo never waits for
  the `DELETE`: the background sync pass sends it (data.md §2). User sees
  `checkin.saved.undoFailed` above Done / Undo. Test: U (`sync_test.ts`), P
  (`saved.e2e.ts`).
- **History open after synced ciphertext was evicted.** `meta.evicted = true`.
  History lists what is still on this device; its end line adds that older ones
  are kept on the server (`history.end.evicted`, ui.md §15.12). Nothing is
  pulled back. Test: U.
- **Export after synced ciphertext was evicted.** `meta.evicted = true`. The
  export pulls every entry from the server into memory (nothing is written to
  IndexedDB) and lays this device's rows over it; offline it exports what is
  here and says older check-ins are not in the file
  (`settings.data.export.partial`). Test: U (`export_test.ts`).

### 1.2 Crypto / keys

- **Wrong passphrase.** The AES-GCM unwrap of `dek_wrapped_pass` throws
  `OperationError`. Attempts are counted locally (no server call); after 5, each
  attempt waits 30 s (`FREE_ATTEMPTS`, `RETRY_DELAY_MS` in
  `client/src/lib/unlock.ts`; anti-shoulder-surf only, the real protection is
  Argon2id). User sees `auth.unlock.wrong`, then `auth.unlock.wait`, and the
  "Use recovery key" link. Test: U (`unlock_test.ts`).
- **Corrupted keyring (malformed JSON, wrong lengths, bad base64).** Schema
  validation of `GET /api/keyring` before the KDF. Never run the KDF on it.
  Fetch `?all_revisions=1` and try the newest revision that validates (revisions
  are append-only). If none validates, show the error; the operator can revert a
  revision (ops.md §7). User sees `auth.unlock.keyringDamaged`. Test: U
  (`unlock_test.ts`).
- **The newest keyring revision does not unwrap with a passphrase that unwrapped
  the previous one** (a bad write from another device). GCM failure on rev n,
  success on rev n−1. Use rev n−1, log `keyring.rev_fallback` in diagnostics,
  and offer "Re-save keys" (`settings.data.resaveKeys`), which writes a fresh
  revision from this device. Nothing shows unless the user opens Settings →
  Data. Test: U.
- **Recovery key typo.** The checksum (last 32 bits, architecture.md §5.1) fails
  after normalisation. No unwrap attempt. User is told to check the key (8
  groups of 4 characters). Test: U (`shared/crypto/recovery_test.ts`).
- **Wrong recovery key** (valid checksum, another account or an old key). GCM
  tag failure on `dek_wrapped_recovery`. Same as a wrong passphrase; the message
  says the key does not match this account. Test: U.
- **GCM tag failure on a pulled entry.** Decrypt throws. Keep the ciphertext in
  `entries`, flag it `undecryptable` (`entryCheck.ts`), continue the pull. Retry
  decryption after any keyring change. Never upload, never tombstone
  automatically. User sees, in Settings → Data, how many entries could not be
  decrypted (`settings.data.unreadable.corrupt.*`, hidden at 0). Test: U
  (`entryCheck_test.ts`), I.
- **An entry decrypts but fails `shared/entry.ts` validation.** Treat as
  readable but invalid: keep it, flag `invalid`, exclude it from the CSV export
  (it goes into JSONL with `"_invalid": true`), count it in Settings → Data.
  Every sync pass checks a row not flagged `ok` again, so the flag clears once a
  build that reads it runs (data.md §8.1). Test: U (`entryCheck_test.ts`).
- **An entry with a `key_version` higher than any local keyring.** Field
  compare. Fetch the keyring again once; if still missing → `undecryptable`.
  Same counter. Test: U.
- **The Argon2id Worker fails (WASM unsupported, out of memory at 64 MiB).**
  Worker error or `RangeError`. Retry once with the same parameters on the main
  thread (slow but correct; diagnostics `kdf.fallback_main_thread`). If it still
  fails, say this browser cannot derive the key
  (`auth.passphrase.kdfUnsupported`, needs about 64 MB). Never silently lower
  `m_kib`: the keyring fixes the parameters. Test: U.
- **The decrypt Worker cannot run** (no Worker, the `CryptoKey` cannot be cloned
  into it, a crash). Worker error or `DataCloneError`. The same batches of 200
  run on the main thread, yielding between batches (`performance.md` §3.1);
  diagnostics `decrypt.fallback_main_thread`. User sees nothing; History or the
  export may open more slowly. Test: U, P (`history.e2e.ts`).
- **Argon2id is slow.** A timer: after 3 s the progress text says the derivation
  is slow on this device and happens once; it keeps going (the budget is in
  `performance.md` §1.2). Test: P (throttled CPU).
- **`crypto.subtle` unavailable (not a secure context).** Feature check at boot.
  Block the app with `errors.needsHttps` — the only case where a blocking screen
  is acceptable. Test: U.

### 1.3 Sync

- **`409 entry_blob_mismatch` on `PUT /api/entries/:id`** (same id, different
  blob). Log `sync.conflict` with both ids; re-key the local entry under a new
  UUID v4 (re-encrypt with the new AAD), re-queue; keep the old id in
  `meta.renamed[]` for diagnostics. User sees nothing. Test: U (`sync_test.ts`).
- **`410 entry_deleted` on `PUT`** (the id was deleted on another device). Drop
  the outbox item and the local ciphertext, keep a local tombstone. **Never**
  re-key: that would resurrect a deleted entry. User sees nothing. Test: U, I.
- **Server restored from a backup** (`X-Emo-Epoch` ≠ `meta.server_epoch`, or a
  pull with `max_seq < cursor_seq`). The procedure of `api.md` §3: re-queue
  every local entry (tombstones as `DELETE`s), reset the cursor to 0, re-upload
  prefs, sync, store the new epoch. Idempotent: safe to run twice. User sees the
  sync dot pending for a few seconds. Test: U, I.
- **An outbox item older than 24 h.** Its enqueue timestamp. Show the stale
  state (architecture.md §8.5) and keep retrying on every trigger. User sees the
  sync dot's ring and `home.sync.stale` under the pane dots. Test: U.
- **The outbox has items and the user taps Sign out.** Refuse until synced, or
  until the user taps "Discard N unsynced check-ins"
  (`settings.devices.signOut.discard.*`, a second tap on a plain, not red,
  button whose text repeats the count). Test: P.
- **Two tabs or windows open (desktop).** Always possible. `sync()` runs under
  `navigator.locks.request('emo-sync')`; a second caller waits for the lock,
  then runs its own pass: it pushes what its tab saved meanwhile, and its pull
  starts at the cursor, so it costs little. A deletion (Undo, History) does not
  take the lock: its tombstone and the `delete` op that replaces any pending
  upload are one IndexedDB transaction, and a pass writes back to the outbox
  only while an item is still the one it sent (architecture.md §8.3 step 1). So
  a pass stalled on a hung request never holds an Undo, and the `DELETE` goes on
  the next pass. The form's owner holds the `emo-draft` lock; a second tab
  opening `/now` while it is held says a check-in is open in another window and
  offers "Go to it" (primary, right) beside "Close" (secondary, left) in the
  footer row on `/now`, and in History's gate (ui.md §6.5); "Go to it" sends
  `draft-ping`, which asks the tab with the form to focus itself. Prefs, theme,
  locale, lock and sign-out changes go on the single `BroadcastChannel('emo')`
  as `{type, payload}` (`client/src/lib/channel.ts`: `prefs`, `locale`, `lock`,
  `signout`, `db-upgrade`, `draft-ping`, `entries`); receivers apply them
  without a reload. `entries` (no payload) follows a local save or delete: an
  open History reconciles (ui.md §15.13). Test: U (fake locks,
  `draftLock_test.ts`), P (`saved.e2e.ts`, `history.e2e.ts`).
- **History open during a first full pull** (new device, after a restore). The
  pull starts at `seq = 0`. History shows what is local; its end line reads
  `home.sync.pending` until the pass ends, then it reconciles (ui.md §15.14).
  Test: U, P.
- **Web Locks API unavailable (old Safari).** Feature check. Fall back to a
  `meta.lock` row with a 30 s lease and the tab id, taken in one IndexedDB
  transaction (`client/src/lib/db.ts`); same semantics. Test: U (`db_test.ts`,
  `sync_test.ts`).
- **Device clock wrong.** On every API response the client compares the HTTP
  `Date` header with `Date.now()` (not `received_at`: an idempotent re-upload
  returns the first upload's). Skew = Date − now. Above 5 min either way it
  stores `meta.clock_skew_sec` and logs once per session. **Never rewrite `ts`**
  of existing entries; new entries keep the device's `ts`; the export includes
  `received_at` so analysis can correct. User sees one line in Settings → Data
  (`settings.data.clockSkew`). Test: U (`sync_test.ts`).
- **Session expired or revoked mid-sync (`401 unauthenticated`).** Stop the
  cycle, leave the outbox intact, set `meta.signed_out = true`. No automatic
  re-login. User sees the sync dot "Not synced" (`home.sync.signedOut`); a tap
  opens sign-in. After sign-in the same device re-fetches the keyring only if
  `keys` is missing, then resumes `sync()`. That sign-in screen is "Sign in to
  sync" (no invite field; "Use a different account", "Back"); sync stops while
  it is open. A sign-in that returns a **different** `account.id`: next item.
  Test: I, P (`switch.e2e.ts`).
- **Another account on a device that holds one** (a sign-in as another account,
  "Use a different account", or that account's session cookie at start).
  `account.id` from verify ≠ `meta.account_id`; every request carries
  `X-Emo-Account` (`api.md` §1). Never mix: the server refuses another account's
  session for this device's requests (401), and `checkSession` never adopts it
  (it ends that session instead). The person chooses on one screen
  (`auth.switch.*`): **"Clear this browser and continue"** wipes the device (a
  second tap, "Discard N unsynced check-ins", when the outbox is not empty) and
  goes on as the new account, or to a plain sign-in; **"Back"** ends the other
  account's session and returns to this device's account. The screen shows the
  new email (masked), how many check-ins this browser holds and how many the
  server lacks, and that what is on the server stays there. Test: U
  (`session_test.ts`), I, P (`switch.e2e.ts`).
- **Account deleted on another device.** `401 account_gone`. Stop sync; show one
  informational screen (`errors.accountGone`); on "OK" wipe all IDB stores and
  go to sign-in. Do **not** wipe before the user has seen the message. Test: I,
  P (`account.e2e.ts`).
- **A pulled entry with an unknown higher `schema_v`.** After decrypt. Store no
  plaintext: keep the ciphertext, flag `needs_newer_app`, exclude it from the
  export; checked again on every sync pass, so it shows once the app is updated.
  User sees, in Settings → Data, how many entries need a newer app
  (`settings.data.unreadable.newer.*`). Test: U.
- **`426 upgrade_required`** on any `/api` call. Stop sync; show the update
  card's "needed" state (§3). Saving locally still works. User sees
  `common.update.required.title` with "Restart and update", and
  `common.update.getting` (disabled) while no new worker waits. Test: I
  (`app_test.ts`), P (`update.e2e.ts`).
- **Pull pagination interrupted (offline mid-way).** The fetch rejects.
  `cursor_seq` only advances after each page is persisted; the next trigger
  restarts from the cursor. Sync dot pending. Test: U, I.
- **`PUT /api/prefs` from two devices (last write wins).** Nothing to detect.
  The server overwrites; a client applies the server blob on the next `GET` if
  its `updated_at` is newer than the local write. The theme may flip to the
  other device's choice — accepted. Test: I (`prefs_test.ts`).
- **`PUT /api/keyring` returns `409 keyring_conflict`.** Another device changed
  the passphrase or the recovery key. Re-fetch, unwrap the new revision with the
  **new** passphrase (ask the user, `auth.unlock.keysChanged`), then retry the
  change once. Test: U, I (`keyring_test.ts`).
- **`403 auth_proof_invalid` on a Proof route.** The cached auth key is missing
  or stale (not expected). Ask for the passphrase (`errors.forbidden`),
  re-derive, retry once. Test: U.

### 1.4 Auth / session

- **SMTP down when requesting a login code.** The mail circuit is open →
  `503 mail_unavailable` for **every** address (`api.md` §2.1); the request that
  opened the circuit got `202` and simply receives no mail. The client shows the
  message (`errors.codeSendFailed`) and a retry countdown from
  `retry_after_sec`. No code row is created and no rate-limit slot is taken on
  503. Test: I (`auth_test.ts`).
- **Any failed verification** (wrong, expired, exhausted, superseded by a newer
  code, unknown email). `400 code_invalid`, deliberately identical for all. Keep
  the code field; offer "Resend code" as soon as the resend countdown allows
  (`auth.code.invalid`, `auth.code.resendIn`). Test: I, P.
- **Rate limited (`429`).** Status and `Retry-After`. Disable the button for
  that many seconds with a countdown (`errors.tooManyRequests`). Test: I.
- **Unknown email, `REGISTRATION=open` (the default).** `request-code` → `202`;
  a registration code is mailed, a usable invite stored with it. Not an open
  relay: one fixed template, per-address and per-IP limits. The client shows the
  code screen; the right code creates the account. Test: I (`auth_test.ts`).
- **Unknown email and no usable invite, `REGISTRATION=invite`.** `request-code`
  → `202`, identical to success, **nothing queued** (no open relay). Any code →
  `code_invalid`. The code screen then shows `auth.code.inviteNote` ("A new
  account needs an invite code"), so a person without one learns what to do.
  Test: I (`auth_test.ts`), P (`switch.e2e.ts`).
- **Invite valid but the email is already registered.** The server treats it as
  a login (invite untouched). Normal sign-in. Test: I.
- **Cookie rejected** (third-party cookie settings, in-app browsers).
  `GET /api/session` → 401 right after a successful verify. Tell the person to
  open Emo in Safari or Chrome, not inside another app (`errors.inAppBrowser`,
  with "Copy link"). Test: P.
- **Session revoked from another device.** The next call →
  `401
  unauthenticated`. As for an expired session: outbox kept; local data
  and the DEK stay until the user signs out here. Sync dot "Not synced". Test:
  I.
- **Lock on this device.** User action. Delete `keys.dek` and `keys.auth` only;
  keep the session and all data; no server call; broadcast `{type: 'lock'}`.
  Unlock screen on the next open. Test: U, P.
- **Sign out.** User action. Check the outbox (confirm the discard if not empty)
  → `POST /api/auth/logout` (a network failure is ignored) →
  `indexedDB.deleteDatabase` → clear the `localStorage` CSS cache → broadcast
  `{type: 'signout'}` → reload to sign-in. Test: P.

### 1.5 Server / scheduler / database

- **A scheduler tick still running when the next fires.** An in-process busy
  flag. Skip the tick; log `scheduler_tick_skipped` with the lag in ms;
  `/healthz` reports `scheduler_lag_sec` and is unhealthy (`503`) above 180 s,
  logged once as `scheduler_lag_high`. Test: U (`scheduler_test.ts`).
- **Two server processes on one database (operator error).** The scheduler lease
  in `meta` is held by another holder (`server/services/lease.ts`, 120 s TTL).
  Only the lease holder plans and sends; the other logs `scheduler_standby`
  every 10 min and serves HTTP normally. Test: I (`lease_test.ts`).
- **Server down across the day.** On restart, the first tick plans the rest of
  the day only (§2.1); `planned` rows more than 30 min overdue → `cancelled`,
  `reason = overdue` (architecture.md §9.1). Fewer reminders that day. Test: U.
- **`SQLITE_BUSY`.** Should not happen: one connection per process and no
  `await` inside a transaction (`performance.md` §4.1). An external process
  holding a write lock (e.g. `emo backup` via `docker compose exec`) is waited
  for up to `PRAGMA busy_timeout = 5000`, then the request gets `503 db_busy`
  (log `db_busy`); there is no retry on the server. The timeout blocks the event
  loop with the synchronous driver — another reason never to hold a transaction
  across I/O. The client retries on the next trigger. Test: U.
- **A migration fails at startup.** An exception inside the migration
  transaction. All pending migrations run in **one** transaction; it rolls back;
  the process logs `migration_failed` with the failing file and exits with
  code 2. Before it starts, the server writes
  `DATA_DIR/backups/pre-migrate-<from>-to-<to>-<ts>.sqlite` via `VACUUM INTO`
  (the last 3 are kept). The container restarts in a loop and the operator sees
  the logs. Rules: data.md §8.5. Test: I (`db_test.ts`).
- **Database file missing on start.** Opening creates it; all migrations run;
  log `db_created`. If `DATA_DIR` is not writable → exit 3. A database newer
  than the binary (`db_newer_than_binary`) → exit 4. Test: I (`db_test.ts`).
- **Disk full.** `SQLITE_FULL`. Mutations return `507 insufficient_storage` (log
  `db_full`); reads continue. `/healthz` stays `ok` (its `SELECT 1` still
  works), so `db_full` in the logs is the signal (ops.md §5.2). The client keeps
  the outbox: sync pending. Test: U.
- **`.env` secrets missing.** Boot validation. Exit 1 with the list of missing
  variables; never start with a secret generated in memory. Test: U
  (`config_test.ts`).
- **`SERVER_SECRET` changed.** Every `email_hmac` lookup would fail and logins
  fail for everyone. Detected at boot:
  `HMAC(SERVER_SECRET,
  "emo-secret-check")` is compared with the value stored
  in `meta` at first run; on a mismatch the server refuses to start with an
  explicit message. Test: I (`secret_check_test.ts`).
- **VAPID keys changed.** The push service answers `401`/`403`. Drop the
  affected subscriptions as on `410`; clients re-subscribe on the next open
  (they compare `applicationServerKey` with `GET /api/push/vapid`). Reminders
  resume after the next app open. Test: I (`push_test.ts`).
- **Unhandled exception in a route.** Hono `onError`. `500 internal` envelope
  whose message names the request id (also in `X-Request-Id`); no stack to the
  client; logged as `http_unhandled` with the stack (redacted). The client
  retries quietly. Test: U (`app_test.ts`).
- **`SIGTERM` (or `SIGINT`).** Stop accepting, finish in-flight requests, the
  scheduler and background mail tasks (at most 10 s), checkpoint the WAL
  (`TRUNCATE`), close the database, exit 0. Test: P (`server.e2e.ts`).
- **Server process down behind the reverse proxy.** A 5xx without `X-Emo-Server`
  (`isEmoAnswer`, `client/src/lib/network.ts`). Treated as no answer: the outbox
  is kept and the probe asks again after 10 s, backing off to 60 s. Emo's own
  errors carry `X-Emo-Server` (set before the epoch lookup, so a failing
  database does not drop it). User sees the band "Can't reach the server"
  (`errors.unreachable`) and the dot "Not connected" (state `unreachable`).
  Test: U (`network_test.ts`, `app_test.ts`), P (`sync.e2e.ts`).

### 1.6 Push

- **The push service returns `410 Gone` or `404`.** Delete the subscription row;
  log `push_subscription_gone`. Nothing visible; the device re-subscribes on its
  next open. Test: U, I (`push_test.ts`).
- **The push service returns `429` / `5xx`.** That subscription is retried on
  the next tick while `scheduled_for ≥ now − 30 min`. The reminder becomes
  `sent` as soon as any subscription accepts it, `failed` if none did by the end
  of the window (architecture.md §9.1). Per subscription: `failed_count` grows
  **once per reminder** (after its retry window ends without success, not per
  tick), resets to 0 on any success, and the row is dropped at
  `failed_count ≥ 5`. Test: U (`scheduler_test.ts`).
- **Android rotated the subscription silently.** On every app open:
  `pushManager.getSubscription()`'s endpoint ≠ `meta.push_endpoint`.
  `POST
  /api/push/subscriptions` with the new one and
  `replaces: <old endpoint>`; the server upserts by endpoint and deletes the old
  row. Test: U, P.
- **Subscription exists locally, the server has none** (restored from an older
  backup). `GET /api/push/subscriptions` on open does not list this device's
  endpoint. Re-POST. Test: I.
- **Notification permission `denied`.** `Notification.permission`. The Settings
  switch is disabled and off, with the blocked line and a platform hint
  (`settings.reminders.denied`, `settings.reminders.help.*`; iOS: Settings →
  Notifications → Emo; Android: site settings). Test: P.
- **iOS, not installed (`navigator.standalone === false`).** No subscription is
  possible; onboarding's step 3 shows install instructions
  (`auth.install.ios.*`); the Settings switch says to install Emo to the Home
  Screen first (`settings.reminders.needsInstall`). Test: P.
- **No device has received reminders for more than 3 days.** `GET /api/settings`
  → `receiving_reminders: false` (no subscription now and no reminder sent in 3
  days). One quiet line in Settings → Reminders (`settings.reminders.noDevice`).
  Never a push (there is no channel) and never an email. Test: I.
- **Every device switched off (or gone).** No `push_subscriptions` row. The
  account still gets its schedule for 30 days after its last `sent` reminder
  (`NO_DEVICE_PLAN_MS`); each due moment becomes `cancelled`,
  `reason = no_device`, so the gap is in the journal rather than missing from it
  (methodology.md §5.3). After that, no rows. Test: U.
- **The service worker receives a push with an unknown payload or a missing or
  foreign `url`.** JSON parse and a check of the URL (`/now` or
  `/now?reminder=<uuid>`). Show a notification with the fixed fallback title
  (English, `"What's in the body?"`, since the worker imports nothing) and
  `url: '/now'`: the check-in's trigger becomes `manual` — accepted. Test: U
  (`sw_test.ts`).
- **The user taps a notification more than 15 min after it appeared.** The
  notification's `data.shownAt`, set by the service worker when it showed it.
  The worker opens `/now` instead of the reminder URL: a `manual` check-in, and
  the reminder stays unanswered in the journal (`REMINDER_RESPONSE_WINDOW_MIN`
  in `shared/protocol.ts`; `client/src/sw.js` keeps its own copy). Within 15
  min, or for a notification without `shownAt`: `trigger = random`,
  `reminder_id` set; `latency_sec` counts from form open, not from the push; the
  response delay `ts − latency_sec − sent_at` is derived in analysis from the
  journal. Test: U (`sw_test.ts`).
- **The person opens Emo themselves (Home "Now", `/now`) while a reminder's
  notification shows.** `getNotifications({tag: "emo"})`: one whose `shownAt` is
  at most 15 min ago. A new check-in starts as `trigger = random` with that
  `reminder_id`, and the notification is closed
  (`client/src/lib/reminderLink.ts`): the person answered the signal, just not
  through the notification (methodology.md §1.1). An open draft keeps its own
  (§2.3); `after_event` is never linked; without the Notifications API →
  `manual`. Test: U (`reminderLink_test.ts`, `checkin_test.ts`).
- **A reminder tapped while Emo is open on History or Settings.**
  `notificationclick` finds a window. `postMessage({type: 'open-url', url})`
  first, then `focus()`; the app opens the check-in (`trigger = random`, the
  `reminder_id`) from any pane; an open form keeps its own; auth, lock and
  recovery screens wait for Home. The person gets the check-in, never History.
  Test: U (`sw_test.ts`), P (`pwa.e2e.ts`).

### 1.7 Mail

- **SMTP connection refused or timing out (10 s).** A nodemailer error in the
  send. Log `mail_failed`; open the mail circuit for 5 min (every `request-code`
  and `recovery-mail` → `503 mail_unavailable`); the failed login code row is
  deleted; a recovery-mail slot is given back. `/healthz` reports
  `mail: circuit_open`. The circuit closes after 5 min; the next send is the
  probe. See §1.4 for what the user sees. Test: I (`mail_test.ts`,
  `auth_test.ts`).
- **SMTP accepted but the mailbox bounces.** Not observable. The user requests a
  new code.
- **Recovery mail requested more than 3 times in 24 h.** Counted per account in
  `mail_log(account_id, kind, sent_at)` (no body). `429` with `Retry-After`; the
  user is told it was already sent 3 times today (`auth.recovery.email.limit`).
  Test: I (`account_test.ts`).
- **A recovery key, code, token or passphrase would reach the logs.** The log
  sanitiser (`server/log.ts`) drops fields that may carry secrets
  (`recovery_key`, `code`, `passphrase`, `token`, `X-Emo-Auth`, …) and redacts
  any 8×4 Crockford pattern in strings, messages and stacks before the sink.
  Test: U (`log_test.ts`).
- **A locale missing for a mail template.** The type system: it does not
  compile; there is no runtime fallback. Test: U (`shared/i18n/mail_test.ts`).

### 1.8 Client diagnostics

The operator cannot see the user's phone, and there is no client error endpoint
(one less unauthenticated surface). Instead (`client/src/lib/diag.ts`):

- **Ring buffer**: `meta.diag`: the last 100 records `{ ts, code, where }`.
  `code` is an `ErrorCode`, a DOMException name or a fixed client event name
  (`sync.conflict`, `keyring.rev_fallback`, `kdf.fallback_main_thread`,
  `decrypt.fallback_main_thread`, `note.rejected`, `note.rejected_resolved`,
  `note.rejected_cleared`, `checkin.save_failed`, `checkin.undo_failed`, …);
  `where` is a module name. **Never** entry content, ids, emails, keys or URLs
  with parameters.
- **Counters**: `meta.diag_counts` keeps lifetime counts per event name (no
  timestamps, no content), so the review of the note validator has numbers after
  the ring buffer has rotated.
- **Copy**: Settings → Data → "Copy diagnostics" puts on the clipboard: app
  version, server version, epoch prefix (8 chars), platform/UA family,
  `persisted`, `clock_skew_sec`, counts (outbox, undecryptable, needs-newer-app,
  renamed), the lifetime counters and the ring buffer. The user decides whether
  to send it to the operator.
- **Test**: `diag_test.ts` feeds the client error paths and asserts no record
  holds anything outside the allowlisted shape.

CSP violations are not recorded on the device; the Playwright CSP suite catches
them (§4.1).

---

## 2. Reminder scheduling edge cases

The base algorithm is architecture.md §9.1; the code is
`server/services/scheduler.ts`. This section fixes the gaps.

### 2.1 Late generation (server was down, or account created mid-day)

A day is planned an hour before its window opens (`GENERATE_LEAD_MS`), or at the
first tick after that:

```
remaining_min = wake_end_local − max(now_local, wake_start_local)
if remaining_min < 60: skip today, log reminders_skip_day
count = min(reminders_per_day, floor(remaining_min / min_gap_min) + 1)
window = [max(now_local + 5 min, wake_start_local), wake_end_local]
sample count moments in window with pairwise gap ≥ min_gap_min (circular sampling
  when count × min_gap_min fits, else rejection sampling with the fallback)
```

Generation happens once per `(account_id, local_date)`: the "no rows for this
date" check and the inserts run in one `BEGIN IMMEDIATE` transaction under the
single writer. The unique index on `(account_id, local_date, scheduled_for)`
only prevents duplicate rows; it would not stop two different random schedules —
the transaction does. Rows cancelled by a time-zone move (`tz_change`) do not
count as that day's schedule. A day without room is remembered in memory so it
is not sampled again every tick.

### 2.2 DST and time zones

- **Local window → UTC**: For each `local_date`, resolve `wake_start`/`wake_end`
  with `Temporal` in the account's `tz` (built into the pinned Deno; the server
  refuses to start without it). A non-existent local time (spring forward) → the
  next valid instant; an ambiguous one (fall back) → the earlier instant
  (Temporal's `compatible` disambiguation).
- **Transition days**: The window may be 23 or 25 h wide; planning uses the real
  width.
- **Tests**: `Europe/Kyiv`, `Europe/Berlin` and `America/New_York` on their
  transition days (`scheduler_test.ts`).
- **tz change mid-day**: `planned` rows that in the new tz would fall outside
  the wake window or on another local date → `cancelled`, `reason = tz_change`;
  the rest are sent as planned. A day left without rows is planned again in the
  new tz from now (§2.1); tomorrow is planned in the new tz. Each row stores the
  `tz` its day was planned in. A device sends its tz only when it changed there
  (`meta.tz_sent`), so two devices in different zones do not move the account
  back and forth.
- **Account tz invalid (client bug)**: The server validates the zone on
  `PUT /api/settings`; invalid → `422 tz_unknown`; the previous tz stays.

### 2.3 Interaction with the form

- **Reminder tapped while a draft is open (same device)**: The draft keeps its
  original `trigger`/`reminder_id`; the new `reminder_id` is ignored by the
  form, and the journal still has it as `sent`. With the form open in this
  window the tap is spent and changes nothing: no URL change, and an open help
  sheet keeps its place and its history entry. On any other view an open sheet
  is unwound (`unwindAll`) before the URL changes. Compliance (client-side
  analysis): a reminder whose `scheduled_for` falls between the draft's start
  and its save counts as answered by that entry.
- **Reminder tapped after an `abandoned` finalisation**: A new form,
  `trigger = random`, the new `reminder_id`.
- **Undo of a check-in skipped on step 1**: The entry is deleted and a fresh
  draft keeps its `trigger` and `reminder_id`, whichever screen reopens the form
  (Home toast or Saved screen).
- **Two reminders due at once (clock jump)**: Send both; `tag: "emo"` means the
  device shows only the last (with `renotify`, so it still sounds); the first is
  still `sent` in the journal.
- **Multiple devices**: Every subscription gets the push; `tag` dedups per
  device only; one entry results — accepted. A phone may still show a
  notification answered on another device: opening Emo there within 15 min links
  the same `reminder_id` again.
- **User changes `reminders_per_day` or the window mid-day**: New settings drive
  generation from the **next** local day. Today: `planned` rows outside the new
  window are `cancelled`; if the new count is lower, the latest `planned` rows
  beyond `new_count − already_sent_today` are `cancelled` (`reason = settings`).
  Nothing new is generated today (architecture.md §9.1 step 5).
- **Client asks for the journal**: `GET /api/reminders` returns only rows whose
  time has passed. Future times never leave the server, so the schedule stays
  unpredictable to the person being sampled.

### 2.4 Permission and subscription states (Settings → Reminders)

| State                                              | Switch                                | Line under it                                                                                     |
| :------------------------------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------ |
| granted + subscribed                               | on                                    | —                                                                                                 |
| granted, no subscription (rotated, server lost it) | on → the client re-subscribes on open | —                                                                                                 |
| `default` (never asked)                            | off                                   | a prompt to allow notifications                                                                   |
| `denied`                                           | off, disabled                         | blocked in system settings + platform hint (`settings.reminders.denied`)                          |
| iOS not installed                                  | off, disabled                         | install Emo to the Home Screen first (`settings.reminders.needsInstall`)                          |
| no device has received reminders for > 3 days      | per device as above                   | `settings.reminders.noDevice` (account-level: `GET /api/settings` → `receiving_reminders: false`) |

---

## 3. Service worker lifecycle

Code: `client/src/sw.js` (the worker), `client/src/lib/update.ts` (the page's
side), `client/vite.config.ts` (`emoServiceWorker`, which writes the build's
`sw.js`).

- **Registration**: `/sw.js` at scope `/`, registered on `load` (after the first
  paint).
- **Caches**: `emo-shell-<build>` (the precache), `emo-runtime` (other
  same-origin files on first use), `emo-fonts-<hash>` (fonts on first use; named
  after the build's font files, so a changed font is fetched again).
- **Precache**: every file of the build except `fonts/`, `sw.js`,
  `source.tar.gz` and `.vite/` — the shell, icons, the lazy chunks and the
  built-in pages — plus the **default theme's (Calm) fonts**. Other themes'
  fonts are cached in `emo-fonts-<hash>` when a theme first uses them
  (`performance.md` §2.1).
- **`/api/*` and `/healthz`**: not handled by the worker (network only, never
  cached); the server sends `Cache-Control: no-store` on `/api`.
- **Navigation**: a path without an extension gets the cached shell
  (`index.html`) first, so the app opens offline; a page's short address
  (`/methodology`) gets that page from the cache; `/privacy.html` or
  `/source.tar.gz` is fetched as itself.
- **Other requests**: cache first, then the network; only an `ok`, same-origin
  answer whose type fits the request is cached (HTML only for a navigation,
  never under a script URL).
- **Update detection**: `registration.update()` right after registering and on
  `visibilitychange → visible` (at most once per 10 min); a worker reaching
  `installed` while the page is controlled → "ready".
- **Update UI**: The update **card** under the pane bar on Home, History and
  Settings (ui.md §3). "Ready" (`common.update.ready.*`) with Restart now /
  Later (24 h per waiting version, `localStorage`); "Update needed to sync" on
  `426` (`common.update.required.*`), no Later, "Getting the update…" until a
  worker waits. While another tab holds `emo-draft` (the form open) the card
  says to finish or close the check-in first (`common.update.draftOpen`) and its
  button is disabled. Restart: await a running sync pass (`emo-sync`), post
  `{type: 'SKIP_WAITING'}`, reload on `controllerchange`, else after 8 s; the
  same version still waiting after the reload → `common.update.failed`. Settings
  → About also offers Restart.
- **Never**: an automatic `skipWaiting`, an automatic reload, an update prompt
  inside the check-in.
- **Activate**: delete every cache not in the current set, then
  `clients.claim()`.
- **Old client vs new server**: The server reads `X-Emo-Client`; client major ≠
  server major, or client minor < server minor − 1 → `426` with `min_client`
  (`api.md` §1). The client stops sync, calls `registration.update()` and shows
  the card's "needed" state. Saving locally keeps working.
- **New client vs old server**: The client reads `X-Emo-Server`; server minor <
  client minor − 1 (same major) → sync paused, with `settings.data.serverOlder`
  on Home and in Settings → Data. Never send a request shape the server may not
  know.
- **Push handler**: Self-contained: never imports app code; the payload is
  `{title, url, tag, renotify}` (architecture.md §9.2); a parse failure or a
  foreign URL → the fallback notification (§1.6). Notifications use
  `tag: "emo"`, `renotify: true` and record `shownAt`.
- **Notification tap**: The message first, then focus: the page switches to the
  check-in while still in the background; with no window, `openWindow(url)`.
- **Build**: `<build>` is a hash of the names and bytes of every precached file,
  so identical builds produce a byte-identical worker and no spurious update.

---

## 4. Security headers and limits

### 4.1 Headers

The server sets these on **every** response (`server/app.ts`), static files,
`/api` and errors alike:

- **`Content-Security-Policy`**:
  `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`
  — identical for every response, so the cached shell stays valid.
  `'wasm-unsafe-eval'` is for the Argon2 WASM module and allows no JS `eval`.
- **`Strict-Transport-Security`**: `max-age=31536000; includeSubDomains` (set by
  Emo even though TLS terminates in the reverse proxy; harmless if duplicated).
- **`Referrer-Policy`**: `no-referrer`.
- **`Permissions-Policy`**:
  `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`.
- **`X-Content-Type-Options`**: `nosniff`.
- **`Cross-Origin-Opener-Policy`**: `same-origin`.
- **`Cross-Origin-Resource-Policy`**: `same-origin`.
- **`X-Frame-Options`**: `DENY` (legacy mirror of `frame-ancestors`).
- **`X-Emo-Server`, `X-Emo-Epoch`, `X-Request-Id`**: `api.md` §1.
- **`Cache-Control`**: `/api/*`: `no-store`; `/assets/*` (hashed):
  `public, max-age=31536000, immutable`; `/sw.js`:
  `no-cache, no-store, must-revalidate`; `index.html`, the manifest and every
  other file: `no-cache, must-revalidate`; `/source.tar.gz`: `no-cache`.

**Style and script rules.**

- **No inline script, no nonce**: The shell is static and cached by the service
  worker, so a per-response nonce cannot work. The first-paint theme is applied
  by the tiny external script `/boot.js` (precached): it reads
  `localStorage['emo-css']`, calls `document.documentElement.style.setProperty`
  for each variable and sets `<meta name="theme-color">`. CSSOM calls are not
  subject to `style-src`.
- **No `style="…"` attributes**: Svelte template markup is parsed as HTML; a
  `style` attribute in it is an inline style and is **blocked** without
  `'unsafe-inline'`. Components use classes and `style:prop={value}` directives
  (applied through CSSOM). `make lint` (`tools/check_repo.ts`) fails on any
  `style=` attribute in `.svelte`/`.html` files. The prototype
  (`design/prototype/*.dc.html`) uses inline styles throughout: port the values
  into classes and tokens, not the markup.
- **Scoped CSS**: Svelte compiles component styles into the bundled stylesheet,
  so `style-src 'self'` suffices. Transitions use the Web Animations API or
  Svelte's transitions (no injected `<style>`).
- **SVG**: Presentation attributes (`fill`, `stroke`, `opacity`, `clip-path`)
  are not inline styles and are allowed; the body map must not use `style=` on
  SVG elements either.
- **Dev server**: `make dev` (dev mode) sends the same CSP minus
  `upgrade-insecure-requests` (dev is plain `http://localhost`); the production
  binary sends it in full. Pages served by Vite (HMR) never carry it.
- **Detection**: `e2e/csp.e2e.ts` opens every screen of the compiled app —
  sign-in, onboarding, Home, every check-in step, Saved, Settings in every theme
  and language with every sheet, lock, unlock, the recovery-key screen and
  History — and asserts zero `securitypolicyviolation` events and no uncaught
  page error.

### 4.2 Limits

Request sizes, pagination and rate limits per endpoint are in `api.md`
§1.3–§1.4. Account-level caps enforced by the server:

| Resource                       | Cap                                                          | On overflow                                                     |
| :----------------------------- | :----------------------------------------------------------- | :-------------------------------------------------------------- |
| Entries per account            | 100 000 live entries                                         | `PUT` → `413 account_full`; tombstones still accepted           |
| Ciphertext per entry           | 16 KiB                                                       | `413 payload_too_large`                                         |
| Prefs blob                     | 32 KiB                                                       | `413 payload_too_large`                                         |
| Push subscriptions per account | 10                                                           | the oldest by `created_at` is evicted                           |
| Sessions per account           | 20                                                           | the least recently used (`last_seen_at`) go at the next sign-in |
| Invites per user (if enabled)  | `INVITES_PER_USER` (default 5) unused, unexpired             | `409 invite_limit`                                              |
| Login codes                    | 3 per email / 15 min; 10 per IP / h; one live code per email | `429` + `Retry-After`                                           |
| Code attempts                  | 5 per code; 10 failed per email / 24 h                       | code deleted / `429`                                            |
| Recovery mail                  | 3 per account / 24 h                                         | `429`                                                           |
| Keyring writes                 | 10 per account / h; revisions kept until account deletion    | `429`                                                           |

---

## 5. Storage persistence and client startup

### 5.1 Persistence

- After onboarding's last step, and at each start once signed in, the client
  calls `navigator.storage.persist()` unless storage is already persisted
  (`client/src/lib/storage.ts`). The result goes to `meta.persisted`; no UI
  either way.
- Settings → Data reads `navigator.storage.estimate()`; at `usage / quota > 0.8`
  it shows `settings.data.storageNearlyFull`.
- iOS offers nothing beyond the installed PWA; the 24 h stale-outbox warning is
  the compensating control.

### 5.2 Startup sequence

Target: Home interactive within one frame of the IndexedDB open.

```
1. boot.js: read localStorage['emo-css'] → setProperty on :root (before first paint)
2. open IDB (DB_VERSION); run migrations if needed
3. read meta → no account_id? → GET /api/session if online (cookie may survive) → else Onboarding/Sign-in
4. keys.get('dek') / keys.get('auth') → missing? → Unlock (keyring from cache in meta.keyring, else GET)
5. render Home (Now button focusable); draft present? → resume or finalise (10-minute rule, by last_interaction_at only — a reload does not finalise)
6. background: register SW → sync() under lock (epoch check first) → push subscription check → storage.persist()
```

Nothing in steps 1, 2, 4 and 5 touches the network; step 3 only when local state
is missing. Step 6 failures are quiet.

### 5.3 Clocks

- **`ts`**: `Date.now()` at save, ISO UTC.
- **`latency_sec`**: `Math.round((save_at − started_at) / 1000)` on the wall
  clock; `started_at = Date.now()` when step 1 is first shown, stored in the
  encrypted draft, so it survives reloads. For abandoned entries the end is
  `last_interaction_at`.
- **`hidden_sec`**: The sum of hidden intervals inside that span:
  `visibilitychange → hidden` stores `hidden_since` in the draft; `→ visible`
  (or a resume after a reload) adds `now − hidden_since`. Active time =
  `latency_sec − hidden_sec`.
- **`tz_offset_min`**: `-new Date().getTimezoneOffset()` at save.
- **Abandon threshold**: Compares `Date.now()` with the draft's
  `last_interaction_at`; the only rule (a reload within 10 minutes resumes).
- **Clock skew**: §1.3; informational only.

---

## 6. Test matrix

What the automated tests must cover. Unit tests run under `deno test`
(fake-indexeddb, mocked `fetch`/`crypto` where needed); server integration tests
use an in-memory SQLite with stub mail and push; Playwright runs against the
compiled binary (`make e2e`). How to run them: development.md §6.

- **Storage** — Must be tested: quota error keeps the outbox; eviction states
  route to Unlock / new device; `onblocked` broadcast; damaged-DB recovery and
  its confirm. Where: `client/src/lib/sync_test.ts`, `db_test.ts`,
  `idb/schema_test.ts`, `e2e/system.e2e.ts`.
- **Crypto** — Must be tested: the stored test vectors (architecture.md §5.5)
  byte for byte, in Deno and in Chromium; wrong passphrase vs malformed keyring;
  keyring revision fallback; the recovery-key checksum catches every
  single-character typo; undecryptable entries flagged while the pull continues;
  unknown `key_version`; Argon2 Worker fallback; every entry ciphertext has the
  same length. Where: `shared/crypto/*_test.ts`, `e2e/vectors.e2e.ts`,
  `client/src/lib/unlock_test.ts`, `keyring_test.ts`, `entryCheck_test.ts`,
  `shared/entry_test.ts`.
- **Sync** — Must be tested: 409 re-key; **410 drops, never re-keys**; epoch
  change → full re-queue and cursor reset (and `max_seq < cursor_seq` does the
  same); the cursor advances per page; clock skew from `Date`; 401 stops the
  cycle and keeps the outbox; another account's session is refused;
  `account_gone` order; 426; `keyring_conflict` retry; Web Locks and the lease
  fallback. Where: `client/src/lib/sync_test.ts`, `session_test.ts`,
  `db_test.ts`, `e2e/switch.e2e.ts`, `e2e/account.e2e.ts`, `e2e/update.e2e.ts`.
- **Schema** — Must be tested: `entry.v2.json` validates; an unknown future
  version is flagged; `locations: []` rejected; dictionary `retired`/`pending`
  rules; IDB upgrade from each historical version (data.md §8.3). Where:
  `shared/entry_test.ts`, `entryCheck_test.ts`, `shared/release_test.ts`,
  `idb/schema_test.ts`.
- **Scheduler** — Must be tested: late-generation counts for remaining windows
  of 0, 59, 60, 180, 600 min; DST days for three zones; one schedule per day
  under the transaction; a mid-day settings change cancels out-of-window and
  over-count rows and adds none; tz change; the journal never returns a future
  row; a second process stays on standby; skip-when-busy with lag logging.
  Where: `server/services/scheduler_test.ts`, `lease_test.ts`,
  `server/routes/reminders_test.ts`.
- **Push** — Must be tested: 401/403/404/410 delete; 429/5xx retry window, the
  reminder `sent` if any subscription accepted; drop at `failed_count ≥ 5`;
  rotation re-POST with `replaces`; endpoint validation; headers `TTL: 1800`,
  `Urgency: high`, `Topic`; a malformed payload → the fallback notification; the
  15-min response window. Where: `server/services/push_test.ts`,
  `server/routes/push_test.ts`, `client/src/lib/sw_test.ts`,
  `reminderLink_test.ts`.
- **Auth** — Must be tested: verify answers for unknown email / wrong / expired
  / exhausted / superseded code are byte-identical; `request-code` returns
  before SMTP; the mail circuit → 503 for every address; open vs invite
  registration; concurrent verifies; at most 20 sessions; `X-Emo-Auth` required
  on keyring PUT, entry DELETE and account DELETE. Where:
  `server/routes/auth_test.ts`, `server/services/mail_test.ts`,
  `keyring_test.ts`, `account_test.ts`, `entries_test.ts`.
- **Server** — Must be tested: boot validation of env; the `SERVER_SECRET`
  check; migration rollback with the pre-migrate copy; no `await` inside the
  transaction helper (type-level: `tx` takes a synchronous callback); SIGTERM
  drains within 10 s. Where: `server/config_test.ts`, `secret_check_test.ts`,
  `server/db/db_test.ts`, `tx_types_test.ts`, `e2e/server.e2e.ts`.
- **Logs and diagnostics** — Must be tested: redaction of recovery keys, codes,
  tokens and `X-Emo-Auth` on every log path; client diagnostics records match
  the allowlisted shape (§1.8) Where: `server/log_test.ts`,
  `client/src/lib/diag_test.ts`.
- **Headers** — Must be tested: every response carries the §4.1 set; `/api` is
  `no-store`; `X-Emo-Epoch` on every response; 426 outside the window; missing
  files are 404, only pages get the shell. Where: `server/app_test.ts`.
- **Protocol** — Must be tested: every server response matches its
  `shared/protocol.ts` schema. Where: `server/protocol_test.ts`.

Server integration scenarios (`server/api_test.ts` and the route tests):

- Login with a failing SMTP stub: the first request is `202`, its mail fails,
  the circuit opens; the next requests are `503` for known and unknown emails
  alike; no code rows; counters unchanged.
- `REGISTRATION=invite`, unknown email without an invite: `202` and no mail.
  `REGISTRATION=open`: a code is mailed and the right code creates the account.
- Session revoked on device A → device B gets 401 on its next sync, the outbox
  is kept, a new sign-in resumes.
- Account deleted on A with the proof → B gets `account_gone`; a delete without
  the proof → 403 and nothing deleted.
- Server restored from an older backup: clients see the new epoch, re-upload the
  entries created after the snapshot and re-POST their subscriptions; the server
  ends with every entry any client still had.
- Prefs last-write-wins between two clients.
- 426 for an old `X-Emo-Client`.

Playwright (`e2e/`):

- Two pages: the draft-lock notice and "Go to it", History in step after a
  delete in another tab (`entries`), the account switch.
- History (ui.md §15.19 item 15): open, expand, delete, an offline delete
  reaching another context, the draft gate, pages, axe + 44 px + CSP across the
  presets, 320 px in ru and uk.
- An offline save, then online sync, then a second context sees the entry.
- The update card appears only outside a draft; the restart flow.
- Zero CSP violations on every screen in every preset (`csp.e2e.ts`).
- A reminder tap opens the check-in from any pane (`pwa.e2e.ts`).

Rules without a dedicated automated test (checked by hand before a release):
quota exhaustion in a real browser and recovery after sync; the `denied` and
iOS-not-installed states in Settings → Reminders; prefs broadcast and sign-out
propagation between two pages; the slow-Argon2 progress text under a throttled
CPU.
