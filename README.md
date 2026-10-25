<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo

Emo is a journal for 60-second check-ins on what your body feels: where, what it
is like, how strong, and a word for it if there is one. It reminds you at three
random moments a day. Your entries are end-to-end encrypted: the server stores
them but cannot read them. It runs in the browser and installs to the home
screen like an app (a PWA), in English, Ukrainian and Russian.

**Use it at [emo.podgorniy.net](https://emo.podgorniy.net)**: anyone can sign up
with an email address, no invite. Or
[run your own instance](#running-your-own-instance).

**Supported browsers:** iOS/Safari ≥ 16.4, Chrome/Edge ≥ 111, Firefox ≥ 115.
There are no polyfills below these. Push reminders on iOS need the app installed
to the home screen.

**Why it asks what it asks:** the
[methodology](https://emo.podgorniy.net/methodology) gives the research behind
each question, how firm each source is, what was left out on purpose, and how to
read your export.

**Not a medical device.** Emo does not diagnose, treat or monitor any condition,
and it does not replace a therapist. If you are in crisis or thinking about
harming yourself, contact local emergency services or
[a helpline](https://findahelpline.com).

## Privacy

The full notice is at
[emo.podgorniy.net/privacy.html](https://emo.podgorniy.net/privacy.html). In
short:

- **Your entries are end-to-end encrypted.** They are encrypted on your device
  with a key that only your passphrase or recovery key unlocks. The server
  stores them but cannot read them, and neither can its operator. Every entry is
  padded to the same size, so its length tells nothing.
- **Lose both the passphrase and the recovery key and your entries are gone.**
  Nobody can recover them, the operator included.
- **The server can read:** your email address; your reminder settings (time
  zone, language, waking hours, reminders a day, the shortest gap between them,
  a pause); when entries arrive and how many, not what is in them; each
  signed-in browser's description and last use, and each device's push-service
  address; when reminders were planned and sent; invite codes and who joined
  with whose; when it mailed you.
- **Others involved:** the operator's email provider sees your address and the
  sign-in mail. Your browser's push service (Apple, Google or Mozilla) sees that
  a reminder was sent and when; its content is encrypted for your device.
- **Not collected:** no ads, analytics, tracking, third-party scripts or fonts.
  IP addresses are used only in memory against abuse and never written down;
  logs never hold your email, IP or anything you record. The one cookie keeps
  you signed in.
- **Emailing yourself the recovery key is optional and weakens it:** sign-in is
  by email, so anyone who can read your mailbox could then open your entries.
  Save it as a file or write it down instead.
- **Export or delete any time** in Settings → Data and keys. Deletion is
  immediate; encrypted database backups rotate out in about 30 days.
- **Check what runs:** Emo is free software (AGPL). Settings → About → Source
  code downloads the exact version the server is running; this repository is the
  project's home.

emo.podgorniy.net is run by the author on a single server, free and best effort:
export now and then.

## Running your own instance

You need a Linux server (1 GB RAM, or swap: it builds the image), a domain or
subdomain whose DNS `A` record points to it, ports 80 and 443 open, and an SMTP
account: sign-in works by emailed codes. On a fresh Debian or Ubuntu, as root:

```bash
# Once: the tools, Docker and the code
apt-get install -y curl make git cron rsync openssl
curl -fsSL https://get.docker.com | sh   # Docker already from Ubuntu (docker.io)? apt-get install -y docker-compose-v2
git clone https://github.com/podgorniy/emo.git /srv/emo && cd /srv/emo

# Configure: secrets, the HTTPS address and your email (builds the image)
make init DOMAIN=emo.example.org EMAIL=you@example.org
nano .env                # SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM

# Start: the app, and Caddy with a Let's Encrypt certificate
make up
make smoke SEND=1        # sends a sample sign-in mail to EMAIL, shows what SMTP answered
# Open https://emo.example.org and register: anyone may (REGISTRATION=open);
# REGISTRATION=invite in .env closes it, then `make invite` prints a code

# Nightly backups and a health ping every 5 minutes; set PING_URL in .env
# first (a free healthchecks.io check) to be mailed when the server is down
make cron
```

If the sample mail lands in spam or never arrives, set up SPF, DKIM and DMARC
for the sending domain ([`llm/ops.md`](llm/ops.md) §2.5): nobody can sign in
without working mail.

| Day to day                    | On the server                    | From your own machine (after `git push`)             |
| :---------------------------- | :------------------------------- | :--------------------------------------------------- |
| Update                        | `make update`                    | `make deploy DEPLOY_HOST=root@emo.example.org`       |
| Update a checkout without git |                                  | `make deploy-rsync DEPLOY_HOST=root@emo.example.org` |
| Roll back                     | `EMO_IMAGE_TAG=<commit> make up` |                                                      |
| Back up now / off the box     | `make backup`                    | `make backup-pull DEPLOY_HOST=root@emo.example.org`  |
| Watch                         | `make logs`, `make stats`        |                                                      |

`make update` pulls, builds, backs up, restarts and smoke-tests; it stops when
the new `CHANGELOG.md` lines name a **Manual step**. Everything runs through
`make`; `make` alone lists the everyday targets. After changing the code on the
server, `make docker-build` and `make up` again.

When another web server already holds ports 80 and 443 on that host, run
`make init` without `DOMAIN`, set `BASE_URL` yourself and point your proxy at
`127.0.0.1:PORT` (8080 unless `.env` sets another) ([`llm/ops.md`](llm/ops.md)
§2.3).

Backups, restore, updates, monitoring and every operator command are in
[`llm/ops.md`](llm/ops.md). Read [`CHANGELOG.md`](CHANGELOG.md) before every
update: manual steps are marked there.

**You are the operator of your instance.** Before others sign up, set
`OPERATOR_CONTACT`, review `client/public/privacy.html` (add who you are and
your jurisdiction) and set `PRIVACY_NOTICE_URL` ([`llm/ops.md`](llm/ops.md)
§2.6).

## Development

Requires Deno 2.9.6 (`.tool-versions`). To try it locally:

```bash
make init        # once: a .env with fresh secrets (no SMTP needed for dev)
make dev         # the server on :8081 and Vite with hot reload on :5173
```

Open http://localhost:5173 and sign in with any address: the code is printed in
the `make dev` terminal, not mailed.

```bash
make ci          # format check, lint, tests, build with the size budgets
make e2e         # Playwright on the built binary: CSP, accessibility, flows, thumb reach
make perf        # Lighthouse, sizes and benches into perf/report/
make capture     # a screenshot of every screen state, into e2e/report/capture/
```

`make dev` prints sign-in codes and other mail to its terminal, even with
`SMTP_HOST` set; `DEV_MAIL=smtp` in `.env` sends them for real. It runs next to
`make up` on its own port and database (`DEV_PORT=8090` picks another), so a
browser never mixes the two; operator targets take `DEV=1` to act on it:
`make invite DEV=1`.

The documentation is in [`llm/`](llm/README.md): one file per concern
(methodology, data, architecture, API, UI, operations, development), written to
be read by people and by coding agents alike; its README maps them. Start with
[`llm/development.md`](llm/development.md) for tests, CI, releases and
conventions. Open work is in [`llm/todo.md`](llm/todo.md). `design/` holds the
reference mockups and prototype sources, not production code.

## Forking

The code names no particular server; the hosted instance appears only in this
README. To run a fork under your own name:

- rewrite this README's introduction and links;
- review `client/public/privacy.html` (who runs it, jurisdiction, retention,
  mail provider) and the project link in it and in
  `client/public/methodology.html`;
- set `OPERATOR_CONTACT`, `CRISIS_URL` (a local service) and, if you serve the
  source from elsewhere, `SOURCE_URL` in `.env`;
- the display name lives in `shared/i18n/ui.*.ts`,
  `client/public/manifest.webmanifest` and the page titles; the internal `emo`
  identifiers (database, storage keys, encryption contexts) must never change
  ([`llm/README.md`](llm/README.md) §3).

Under the AGPL, a modified server must offer its users its own source; the
built-in `/source.tar.gz` does that for whatever you build.

## Contributing and reporting

Bugs and ideas: [GitHub issues](https://github.com/podgorniy/emo/issues). In the
app, Settings → Data and keys → Copy diagnostics gives a report without any of
your content. Security problems: privately, as described in
[`SECURITY.md`](SECURITY.md), not in a public issue.

## License

Copyright (C) 2026 podgorniy. [AGPL-3.0-or-later](LICENSE), including `design/`.
Fonts in `client/public/fonts` are under the SIL Open Font License 1.1 (see the
`OFL.txt` in each folder). The word list behind "Suggest a passphrase"
(`client/src/lib/passphraseWords.ts`) is the EFF Large Wordlist by the
Electronic Frontier Foundation, under CC BY 3.0 US, with some words removed.
