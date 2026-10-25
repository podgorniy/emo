<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — operations

Running an instance: the operator commands, install and configuration, upgrade
and rollback, backup and restore, observability, secrets and administration.
Audience: the person running an instance. Everything is driven through the
`Makefile`; there is no other documented way. Working on the code (dev server,
tests, CI, releases) is `development.md`.

Fixed identifiers: binary `bin/emo` (`/emo` in the image), image `emo`, compose
service `emo` (container `emo`, the proxy `emo-caddy`), database
`DATA_DIR/emo.sqlite`, container data volume `/data` (host `./data`), base image
`gcr.io/distroless/cc-debian12:nonroot` (no shell, no `sqlite3`, no `curl`:
every operation is an `emo` subcommand).

## 1. Lifecycle commands

`make` alone (`make help`) lists the everyday targets with this instance's
`BASE_URL`. The operator targets:

- `make init [DOMAIN=…] [EMAIL=…]`: Copies `.env.example` → `.env` if missing
  (an existing `.env` is left alone), generates `SERVER_SECRET`
  (`openssl rand -hex 32`) and a VAPID key pair, sets
  `BACKUP_ENV_DIR=~/emo-env-backups` and mode 600. `DOMAIN=emo.example.org` (a
  host name, no scheme) also sets `BASE_URL=https://DOMAIN` and
  `COMPOSE_PROFILES=https` (§2.3); `EMAIL=` sets `VAPID_SUBJECT=mailto:EMAIL`,
  `SMOKE_EMAIL` and `OPERATOR_CONTACT`. Prints what still needs filling. Without
  Deno on the host the keys come from the image, which it builds first.
  `VAPID=regen` replaces the VAPID pair of an existing `.env` (§6.2). Needs:
  nothing.
- `make vapid-keys`: `emo vapid-keys`: prints a VAPID key pair to paste into an
  existing `.env`
- `make docker-build [REV=…]`: Multi-stage image tagged `emo:latest`,
  `emo:<VERSION>` and `emo:<commit>` (short SHA, `-dirty` with local changes;
  `REV=` names the build instead, for a checkout without git). With `EMO_IMAGE`
  set, the tags are on that name. Needs: Docker.
- `make up` / `down` / `logs`: `docker compose up -d --wait --wait-timeout 60`:
  a container that does not become healthy is shown with its last 15 log lines
  and stopped, not left restarting. `make up` refuses without the compose
  plugin, with a `.env` not exactly mode 600, and with a `BASE_URL` that has a
  path or trailing slash; on Linux it gives `./data` to the container's user
  (uid 65532) when run as root, or names the `chown` to run. With the built-in
  proxy it waits about a minute for `BASE_URL/healthz` over HTTPS. It prints the
  address to open and builds the image only when none exists: after a code
  change, `make docker-build` first. `down` is `docker compose down`; `logs`
  follows `emo` (`SERVICE=caddy` for the proxy). Needs: `compose.yml`, `.env`.
- `make cli ARGS="…"`: `docker compose exec emo /emo …`: any subcommand of §1.1
  inside the running container. Needs: running container.
- `make update [MANUAL=done]`: On the server (§3.1): `git fetch`, stops when the
  new `CHANGELOG.md` lines name a **Manual step** (until `MANUAL=done`),
  `git merge --ff-only @{u}`, then `make release`; stops at the first failure.
  Needs: git checkout with an upstream, running container.
- `make release [REV=…]`: On the server, the second half of `make update` once
  the code is in place: `make docker-build` (or `docker compose pull emo` with
  `EMO_IMAGE`), `make backup`, `make up`, `make smoke`, `make prune`. Needs:
  `.env`, running container.
- `make deploy [MANUAL=done]`: From your own machine:
  `ssh -t DEPLOY_HOST 'cd DEPLOY_DIR && make update'` (`DEPLOY_DIR` default
  `/srv/emo`); notes unpushed commits, since the server deploys what it pulls.
  Needs: ssh access.
- `make deploy-rsync [MANUAL=done]`: From your own machine, for a server
  checkout without git (§3.1): stops at a **Manual step** new compared with the
  server's `CHANGELOG.md`, copies the working tree as git sees it into
  `DEPLOY_DIR` (mirrored with `--delete`, keeping `.env`, `data/`, `backups/`,
  `backup.log`, `.git/`), then `make release REV=…` there. Needs: ssh access,
  `rsync` on the server.
- `make prune`: Removes all but the newest three commit-tagged images (the
  rollback targets), dangling images, and build cache unused for a week. Needs:
  Docker.
- `make migrate [DRY=1]`: `emo migrate` in a one-off container, without starting
  the server (normally the server migrates at startup); `DRY=1` prints the plan.
  Needs: stopped server.
- `make invite [USES=1] [EXPIRES=30d]` / `make invite REVOKE=<code>`:
  `emo invite`: creates a code and prints it once (`USES>1` is an admin
  multi-use code), then the address to register at; or revokes one. Needs:
  running container.
- `make backup [KEEP=30]`: `emo backup` inside the container plus a copy of
  `.env`, rotation (§4.1). **Refuses unless `BACKUP_ENV_DIR` is set and outside
  `./data`**. Needs: running container.
- `make cron`: Installs the schedule in the user's crontab (lines tagged
  `# emo:`, replaced on each run): `make backup` daily at 03:00 into
  `backup.log`, and `make ping` every 5 minutes when `PING_URL` is set; takes
  the first backup and sends the first ping now. Needs: `cron`, running
  container.
- `make ping`: Pings `PING_URL` when `BASE_URL/healthz` answers 200 and the
  newest `data/backups/emo-*.sqlite` is under 26 h old, else `PING_URL/fail`
  with the reason (§5.2). Needs: `PING_URL`.
- `make backup-pull`: From your own machine: `rsync` of the server's
  `DEPLOY_DIR/data/backups/` into `./backups` (gitignored) (§4.2). Needs: ssh
  access, `rsync` on both.
- `make restore FILE=…`: `docker compose down`, `emo restore FILE` in a one-off
  container, `docker compose up -d` (§4.3); then run `make smoke`
- `make verify-backup FILE=…`: `emo verify-backup FILE` inside the container:
  read-only checks, never touches the live DB (§4.4). Needs: running container.
- `make smoke [SEND=1]`: `emo healthcheck` must pass;
  `POST /api/auth/request-code` for `SMOKE_EMAIL` through `BASE_URL` with
  `X-Emo-Dry-Run: 1` must answer 202 (the dry run renders the mail and sends
  nothing; it applies only to `SMOKE_EMAIL`). `SEND=1` then runs
  `emo mail-test SMOKE_EMAIL`: a real sample sign-in mail, with the SMTP
  server's answer or why it could not be reached (§2.5). A 202 alone proves no
  mail: it is answered before sending. Needs: running instance.
- `make healthcheck`: `emo healthcheck` inside the container. Needs: running
  container.
- `make stats`: `emo stats`: operational counters from the DB (§5.4). Needs:
  running container.
- `make rotate-secret OLD=… NEW=…`: `emo rotate-secret` in a one-off container
  (§6.2). Needs: stopped server.
- `make accounts [EMAILS=1]` / `account-delete ID=…` / `login-code EMAIL=…` /
  `keyring-revert ID=… REV=…` / `entry-delete ID=… ENTRY=…`: Administration
  (§7). Needs: running container.
- `make decrypt-bundle FILE=… OUT=… [RECOVERY=1]`: `emo decrypt-bundle` on this
  machine through the host's Deno: no server, no DB (§7.4). Needs: Deno.

Every target is a thin wrapper over `deno task …`, `docker compose …` or an
`emo` subcommand; the `Makefile` has no logic of its own beyond argument checks.
A target that runs `emo` in the container first checks that the `emo` container
is running, and otherwise says so (naming `DEV=1` for the `make dev` database).
`DEV=1` makes any operator target run `emo` with the host's Deno against the
`make dev` instance (`./data-dev`, `http://localhost:8081`) instead of the
container. The development targets (`dev`, `dev-tunnel`, `build`, `test`,
`lint`, `fmt`, `ci`, `e2e`, `capture`, `perf`, `seed`, `release-check`,
`release-binaries`) are in `development.md` §2.

**Never run `bin/emo` (from `make build`) on `./data` while `make up` serves
it:** from outside the container it cannot see the server's SQLite locks and
deletes the WAL under it. `bin/emo` is for tests and releases; `make up` does
not use it.

### 1.1 `emo` subcommands (the only way to operate the binary)

| Subcommand                                                                                                                      | Purpose                                                                                                                                                                                                       | Server state     |
| :------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------- |
| `serve` (default)                                                                                                               | HTTP + scheduler                                                                                                                                                                                              | —                |
| `migrate [--dry-run]`                                                                                                           | apply pending migrations (pre-migration copy first)                                                                                                                                                           | stopped          |
| `healthcheck`                                                                                                                   | `GET http://127.0.0.1:$PORT/healthz`, prints the version, exit 0 on 200: the compose healthcheck                                                                                                              | running          |
| `backup [--keep N]`                                                                                                             | `wal_checkpoint(TRUNCATE)` + `VACUUM INTO` via `node:sqlite`, rotation (N ≥ 1, default 30)                                                                                                                    | either           |
| `restore FILE`                                                                                                                  | integrity check, version check, swap, new epoch                                                                                                                                                               | stopped          |
| `verify-backup FILE`                                                                                                            | read-only checks of a snapshot                                                                                                                                                                                | either           |
| `invite [--uses N] [--expires 30d] [--revoke CODE]`                                                                             | invite codes                                                                                                                                                                                                  | either           |
| `stats`                                                                                                                         | counters (§5.4)                                                                                                                                                                                               | either           |
| `vapid-keys`                                                                                                                    | print a new `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` pair in `.env` form                                                                                                                                      | no server needed |
| `mail-test ADDRESS`                                                                                                             | open a TCP connection to `SMTP_HOST:SMTP_PORT`, then send the sign-in mail with a sample code that signs nobody in; prints the SMTP answer or why the connection never opened (a firewall), exit 1 on failure | either           |
| `rotate-secret --old <hex> --new <hex>`                                                                                         | re-encrypt emails and unused invite codes under a new `SERVER_SECRET` (§6.2)                                                                                                                                  | stopped          |
| `accounts [--emails]`, `account-delete <id>`, `login-code <email>`, `keyring-revert <id> <rev>`, `entry-delete <id> <entry_id>` | administration (§7)                                                                                                                                                                                           | either           |
| `decrypt-bundle FILE --out DIR [--recovery]`                                                                                    | read an `emo-bundle` export offline (§7.4)                                                                                                                                                                    | no server needed |

`migrate`, `restore` and `rotate-secret` refuse while another process holds the
scheduler lease (architecture.md §9.1) and say to stop it (`make down`). A
cleanly stopped server releases the lease on `SIGTERM`; after a crash it expires
within 120 s. An unknown subcommand prints the usage line and exits 1.

## 2. Install and first run

### 2.1 Requirements

| Item   | Minimum                                                                                                                                                                                                                                                                                                                                       |
| :----- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host   | Linux x86_64 or arm64, Docker ≥ 24 with the compose plugin (Ubuntu's `docker.io` lacks it: `apt-get install docker-compose-v2`), `make`, `git`, `cron` (and `rsync` for `make backup-pull`), 1 vCPU, 512 MB RAM to run (container limit 256 MB), 1 GB or swap to build the image on it (the Vite build peaks near 410 MB), 5 GB disk          |
| Domain | HTTPS is mandatory (service worker, push, `Secure` cookies). A DNS `A` record (and `AAAA` only if the host serves IPv6) to the host; TLS terminates in the built-in Caddy or your own proxy (§2.3). With Cloudflare, set the record to DNS only: through its proxy every user arrives from Cloudflare's addresses and shares one per-IP limit |
| SMTP   | Any SMTP account you can authenticate a sending domain for (§2.5). Without working mail nobody can sign in                                                                                                                                                                                                                                    |

### 2.2 Steps

On a fresh Debian or Ubuntu host, as root (a non-root user in the `docker` group
works too; `make up` then names the one `sudo chown` it needs):

```bash
apt-get install -y curl make git cron rsync openssl
curl -fsSL https://get.docker.com | sh   # Docker already from Ubuntu (docker.io)? apt-get install -y docker-compose-v2
git clone https://github.com/podgorniy/emo.git /srv/emo && cd /srv/emo
make init DOMAIN=emo.example.org EMAIL=you@example.org
                               # .env with secrets, BASE_URL=https://DOMAIN and the built-in
                               # HTTPS; builds the image when the host has no Deno
$EDITOR .env                   # SMTP_*, DEFAULT_LOCALE; PING_URL for monitoring (§5.2)
make up                        # emo on 127.0.0.1:PORT and Caddy on 80/443, certificate included
make smoke                     # healthz + dry-run mail render
make smoke SEND=1              # a sample sign-in mail to SMOKE_EMAIL; shows the SMTP answer (§2.5)
                               # open BASE_URL and register (REGISTRATION=open, the default);
                               # with REGISTRATION=invite, `make invite` prints a code first;
                               # before anyone else signs up: §2.6
make cron                      # nightly backup (§4.1) and the 5-minute ping (§5.2)
```

### 2.3 Reverse proxy

**Built in.** `COMPOSE_PROFILES=https` in `.env` (`make init DOMAIN=…` sets it)
starts the `caddy` service of `compose.yml` (image `caddy:<version>-alpine`
pinned by digest) once `emo` is healthy: ports 80, 443 and 443/udp, a Let's
Encrypt certificate for `BASE_URL`'s host, renewed by Caddy and kept in the
`caddy_data` volume (it survives `make down`). Its whole configuration is the
`Caddyfile` at the root: `{$EMO_SITE}` (= `BASE_URL`) reverse-proxied to
`emo:{$EMO_PORT}` (= `PORT`), with the `Server` header removed, and a log
filter: Caddy keeps no access log, and its error lines (a `502` while the app
restarts) are written without the client's address, port, `X-Forwarded-For` or
`Cookie`, so the privacy notice's "IP addresses are not written down" holds. The
host's DNS must point to the server and ports 80 and 443 be reachable before
`make up`, which waits for the certificate.

**Your own.** When another web server already holds 80 and 443 on the host,
leave `COMPOSE_PROFILES` unset and proxy to `127.0.0.1:PORT`, 8080 unless `.env`
sets another port (the name `emo` resolves only inside the compose network).
Caddy on the host:

```caddyfile
emo.example.org {
	reverse_proxy 127.0.0.1:8080
	header -Server
}
```

Its error lines carry the client's address unless the global `log default`
filter of the root `Caddyfile` is copied into the host's Caddyfile too.

nginx, with a certificate from certbot
(`certbot certonly --nginx -d
emo.example.org` once DNS points at the host; its
timer renews it), as `/etc/nginx/sites-available/emo.example.org` linked into
`sites-enabled`, then `nginx -t && systemctl reload nginx`:

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name emo.example.org;

    ssl_certificate /etc/letsencrypt/live/emo.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/emo.example.org/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # The privacy notice promises IP addresses are not written down: no
    # access log (the app logs route, status and timing itself), and only
    # critical errors, since nginx's error lines carry the client's address
    access_log off;
    error_log /var/log/nginx/emo.example.org.error.log crit;
    server_tokens off;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;  # replaces any client-sent value
        proxy_set_header X-Forwarded-Proto https;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name emo.example.org;
    server_tokens off;
    access_log off;
    return 301 https://emo.example.org$request_uri;
}
```

The application itself sets `Content-Security-Policy`,
`Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`,
`X-Content-Type-Options` and the rest of reliability.md §4.1, and compresses its
answers; the proxy only terminates TLS (a duplicate HSTS header from the proxy
is harmless). Any proxy works as long as it forwards `Host`,
`X-Forwarded-Proto: https` and `X-Forwarded-For` (Caddy does all three by
default), and does not buffer `/api/*` responses longer than 30 s. A proxy
outside the private ranges needs its address in `TRUSTED_PROXIES` (§2.4), or
every client shares its per-IP limit.

### 2.4 `.env` reference

`.env.example` is the template, with a comment on every variable. Compose reads
`.env` both as the container's environment and for its own `${…}` values; the
`Makefile` reads single values from it (the last line wins).

- `BASE_URL`: required (`http://localhost:8080` in the template). An origin, no
  path, no trailing slash: `https://emo.example.org`. Used for cookie scope,
  `Origin` checks and mail text. Open the app at exactly this address: for a
  loopback `BASE_URL` the other spellings (`127.0.0.1`, `[::1]` for `localhost`)
  redirect to it, since keys, cookies and the `Origin` check are per origin.
- `DATA_DIR`: `/data` (set by the image). Holds `emo.sqlite`, `-wal`, `-shm`,
  `backups/` (snapshots and pre-migration copies).
- `SERVER_SECRET`: generated. 64 hex characters (256 bits). Required; a
  published example value is refused. Loss = all logins impossible (§4.5). The
  database remembers which secret it was created with (§2.7).
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: generated. Required, set together:
  base64url, the public key an uncompressed P-256 point (65 bytes), the private
  key 32 bytes. Changing them ends every push subscription; loss of the private
  key = all devices must re-subscribe.
- `VAPID_SUBJECT`: `mailto:admin@example.com`. `make init EMAIL=` sets
  `mailto:EMAIL`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
  `SMTP_FROM`: —, `587`, `false`, —, —, `"Emo <noreply@example.com>"`.
  `SMTP_HOST` and `SMTP_FROM` are required. Port 587 is STARTTLS
  (`SMTP_SECURE=false`); 465 is implicit TLS (`SMTP_SECURE=true`); a mismatch is
  refused at startup. `SMTP_FROM` must be on the domain authenticated in §2.5.
- `REGISTRATION`: `open`. `open`: anyone with an email may create an account (an
  invite code optional, still counted); `invite`: only with an invite code. An
  open server mails a sign-in code to any address that asks, within the
  per-address and per-IP limits (reliability.md §4.2).
- `INVITES_BY_USERS`: `true`. Users may create single-use codes in Settings.
- `INVITES_PER_USER`: `5`. Max unused codes per user at a time.
- `RECOVERY_MAIL_ENABLED`: `true`. Allows the "Email it to me" recovery channel.
- `DEFAULT_LOCALE`: `en`. `en` / `ru` / `uk` (anything else is refused); the
  mail language when neither the account nor the request supplies one (§6.3).
- `TRUSTED_PROXIES`: `private`. Peers whose `X-Forwarded-For` is read for per-IP
  rate limits (right-most untrusted hop): `private` (loopback, RFC 1918,
  link-local, IPv6 ULA), `none`, or exact addresses, comma-separated. Any other
  peer is the client itself, so the header cannot be spoofed.
- `LOG_LEVEL`: `info`. `debug` `info` `warn` `error`; `debug` adds a
  `scheduler_tick` line per tick.
- `PORT`: `8080`. The port the app listens on inside the container and is
  published at on the host's loopback (`127.0.0.1:PORT`), where a proxy of your
  own points.
- `BACKUP_ENV_DIR`: `~/emo-env-backups` (`make init`). Required by
  `make backup`: directory **outside** `DATA_DIR` where `.env` is copied.
- `DEPLOY_HOST`, `DEPLOY_DIR`: —, `/srv/emo`. On your own machine only: where
  `make deploy`, `make deploy-rsync` and `make backup-pull` reach the server
  over ssh (also as `make` arguments).
- `SMOKE_EMAIL`: `smoke@example.com`. Address used by `make smoke`; the only
  address the `X-Emo-Dry-Run` header applies to.
- `SOURCE_URL`: `<BASE_URL>/source.tar.gz`. Where users get the source of **this
  exact version** (AGPL §13). Unset, it is the build's own archive
  (`tools/pack_source.ts`; `make build` and the image carry it), which can never
  point at the wrong version. Set it to a public repository (your fork at the
  deployed tag if you changed anything) to link that instead; it must be an
  http(s) URL. Shown in Settings → About. Unset in a build without the archive,
  the server refuses to start.
- `CRISIS_URL`: `https://findahelpline.com`. "Find a helpline" link in About;
  set a local service if you know a better one for your users.
- `PRIVACY_NOTICE_URL`: —. Your privacy notice; shown in About and on the
  sign-in screen's About sheet. `/privacy.html` is the built-in one (en, uk, ru;
  `client/public/privacy.html`), which opens in the app's language: review it,
  and edit it if you run things differently (backup retention, mail provider).
- `OPERATOR_CONTACT`: —. Email or other contact for users of this instance;
  shown in About and on the sign-in screen.
- `COMPOSE_PROFILES`: —. `https` starts the built-in Caddy (§2.3);
  `make init DOMAIN=…` sets it. Read by `docker compose` itself.
- `PING_URL`: —. A healthchecks.io check's ping URL; with it `make cron`
  schedules `make ping` (§5.2).
- `EMO_IMAGE`: `emo` (the local build). A registry image instead, e.g.
  `ghcr.io/podgorniy/emo`, which CI publishes for every release tag
  (`development.md` §6): `make update` then pulls rather than builds, and a
  small host needs no memory for the build.
- `EMO_IMAGE_TAG`: `latest`. Image tag `make up` runs: a version, or a commit's
  build for local builds (a registry has only versions and `latest`); pin it to
  roll back (§3.2).
- `DEV_MAIL`: —. `make dev` only: `smtp` sends dev mail through `SMTP_HOST`
  instead of printing it (`development.md` §3.1).

### 2.5 Mail deliverability (do this before inviting anyone)

Login depends entirely on the code email arriving quickly and not in spam.

| Item             | Requirement                                                                                                                                                                                                                                         |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sending domain   | `SMTP_FROM` on a domain you control (e.g. `emo@example.org`); avoid free-mail addresses as sender                                                                                                                                                   |
| SPF              | TXT record on the sending domain including your SMTP provider (`v=spf1 include:<provider> -all`)                                                                                                                                                    |
| DKIM             | Enable signing at the provider; publish its selector TXT record                                                                                                                                                                                     |
| DMARC            | `_dmarc` TXT, at least `v=DMARC1; p=none; rua=mailto:<you>`; tighten to `quarantine` once reports are clean                                                                                                                                         |
| Reverse DNS      | Only if you run your own MTA: PTR must match the HELO name                                                                                                                                                                                          |
| Check            | `make smoke SEND=1` → `accepted`, then the mail arrives within 30 s in the inbox of a Gmail and an Outlook test address; view headers: `spf=pass`, `dkim=pass`, `dmarc=pass`                                                                        |
| Content          | Plain text, code in the subject, no links (`copy.md` §2.1) — this also helps spam scoring                                                                                                                                                           |
| Outage behaviour | Mail is sent in the background; after a failure the server returns `503 mail_unavailable` for 5 minutes and `/healthz` shows `mail: circuit_open` (reliability.md §1.7). If a user is locked out during a long outage, use `make login-code` (§7.2) |

### 2.6 Before other people sign up

Anyone may sign up on an open server (`REGISTRATION=open`, the default); to run
Emo only for yourself, set `REGISTRATION=invite`, which needs nothing more. As
soon as others sign up you hold data about them (email, metadata, encrypted
entries) and you serve them the code that handles their journal:

| Item                                                                                                        | Why                                                                                                                                                                                                                                                                         |
| :---------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Set `OPERATOR_CONTACT`                                                                                      | They need a way to reach you (deletion requests, outages)                                                                                                                                                                                                                   |
| Publish a privacy notice and set `PRIVACY_NOTICE_URL` (the built-in `/privacy.html`, reviewed, or your own) | Health-adjacent data (GDPR Art. 9 in the EU). State: what the server stores (Settings → About lists it), backup retention (`KEEP`, §4.1), how to request deletion (`make account-delete`, §7.1), who you are and your jurisdiction (the built-in notice leaves both to you) |
| Leave `SOURCE_URL` unset, or check it points to the code you actually run                                   | AGPL §13; also how a careful user can verify what runs on their data (architecture.md §2.2: the server's JavaScript is trusted)                                                                                                                                             |
| Optionally set `CRISIS_URL` to a local service                                                              | The default is an international directory                                                                                                                                                                                                                                   |
| Keep `RECOVERY_MAIL_ENABLED` deliberate                                                                     | Mailing a recovery key means you briefly see it (architecture.md §5.6)                                                                                                                                                                                                      |

### 2.7 When the server refuses to start

`emo serve` checks its configuration first and lists every problem at once
before exiting; `make up` then shows the container's last lines. The startup
sequence itself is reliability.md §1.5.

| Exit | Cause                                                                                                                                                                                                                                                                  | Fix                                                                              |
| :--- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| 1    | `.env` problems (`validateEnv` in `server/config.ts`): `SERVER_SECRET`, `BASE_URL`, `SMTP_HOST`, `SMTP_FROM`, VAPID keys missing or malformed; `PORT`/`SMTP_PORT` not a number; port/`SMTP_SECURE` mismatch; bad `REGISTRATION`, `DEFAULT_LOCALE` or `TRUSTED_PROXIES` | Fix `.env` as printed                                                            |
| 1    | `SERVER_SECRET` differs from the one the database was created with (`meta.secret_check`, an HMAC of a fixed string): nobody could sign in                                                                                                                              | Restore the old value from the `.env` backup, or change it properly with §6.2    |
| 1    | `SOURCE_URL` unset and the build has no source archive                                                                                                                                                                                                                 | Build with `make docker-build` / `make build`, or set `SOURCE_URL`               |
| 1    | The runtime has no `Temporal`, or the port is already in use                                                                                                                                                                                                           | Use the pinned Deno (`.tool-versions`); stop the other `make dev` or `make down` |
| 2    | A migration failed (rolled back, log `migration_failed`)                                                                                                                                                                                                               | §3.2                                                                             |
| 3    | `DATA_DIR` not writable                                                                                                                                                                                                                                                | `./data` owner (uid 65532 on Linux, `make up` fixes it as root)                  |
| 4    | The database is newer than the binary (log `db_newer_than_binary`)                                                                                                                                                                                                     | Run a newer image                                                                |

## 3. Upgrade and rollback

### 3.1 Upgrade

`make update` on the server, or `make deploy` from your machine (it runs
`make update` over ssh after you push), does steps 1–6 in order and stops at the
first failure, then removes old images (`make prune`). A server checkout without
git takes `make deploy-rsync` from your machine instead: it copies the working
tree as git sees it (tracked and new files, never what `.gitignore` names) into
`DEPLOY_DIR`, deleting files there that are gone from it but keeping `.env`,
`data/`, `backups/`, `backup.log` and `.git/`, then runs `make release`, steps
2–6 without the `git merge`. Its build is tagged with your commit, or with a
hash of the shipped files while the tree has uncommitted changes, so §3.2 works
the same. By hand, the steps are:

- **1. Read `CHANGELOG.md` for the target version**: `make update` shows the new
  lines and stops when one names a **Manual step**; after doing it,
  `make update MANUAL=done`. Stop if: A manual step exists and has not been
  done.
- **2. Pull**: `git merge --ff-only @{u}`, then `make docker-build`, or
  `docker compose pull emo` with `EMO_IMAGE` (§2.4)
- **3. Backup**: `make backup` → `DATA_DIR/backups/emo-YYYYMMDD-HHMM.sqlite` and
  `$BACKUP_ENV_DIR/env-YYYYMMDD-HHMM` (mode 600). Stop if: Backup fails or
  `BACKUP_ENV_DIR` unset (the target refuses).
- **4. Start new version**: `make up` (recreates the container)
- **5. Automatic pre-migration copy**: On startup, if migrations are pending,
  the server first runs
  `VACUUM INTO 'DATA_DIR/backups/pre-migrate-<from>-to-<to>-<ts>.sqlite'` (last
  3 kept, and none older than the oldest kept snapshot, §4.1), then applies all
  pending migrations **in one transaction**; on any error it rolls back, logs
  `migration_failed` and exits with code 2 (container restarts and fails again —
  loudly). Stop if: Container not healthy within 60 s.
- **6. Health**: `make smoke`. Stop if: healthz ≠ 200 or dry-run mail ≠ 202.
- **7. Verify version**: `make healthcheck` (or `make cli ARGS=healthcheck`)
  prints the version; or `curl -sI $BASE_URL/healthz | grep X-Emo-Server` from
  the host
- **8. Clients**: Installed PWAs pick up the new shell on next open and show
  "Update ready — Restart"; they keep working against the new server until then
  (compatibility window: reliability.md §3)

Migrations are **forward-only** and numbered `server/db/schema/NNN_name.sql`
(`001_initial.sql` …); a migration never drops or rewrites data in place without
a `CHANGELOG.md` line. Multi-version jumps are supported (all pending files
apply in order, in one transaction).

### 3.2 Rollback

```bash
make down
# only if the failed version migrated:
docker compose run --rm --no-deps emo restore /data/backups/pre-migrate-<from>-to-<to>-<ts>.sqlite
# pin the previous image: a version, or a commit's build (`docker images emo`;
# `make prune` keeps the newest three)
EMO_IMAGE_TAG=<previous-tag> make up && make smoke
```

On the command line the pin holds for that `make up` only: put
`EMO_IMAGE_TAG=<previous-tag>` in `.env` to keep it across restarts, and take it
out with the fix. `make update` builds `latest` again.

`emo restore` removes stale `-wal`/`-shm` and sets a new epoch (§4.3). Rolling
back after users have written data to the new schema: entries still on their
devices are re-uploaded through the epoch procedure; anything that exists only
on the server since the upgrade is lost. The `pre-migrate` copy is for a failed
or immediately regretted upgrade, not a long-term downgrade path. The old binary
refuses to open a database whose `MAX(schema_migrations.version)` is newer than
it knows (exit code 4, log `db_newer_than_binary`).

### 3.3 Moving to another domain

Keys, cookies and the `Origin` check belong to `BASE_URL`'s origin, so the data
moves with the server but every device signs in again at the new address.

1. Ask users to open the app once while online, so nothing is left only on a
   device under the old address.
2. Point the new host's DNS at the server and give it a certificate and a proxy
   (§2.3), checked with `curl -sI https://NEW/healthz`.
3. `make backup`, set `BASE_URL=https://NEW` in `.env`, `make release` (or
   `make up && make smoke`).
4. Redirect the old host: in its proxy, `return 301 https://NEW$request_uri;` on
   80 and 443, keeping its certificate so the redirect stays valid.
5. Tell users: open the new address, sign in with the email code and the
   passphrase, install the app again from there and delete the old one (it keeps
   its cached shell), and turn reminders on again.

## 4. Backup and restore

RPO (data that can be lost): entries written after the last snapshot **and** no
longer present on any device. Devices keep their entries locally and re-upload
them after a restore, so in practice the loss is close to zero for active users.

### 4.1 `make backup`

| Aspect     | Behaviour                                                                                                                                                                                                                                                                                                                                                                          |
| :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method     | `docker compose exec emo /emo backup --keep KEEP`: `PRAGMA wal_checkpoint(TRUNCATE)`, then `VACUUM INTO 'DATA_DIR/backups/emo-YYYYMMDD-HHMM.sqlite'` through `node:sqlite`; consistent snapshot, no downtime, WAL-safe. The image has no `sqlite3` tool and none is needed. The container must be running                                                                          |
| `.env`     | Copied by the Make target (on the host) to `$BACKUP_ENV_DIR/env-YYYYMMDD-HHMM` (UTC), mode 600, the directory mode 700. The target **refuses to run** if `BACKUP_ENV_DIR` is unset or inside `./data`                                                                                                                                                                              |
| Rotation   | `KEEP=30` (default) newest snapshots kept, in both locations. Once the rotation is full, the `pre-migrate-*` and `replaced-*` copies older than the oldest kept snapshot are deleted too. With the nightly schedule this is how long a deleted account's encrypted email survives in `data/backups/` (architecture.md §10.3); copies outside the server (§4.2) are yours to rotate |
| Output     | Path, size, `PRAGMA integrity_check` of the new file, account and entry counts, the snapshots rotated out                                                                                                                                                                                                                                                                          |
| Scheduling | `make cron`: daily at 03:00, `cd <checkout> && make backup >> <checkout>/backup.log 2>&1` in the user's crontab; `make ping` (§5.2) alerts when the newest snapshot is older than 26 h                                                                                                                                                                                             |

### 4.2 Off-host copies

The snapshot is ciphertext for all entry content; emails are encrypted with
`SERVER_SECRET`. It is safe to copy to object storage, but **never store the
`.env` copy next to the database copy** — together they reveal the email list.
Use two destinations or two keys. Recovery keys and passphrases are never on the
server, so no backup can decrypt entries.

The two simplest destinations: your VPS provider's daily server backups (the
snapshots in `data/backups/` are closed files, so an image of the disk holds
them intact), and `make backup-pull DEPLOY_HOST=…` from your own machine, which
`rsync`s `data/backups/` into `./backups` (gitignored). Keep the `.env` itself
in a password manager.

Both keep data longer than `KEEP` unless you rotate them: the provider's images
follow its own retention, and `make backup-pull` never deletes what it copied.
State that retention in your privacy notice (§2.6), or prune `./backups` on your
machine to the same 30 days.

### 4.3 `make restore FILE=…`

1. `docker compose down` (the target does it).
2. `docker compose run --rm --no-deps emo restore FILE` (FILE as seen inside the
   container, e.g. `/data/backups/emo-20261007-0300.sqlite`). The command
   refuses while a server holds the scheduler lease, then:
   1. runs `PRAGMA integrity_check` on `FILE` (must be `ok`);
   2. checks `MAX(schema_migrations.version)` of `FILE` ≤ the binary's latest
      migration;
   3. checkpoints the current `emo.sqlite` and moves it to
      `backups/replaced-YYYYMMDD-HHMM.sqlite` (deleted by `make backup` once it
      is older than the oldest kept snapshot, §4.1);
   4. copies `FILE` to `DATA_DIR/emo.sqlite`, removes stale `-wal`/`-shm`;
   5. writes a **new random epoch** to `meta.epoch`.
3. `docker compose up -d` (the target does it), then `make smoke`.

What happens to data written after the snapshot: every `/api` response carries
`X-Emo-Epoch`; each client that sees a new epoch re-queues **every** entry it
holds locally, resets its cursor and syncs (api.md §3). Uploads are idempotent,
so entries the snapshot has are confirmed and entries it lacks are re-created.
Entries that exist on no device any more are lost. Push subscriptions missing
from the snapshot are re-posted by clients on their next open. Sessions created
after the snapshot are gone: those devices sign in again (their local data
stays).

### 4.4 Quarterly restore drill — `make verify-backup FILE=…`

| Check                                                         | Pass                                                                                                                     |
| :------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------- |
| Opens read-only (`?mode=ro`)                                  | yes                                                                                                                      |
| `PRAGMA integrity_check`                                      | `ok`                                                                                                                     |
| `MAX(schema_migrations.version)`                              | ≤ current binary                                                                                                         |
| Counts                                                        | accounts, live entries, entries received in the 7 days before the snapshot, push subscriptions, unused unexpired invites |
| Decrypts one `email_enc` with the **current** `SERVER_SECRET` | succeeds (proves `.env` and DB copies belong together)                                                                   |

Run it against the newest snapshot once a quarter and record the date in the
operator's notes. It never touches the live database; any failed check exits 1.

### 4.5 What is recoverable without `.env`

| Lost              | Consequence                                                                                  | Recovery                                                                                                                                                                                                                                                                              |
| :---------------- | :------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SERVER_SECRET`   | `email_hmac` cannot be recomputed → no account can be found at login; `email_enc` unreadable | **None on this instance.** Entries remain as ciphertext but no one can sign in to fetch them. Users with an `emo-bundle` export can still read it with `emo decrypt-bundle` (§7.4); importing into a new instance is not in v1. This is why `make backup` insists on `BACKUP_ENV_DIR` |
| VAPID private key | Every existing push subscription is invalid                                                  | Generate new keys; clients detect the public-key mismatch (`GET /api/push/vapid`) on next open and re-subscribe silently (requires the notification permission that is already granted)                                                                                               |
| SMTP credentials  | No login codes                                                                               | Replace credentials; nothing in the DB depends on them                                                                                                                                                                                                                                |
| Database          | Everything since last snapshot that no device still holds                                    | `make restore` from the newest snapshot; devices re-upload (§4.3)                                                                                                                                                                                                                     |

## 5. Observability

### 5.1 Logs

Structured JSON, one object per line, to stdout; Docker handles rotation
(`compose.yml` sets `json-file` with `max-size: 20m`, `max-file: 5`, for both
services). Every response carries `X-Request-Id`; every `/api/*` request writes
one `http_request` line.

| Field             | Always                      | Notes                                                                     |
| :---------------- | :-------------------------- | :------------------------------------------------------------------------ |
| `ts`              | yes                         | ISO 8601 UTC                                                              |
| `level`           | yes                         | `debug` `info` `warn` `error`                                             |
| `msg`             | yes                         | snake_case event name, e.g. `http_request`, `push_sent`, `scheduler_tick` |
| `req_id`          | HTTP                        | 16 hex, also returned as `X-Request-Id`                                   |
| `method`, `route` | HTTP                        | `route` is the pattern (`/api/entries/:id`), not the concrete path        |
| `status`          | HTTP                        |                                                                           |
| `dur_ms`          | HTTP, scheduler, mail, push |                                                                           |
| `account_id`      | when known                  | opaque uuid; acceptable                                                   |
| `client`          | HTTP, when sent             | the app's `X-Emo-Client` version                                          |
| `err`             | errors                      | message + class; stack only at `debug`                                    |

**Never logged** (test-enforced via a log sink stub; `server/log.ts` drops
secret-named fields and redacts anything shaped like an email or a recovery
key): entry blobs, nonces, email addresses, login codes, session tokens,
`X-Emo-Auth` values, passphrases, recovery keys, mail bodies, push payloads,
invite codes in clear, `Authorization`/`Cookie` headers, IP addresses.

### 5.2 Lines to alert on

| `msg`                                                                                                               | Meaning                                             | Operator action                                                          |
| :------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------- | :----------------------------------------------------------------------- |
| `scheduler_lag_high`                                                                                                | No tick for > 180 s (also flips `/healthz` to 503)  | Check CPU / container restarts; one tick blocked on push timeouts        |
| `scheduler_tick_skipped`                                                                                            | Previous tick still running                         | Transient; alert if repeated > 3× in 10 min                              |
| `scheduler_standby`                                                                                                 | A second process found the lease taken              | Two containers on one volume — stop one                                  |
| `mail_failed`                                                                                                       | SMTP send error; mail circuit opened for 5 min      | Nobody can sign in while it repeats — check SMTP creds / provider / §2.5 |
| `push_failed_all_subscriptions`                                                                                     | Every subscription of an account failed in one tick | Likely VAPID or network problem if it occurs for many accounts           |
| `push_subscription_gone`                                                                                            | 404/410 from push service, subscription deleted     | Informational                                                            |
| `migration_failed`                                                                                                  | Startup aborted                                     | Follow §3.2                                                              |
| `db_newer_than_binary`                                                                                              | Rolled back too far                                 | Use a newer image                                                        |
| `backup_failed`                                                                                                     | From `make backup`                                  | Disk space, permissions                                                  |
| `ratelimit_hit` with `scope: ip` repeating                                                                          | Possible abuse                                      | Consider proxy-level blocking                                            |
| `admin_login_code` / `admin_account_delete` / `admin_keyring_revert` / `admin_entry_delete` / `admin_rotate_secret` | An admin command was used                           | Expected only when you ran it                                            |

Minimal alerting for a single operator: a free
[healthchecks.io](https://healthchecks.io) check (or the self-hosted one) with a
5-minute period, its ping URL as `PING_URL` in `.env`, then `make cron`. Every 5
minutes `make ping` pings it while `BASE_URL/healthz` answers 200 from the host
(app, database, scheduler, proxy and certificate) and the newest snapshot is
under 26 h old, and sends `PING_URL/fail` with the reason otherwise; when the
host itself is down the pings stop. Either way the check mails you. Without
`PING_URL`, `make cron` warns that nothing tells you when the server is down.
For the lines above, a log shipper watching `level: error`, or a look at
`make logs` when the check fires.

### 5.3 `/healthz`

```json
{
  "ok": true,
  "db": "ok",
  "scheduler_last_tick_at": "2026-10-07T10:00:00.000Z",
  "scheduler_lag_sec": 12,
  "mail": "ok",
  "version": "1.2.0",
  "epoch": "q2Vh…"
}
```

`200` when the DB opens and the scheduler ticked within 180 s; otherwise `503`
with `ok: false` and an `error` envelope (api.md §2.10 is the source of the
shape). `mail` is `ok`, `circuit_open` or `unconfigured`; `scheduler_lag_sec` is
absent before the first tick. Also sets `X-Emo-Server` and `X-Emo-Epoch`.
Unauthenticated, no account data, safe to expose to the proxy's health check.
The compose healthcheck runs `/emo healthcheck` every 30 s (timeout 5 s, 3
retries, 5 s start period).

### 5.4 `make stats`

No `/metrics` endpoint in v1 (one less unauthenticated surface). `emo stats`
reads the DB directly and prints:

| Line                                                                 | Source                                                                 |
| :------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| accounts total / created last 30 d                                   | `accounts`                                                             |
| entries received per day, last 7 d (UTC)                             | `entries.received_at` (count only)                                     |
| tombstones / all entry rows                                          | `entries.deleted`                                                      |
| reminders planned / sent / failed / cancelled / paused, last 24 h    | `reminders`                                                            |
| cancelled: no device / server down / settings / tz change, last 24 h | `reminders.reason` (migration 005)                                     |
| push failures / subscriptions removed, last 24 h                     | log-free counter table `ops_counters`                                  |
| scheduler lag p95, last 24 h                                         | `ops_counters` (the scheduler writes `tick_lag_ms` samples, kept 48 h) |
| mail failures / circuit openings, last 24 h                          | `ops_counters`                                                         |
| db size / wal size / free pages                                      | `PRAGMA`                                                               |

`ops_counters(ts, name, value)` is the only operational table; it holds no
identifiers. Problems on users' devices are invisible to the server by design;
users can send the "Copy diagnostics" text from Settings → Data (reliability.md
§1.8).

## 6. Secrets and configuration

### 6.1 Handling

| Rule                                      | Detail                                                        |
| :---------------------------------------- | :------------------------------------------------------------ |
| `.env` mode 600, owned by the deploy user | `make init` sets it; `make up` refuses anything else          |
| Never in git                              | `.gitignore` has `.env`; `.env.example` has placeholders only |
| Never in logs or `/healthz`               | enforced by the log tests                                     |
| Image contains no secrets                 | all via environment at runtime                                |

### 6.2 Rotation

- `SERVER_SECRET`: `make backup` (while running) → `make down` →
  `make rotate-secret OLD=<hex> NEW=<hex>`: refuses unless both are 64 hex and
  differ, OLD is the secret the database uses, and no server holds the lease;
  then in one transaction, for every account decrypt `email_enc` with OLD,
  re-encrypt with NEW, recompute `email_hmac = HMAC(NEW, normalised email)`,
  re-encrypt unused `invites.code_enc`, rewrite `meta.secret_check`. Sessions,
  login codes and invite hashes use SHA-256, not the secret. Then set
  `SERVER_SECRET=NEW` in `.env` → `make up` → `make smoke`. Effect on users:
  None; downtime of seconds.
- **VAPID keys**: `make init VAPID=regen` (writes a new pair into `.env`), then
  `make up`. The server returns the new public key from `GET /api/push/vapid`;
  clients compare it with their subscription's `applicationServerKey` on each
  open and re-subscribe. Effect on users: Reminders resume on each device after
  its next open.
- **SMTP password**: Edit `.env`, `make up`. Effect on users: None.
- **Invite codes**: Not secrets after use; unused codes can be revoked with
  `make invite REVOKE=<code>`

### 6.3 Locale defaults

`DEFAULT_LOCALE` only affects emails sent when neither the account nor the
`request-code` call supplies a locale. Everything else follows the user's
choice.

## 7. Administration

All admin commands log a line (`admin_*`, §5.2) with the account id, never the
email.

### 7.1 Accounts and entries

| Command                                                            | Behaviour                                                                                                                                                                                                                      |
| :----------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make accounts [EMAILS=1]` (`emo accounts [--emails]`)             | Table: account id, created, last seen (max session `last_seen_at`), entries count, subscriptions count, keyring revisions. Emails only with `--emails` (decrypted with `SERVER_SECRET`, printed to the terminal, never logged) |
| `make account-delete ID=…` (`emo account-delete <id>`)             | Same deletion as `DELETE /api/account` (api.md §2.5) without the user's proof — for erasure requests and abandoned accounts. Asks to type the id again to confirm. Other devices of that account get `account_gone`            |
| `make entry-delete ID=… ENTRY=…` (`emo entry-delete <id> <entry>`) | Turns one entry of that account into a tombstone (new `seq`); devices drop it on their next sync                                                                                                                               |

### 7.2 Login code escape hatch

`make login-code EMAIL=…` (`emo login-code <email>`) creates a fresh code for an
existing account (invalidating older ones) and prints it **to the operator's
terminal** instead of mailing it, with its expiry. Use only during a mail
outage, after confirming the person's identity through another channel. It
grants a session, not data: the person still needs the passphrase or recovery
key.

### 7.3 Keyring revisions

Keyring rows are append-only (architecture.md §5.2). If a user reports "my
passphrase stopped working" after a change on another device, or a revision is
suspected to be malicious: `make accounts` shows the revision count;
`make keyring-revert ID=<account_id> REV=<rev>` re-inserts the content of
revision `<rev>` as a new, latest revision (nothing is deleted). The user then
unlocks with the passphrase that belonged to `<rev>`.

### 7.4 Reading an export without a server

`make decrypt-bundle FILE=emo-bundle-2026-10-07.json OUT=./out` runs
`emo decrypt-bundle` on the operator's or user's machine: asks for the
passphrase (or, with `RECOVERY=1` / `--recovery`, the recovery key), writes
`entries.jsonl`, `entries.csv`, `reminders.jsonl`, `dictionaries.json`. No
network, no database (architecture.md §10.1). Entries are checked as in the app:
one that fails validation is written to `entries.jsonl` only, marked `_invalid`;
one written by a newer Emo is left out (update the binary); the command prints
how many of each, and how many could not be decrypted.
