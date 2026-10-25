# SPDX-License-Identifier: AGPL-3.0-or-later
# The single entry point (ops.md §1). Every target is a thin wrapper over
# `deno task`, `docker compose` or an `emo` subcommand.

.PHONY: all help init vapid-keys dev dev-tunnel build test lint fmt fmt-check ci \
	docker-build up down logs cli update release deploy deploy-rsync prune migrate invite backup \
	backup-pull restore verify-backup smoke ping cron stats rotate-secret \
	accounts account-delete login-code keyring-revert entry-delete \
	decrypt-bundle seed healthcheck e2e perf e2e-browser release-binaries \
	release-check capture

DENO_RUN := deno run -A --env-file=.env
DEV_DATA := ./data-dev
# `make dev` (and DEV=1 targets) get their own port, address and database,
# set inline over .env: never the origin of `make up`, so a browser never
# mixes the two instances' local data. DEV_PORT=8090 picks another port;
# a tunnel to it sets DEV_BASE_URL (development.md §3.2)
DEV_PORT ?= 8081
DEV_BASE_URL ?= http://localhost:$(DEV_PORT)
DEV_ENV := DATA_DIR=$(DEV_DATA) PORT=$(DEV_PORT) BASE_URL=$(DEV_BASE_URL)
# Keep in step with "playwright-core" in deno.json: the browser it installs
# must match the library's build. E2E_BROWSER_FLAGS=--with-deps adds
# the system libraries on a fresh Linux (CI)
PLAYWRIGHT := npm:playwright-core@1.58.2
E2E_BROWSER_FLAGS ?=

# Operator targets run `emo` in the production container: `EMO` inside the
# running one, `EMO_STOPPED` in a one-off container for commands that need
# the server stopped. DEV=1 runs both on the `make dev` database instead.
# BASE: the address those targets talk about.
ifeq ($(DEV),1)
EMO := $(DEV_ENV) $(DENO_RUN) server/main.ts
EMO_TTY := $(EMO)
EMO_STOPPED := $(EMO)
BASE = $(DEV_BASE_URL)
else
# `docker compose exec` on a stopped container only says "not running", which
# after `make dev` reads as if that one were down: name both ways out
EMO_UP = { docker compose ps --status running --services 2>/dev/null | grep -qx emo || { \
	echo "emo is not running in Docker (make up starts it). For the make dev server: make $@ DEV=1"; \
	exit 1; }; } &&
EMO = $(EMO_UP) docker compose exec -T emo /emo
EMO_TTY = $(EMO_UP) docker compose exec emo /emo
EMO_STOPPED := docker compose run --rm --no-deps emo
BASE = $(call env,BASE_URL)
endif

# Reads one value from .env (the Makefile never sources the whole file); the
# last line wins, as for docker compose
env = $(shell sed -n 's/^$(1)=//p' .env 2>/dev/null | tail -n 1)

KEEP ?= 30

# The image compose runs: EMO_IMAGE (a registry image) or the local build
IMAGE = $(or $(call env,EMO_IMAGE),emo)
# The container's user, distroless `nonroot`: on Linux it must own ./data
# (Docker Desktop maps ownership, so nothing to do on macOS)
EMO_UID := 65532

# From your own machine: the server `make deploy` and `make backup-pull` reach
# over ssh, and its checkout (either may also be set in .env)
DEPLOY_HOST ?= $(call env,DEPLOY_HOST)
DEPLOY_DIR ?= $(or $(call env,DEPLOY_DIR),/srv/emo)

# `make` alone lists the everyday targets; ops.md §1 has every one
.DEFAULT_GOAL := help

all: test

help:
	@echo "Run an instance (Docker, configured by .env):"
	@echo "  make init             create .env with generated secrets (once; DOMAIN=host EMAIL=you@... for a server)"
	@echo "  make up               start it (and HTTPS with COMPOSE_PROFILES=https), then open $(or $(call env,BASE_URL),BASE_URL)"
	@echo "  make invite           a new invite code (USES=N, EXPIRES=30d, REVOKE=<code>)"
	@echo "  make cron             nightly backup, and a health ping to PING_URL every 5 minutes"
	@echo "  make update           pull the code, build, back up, restart, smoke test"
	@echo "  make logs / down      follow its log (SERVICE=caddy for the proxy) / stop it"
	@echo "  make smoke / stats    health and a dry-run mail / counters"
	@echo "  make backup           a snapshot and a copy of .env"
	@echo "  make cli ARGS=\"...\"   any other emo subcommand, run inside the container"
	@echo ""
	@echo "From your own machine (DEPLOY_HOST=user@server):"
	@echo "  make deploy           make update on the server over ssh (push your commits first)"
	@echo "  make deploy-rsync     copy this working tree to the server, then make release there (no git on the server)"
	@echo "  make backup-pull      copy the server's snapshots into ./backups"
	@echo ""
	@echo "Develop (host Deno, ./data-dev, mail printed to the terminal):"
	@echo "  make dev              the server at $(DEV_BASE_URL) and Vite on :5173 (DEV_PORT=N for another)"
	@echo "  make invite DEV=1     an invite for the make dev database (DEV=1 also for stats, accounts, ...)"
	@echo "  make ci / e2e         checks and the build / browser tests"
	@echo ""
	@echo "make build makes bin/emo for tests and releases; make up does not use it."
	@echo "Never run bin/emo on ./data while make up is running: from outside the"
	@echo "container it cannot see the server's locks and breaks the database's WAL."

# Creates .env with a random SERVER_SECRET, a VAPID pair and BACKUP_ENV_DIR
# (~/emo-env-backups). For a server, DOMAIN=emo.example.org also sets
# BASE_URL=https://DOMAIN and the built-in HTTPS (COMPOSE_PROFILES=https), and
# EMAIL=you@example.org the VAPID subject, SMOKE_EMAIL and OPERATOR_CONTACT.
# VAPID=regen replaces the VAPID pair of an existing .env (ops.md §6.2).
# Without Deno on the host the keys come from the image, built first if missing
VAPID_KEYS = $(if $(shell command -v deno),deno run -A server/main.ts,docker run --rm $(IMAGE):latest) vapid-keys

init:
	@if [ -f .env ] && [ "$(VAPID)" != "regen" ]; then \
		echo ".env already exists (VAPID=regen replaces its VAPID keys)."; exit 0; fi; \
	case "$(DOMAIN)" in *[/:]*) echo "DOMAIN is a host name: DOMAIN=emo.example.org"; exit 1;; esac; \
	if ! command -v deno >/dev/null 2>&1 && ! docker image inspect $(IMAGE):latest >/dev/null 2>&1; then \
		echo "[emo] No Deno here: building the image to generate the keys with it"; \
		$(MAKE) --no-print-directory docker-build || exit 1; fi; \
	KEYS=$$($(VAPID_KEYS)) || exit 1; \
	PUB=$$(echo "$$KEYS" | sed -n 's/^VAPID_PUBLIC_KEY=//p'); \
	PRIV=$$(echo "$$KEYS" | sed -n 's/^VAPID_PRIVATE_KEY=//p'); \
	put() { sed -i.bak "s|^\(# \)\{0,1\}$$1=.*|$$1=$$2|" .env; }; \
	if [ -f .env ]; then \
		put VAPID_PUBLIC_KEY "$$PUB"; put VAPID_PRIVATE_KEY "$$PRIV"; \
		rm -f .env.bak; chmod 600 .env; \
		echo "New VAPID keys written to .env. Restart (make up); devices re-subscribe on their next open."; \
		exit 0; fi; \
	cp .env.example .env && chmod 600 .env; \
	put SERVER_SECRET "$$(openssl rand -hex 32)"; \
	put VAPID_PUBLIC_KEY "$$PUB"; put VAPID_PRIVATE_KEY "$$PRIV"; \
	put BACKUP_ENV_DIR "$$HOME/emo-env-backups"; \
	if [ -n "$(DOMAIN)" ]; then put BASE_URL "https://$(DOMAIN)"; put COMPOSE_PROFILES https; fi; \
	if [ -n "$(EMAIL)" ]; then \
		put VAPID_SUBJECT "mailto:$(EMAIL)"; put SMOKE_EMAIL "$(EMAIL)"; put OPERATOR_CONTACT "$(EMAIL)"; fi; \
	rm -f .env.bak; chmod 600 .env; \
	TODO="SMTP_*"; \
	[ -n "$(DOMAIN)" ] || TODO="BASE_URL, $$TODO"; \
	[ -n "$(EMAIL)" ] || TODO="$$TODO, VAPID_SUBJECT, SMOKE_EMAIL, OPERATOR_CONTACT"; \
	echo "Created .env (mode 600) with a random SERVER_SECRET and VAPID keys."; \
	echo "Fill in $$TODO, then: make up"

# A new pair to paste into an existing .env (`make init` fills a new one)
vapid-keys:
	@$(VAPID_KEYS)

# Deno server with --watch on DEV_PORT (serves client/dist) and Vite with HMR
# on :5173, proxying to it; open http://localhost:5173 while editing the
# client. Runs next to `make up`
dev:
	@echo "make dev: $(DEV_BASE_URL) (built client) and http://localhost:5173 (hot reload)"
	@trap 'kill 0' INT TERM; \
	$(DEV_ENV) DEV_MODE=true $(DENO_RUN) --watch server/main.ts serve & \
	EMO_DEV_PORT=$(DEV_PORT) EMO_DEV_BASE_URL=$(DEV_BASE_URL) deno task dev:client & \
	wait

# development.md §3.2: phones need HTTPS for the service worker, push and cookies
dev-tunnel:
	@echo "make dev listens on http://localhost:$(DEV_PORT) (and Vite on :5173). For a phone, either:"
	@echo "  - Caddy:  caddy reverse-proxy --from <name>.local --to localhost:$(DEV_PORT)  (tls internal;"
	@echo "            install Caddy's root CA on the phone), or"
	@echo "  - a tunnel to a stable hostname: cloudflared tunnel --url http://localhost:$(DEV_PORT)"
	@echo "            or tailscale funnel $(DEV_PORT)"
	@echo "Pass that https:// address as DEV_BASE_URL=... (make dev-tunnel DEV_BASE_URL=https://...);"
	@echo "iOS push needs the PWA installed from it."
	@$(MAKE) --no-print-directory dev

# Vite build, the size-budget check (perf/budgets.json), then deno compile.
# The compile embeds only the npm packages the server imports
# (--node-modules-dir=none --exclude-unused-npm): ./node_modules also holds
# Vite, Lighthouse and Playwright, which made the binary four times larger
build:
	@deno task build

# The app tests serve the built client (server/app_test.ts): a fresh clone
# builds it once first
test: client/dist/index.html
	@LOG_LEVEL=warn deno test -A

client/dist/index.html:
	@deno task build

# deno lint and type checks (server, shared, client, Svelte), SPDX headers and
# inline styles (tools/check_repo.ts), forbidden words and i18n completeness
lint:
	@deno lint
	@deno check server/main.ts shared/ perf/ tools/ e2e/ $$(find client/src/lib -name '*.ts' ! -name '*.svelte.ts')
	@deno task check:client
	@deno run -A tools/check_repo.ts
	@LOG_LEVEL=warn deno test -A --quiet shared/i18n/

fmt:
	@deno fmt

fmt-check:
	@deno fmt --check

ci: fmt-check lint build test

# Playwright against the compiled binary (development.md §5.3): zero CSP
# violations on every screen, and the crypto vectors in Chromium (development.md §5.1).
# Each run starts `bin/emo` on a free port with a temporary DATA_DIR. The
# reach audit (e2e/audit.e2e.ts, ui.md §4.10) runs its CI matrix
# here; REACH_FULL=1 every language at every size, REACH_STRICT=1 also fails
# on PENDING entries that pass (e2e/reach_pending.ts)
e2e: build e2e-browser
	@LOG_LEVEL=warn deno test -A e2e/*.e2e.ts

# Screenshots and every control's box for each state the reach audit walks,
# into e2e/report/capture/ (tools/capture_reach.ts; ARGS="--matrix full")
capture: build e2e-browser
	@LOG_LEVEL=warn deno run -A tools/capture_reach.ts $(ARGS)

# Lighthouse (mobile, throttled) on the sign-in screen, Home, step 1 and
# Settings of the built binary, the bundle sizes and the benches, into
# perf/report/ (performance.md §5–§6)
perf: build e2e-browser
	@deno run -A perf/run.ts

# Chromium's headless shell for playwright-core; a no-op once installed.
# Through Node when it is there: under Deno the installer stalls unpacking the
# download on Linux and never exits (the first CI runs hung)
e2e-browser:
	@if command -v npx >/dev/null 2>&1; then \
		npx -y $(patsubst npm:%,%,$(PLAYWRIGHT)) install $(E2E_BROWSER_FLAGS) --only-shell chromium; \
	else \
		deno run -A $(PLAYWRIGHT) install $(E2E_BROWSER_FLAGS) --only-shell chromium; \
	fi

# Tags latest, VERSION and the commit (short SHA, "-dirty" with local
# changes): the commit tag is what a rollback names (ops.md §3.2). REV=<7 hex>
# names the build instead, for a checkout without git (make deploy-rsync)
docker-build:
	@SHA="$(REV)"; \
	if [ -z "$$SHA" ]; then SHA=$$(git rev-parse --short=7 HEAD 2>/dev/null); \
		if [ -n "$$SHA" ] && [ -n "$$(git status --porcelain 2>/dev/null)" ]; then SHA="$$SHA-dirty"; fi; fi; \
	docker build -t $(IMAGE):latest -t $(IMAGE):$$(cat VERSION) $${SHA:+-t $(IMAGE):$$SHA} . && \
	echo "[emo] Built $(IMAGE):latest, $(IMAGE):$$(cat VERSION)$${SHA:+ and $(IMAGE):$$SHA}"

# Release gates (shared/release_test.ts): fails while any dictionary label or
# glossary description, in any language, is still a draft awaiting review
# (architecture.md §11.4)
release-check:
	@EMO_RELEASE=1 LOG_LEVEL=warn deno test -A shared/release_test.ts

# Release assets (development.md §6): the binary for linux-x86_64 and linux-arm64,
# compiled with the flags of `build:server` in deno.json
release-binaries: build
	@for target in x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu; do \
		deno compile -A --node-modules-dir=none --exclude-unused-npm \
			--include client/dist --include server/db/schema \
			--target $$target --output bin/emo-$$target server/main.ts || exit 1; \
	done

# GNU stat first: on Linux `stat -f` means "file system" and prints its stats
up:
	@# Without the plugin, `docker compose up -d` fails on "unknown shorthand flag"
	@docker compose version >/dev/null 2>&1 || { \
		echo "Refusing: the docker compose plugin is missing. With Ubuntu's docker.io: apt-get install -y docker-compose-v2 (Docker's own packages, get.docker.com, include it)"; exit 1; }
	@if [ "$$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env)" != "600" ]; then \
		echo "Refusing: .env must be mode 600 (chmod 600 .env)"; exit 1; fi
	@# Only BASE_URL's origin may sign in (api.md §1); the proxy
	@# would serve a path in it as the only path
	@case "$(BASE)" in *://*/*) \
		echo "Refusing: BASE_URL is an origin, without a path or trailing slash ($(BASE))"; exit 1;; esac
	@if [ "$$(uname -s)" = Linux ]; then \
		mkdir -p data; \
		if [ "$$(stat -c '%u' data)" != $(EMO_UID) ]; then \
			if [ "$$(id -u)" = 0 ]; then chown -R $(EMO_UID):$(EMO_UID) data; \
			else echo "Refusing: ./data must belong to uid $(EMO_UID), the container's user: sudo chown -R $(EMO_UID):$(EMO_UID) data"; exit 1; fi; \
		fi; \
	fi
	@# --wait: a container that refuses to start (e.g. a missing .env value) is
	@# reported and stopped, not left restarting in a loop on port 8080
	@docker compose up -d --wait --wait-timeout 60 || { \
		echo "The containers did not become healthy. Their last lines:"; \
		docker compose logs --tail 15; \
		docker compose stop >/dev/null 2>&1; \
		exit 1; }
	@# The built-in proxy fetches its certificate on the first start
	@if docker compose ps --status running --services | grep -qx caddy; then \
		i=0; until curl -fsS -m 5 -o /dev/null "$(BASE)/healthz" 2>/dev/null; do \
			i=$$((i + 1)); if [ $$i -ge 30 ]; then \
				echo "Running, but $(BASE) does not answer over HTTPS. Its host must resolve to this server and ports 80 and 443 be open; make logs SERVICE=caddy shows the certificate attempts."; \
				exit 1; fi; \
			sleep 2; done; fi
	@echo "emo is up: open $(BASE)"

down:
	docker compose down

logs:
	docker compose logs -f $(or $(SERVICE),emo)

cli:
	docker compose exec emo /emo $(ARGS)

# On the server (ops.md §3.1): stops at a **Manual step** in the new
# CHANGELOG lines until MANUAL=done, then the new code and `make release`
update:
	@git fetch --quiet
	@if git diff HEAD..@{u} -- CHANGELOG.md | grep -q '^+.*\*\*Manual step\*\*' && [ "$(MANUAL)" != done ]; then \
		git diff HEAD..@{u} -- CHANGELOG.md | grep '^+[^+]'; \
		echo "This update has a manual step (above). Do it, then: make update MANUAL=done"; exit 1; fi
	@git merge --ff-only --quiet @{u}
	@$(MAKE) --no-print-directory release

# On the server, with the new code in place: the image (built, or pulled with
# EMO_IMAGE), a backup of the running version, the restart, the smoke test,
# and old images go. REV= names the build (docker-build)
release:
	@$(if $(call env,EMO_IMAGE),docker compose pull emo,$(MAKE) --no-print-directory docker-build $(if $(REV),REV=$(REV)))
	@$(MAKE) --no-print-directory backup
	@$(MAKE) --no-print-directory up
	@$(MAKE) --no-print-directory smoke
	@$(MAKE) --no-print-directory prune

# From your own machine: `make update` on the server over ssh. It deploys what
# the server pulls, so push first
deploy:
	@if [ -z "$(DEPLOY_HOST)" ]; then echo "Usage: make deploy DEPLOY_HOST=user@server [DEPLOY_DIR=/srv/emo]"; exit 1; fi
	@AHEAD=$$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0); \
	if [ "$$AHEAD" != 0 ]; then echo "[emo] Note: $$AHEAD local commit(s) not pushed; the server deploys what it pulls"; fi
	ssh -t $(DEPLOY_HOST) 'cd $(DEPLOY_DIR) && make update $(if $(MANUAL),MANUAL=$(MANUAL))'

# From your own machine, for a server checkout without git (ops.md §3.1):
# ships this working tree as git sees it (tracked and new files, never what
# .gitignore names), mirrors it into DEPLOY_DIR (--delete) while keeping the
# server's own files below, then `make release` there. The build is tagged
# with the commit, or with a hash of the shipped files when the tree has
# uncommitted changes. Stops at a new **Manual step** like `make update`
DEPLOY_KEEP := --exclude=/.env --exclude=/data/ --exclude=/backups/ --exclude=/backup.log --exclude=/.git/
DEPLOY_FILES = git ls-files -z -co --exclude-standard | perl -0 -ne 'chomp; print "$$_\0" if -f'

deploy-rsync:
	@if [ -z "$(DEPLOY_HOST)" ]; then echo "Usage: make deploy-rsync DEPLOY_HOST=user@server [DEPLOY_DIR=/srv/emo]"; exit 1; fi
	@NEW=$$(ssh $(DEPLOY_HOST) 'cat $(DEPLOY_DIR)/CHANGELOG.md 2>/dev/null' | diff - CHANGELOG.md | grep '^>.*\*\*Manual step\*\*'); \
	if [ -n "$$NEW" ] && [ "$(MANUAL)" != done ]; then echo "$$NEW"; \
		echo "This update has a manual step (above). Do it, then: make deploy-rsync MANUAL=done"; exit 1; fi
	@REV=$$(git rev-parse --short=7 HEAD 2>/dev/null); \
	if [ -z "$$REV" ] || [ -n "$$(git status --porcelain 2>/dev/null)" ]; then \
		REV=$$($(DEPLOY_FILES) | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-7); fi; \
	echo "[emo] Shipping build $$REV to $(DEPLOY_HOST):$(DEPLOY_DIR)"; \
	$(DEPLOY_FILES) | COPYFILE_DISABLE=1 tar --null --no-xattrs -T - -czf - | \
		ssh $(DEPLOY_HOST) 'set -e; S=$$(mktemp -d); chmod 755 $$S; trap "rm -rf $$S" EXIT; \
			tar -xzf - -C $$S --no-same-owner --warning=no-unknown-keyword; \
			rsync -a --delete $(DEPLOY_KEEP) $$S/ $(DEPLOY_DIR)/' && \
	ssh -t $(DEPLOY_HOST) "cd $(DEPLOY_DIR) && make release REV=$$REV"

# Removes all but the newest three commit-tagged builds (rollback targets),
# dangling images and build cache unused for a week
prune:
	@docker images $(IMAGE) --format '{{.Tag}}' | grep -E '^[0-9a-f]{7}(-dirty)?$$' | tail -n +4 | \
		while read -r tag; do docker rmi "$(IMAGE):$$tag" >/dev/null 2>&1 || true; done
	@docker image prune -f >/dev/null
	@docker builder prune -f --filter until=168h >/dev/null 2>&1 || true

# DRY=1 prints the plan without changing anything
migrate:
	@$(EMO_STOPPED) migrate $(if $(filter 1,$(DRY)),--dry-run)

# USES=N (multi-use admin code), EXPIRES=30d; or REVOKE=<code>
invite:
	@$(EMO) invite $(if $(REVOKE),--revoke $(REVOKE)) $(if $(USES),--uses $(USES)) $(if $(EXPIRES),--expires $(EXPIRES))
	@$(if $(REVOKE),:,echo "[emo] Register with it at $(BASE)")

# ops.md §4.1: snapshot inside the container plus a copy of .env (mode 600)
# outside DATA_DIR; KEEP newest of each
backup:
	@DIR="$(call env,BACKUP_ENV_DIR)"; \
	if [ -z "$$DIR" ]; then echo "Refusing: set BACKUP_ENV_DIR in .env (where the .env copies go, not next to the database)"; exit 1; fi; \
	case "$$(cd "$$DIR" 2>/dev/null && pwd)/" in "$$(cd ./data 2>/dev/null && pwd)/"*) \
		echo "Refusing: BACKUP_ENV_DIR is inside DATA_DIR; keep the .env copy apart from the database"; exit 1;; esac; \
	mkdir -p "$$DIR" && chmod 700 "$$DIR" && \
	STAMP=$$(date -u +%Y%m%d-%H%M) && \
	$(EMO) backup --keep $(KEEP) && \
	cp .env "$$DIR/env-$$STAMP" && chmod 600 "$$DIR/env-$$STAMP" && \
	ls -1t "$$DIR"/env-* | tail -n +$$(($(KEEP) + 1)) | xargs rm -f && \
	echo "[emo] .env copied to $$DIR/env-$$STAMP"

# Installs the schedule in this user's crontab, replacing lines tagged
# "# emo:": `make backup` nightly at 03:00 (log: backup.log) and, with
# PING_URL set, `make ping` every 5 minutes. Takes the first backup now
cron:
	@command -v crontab >/dev/null 2>&1 || { echo "No cron here: apt-get install -y cron"; exit 1; }
	@$(MAKE) --no-print-directory backup
	@PING="$(call env,PING_URL)"; \
	{ crontab -l 2>/dev/null | grep -v '# emo:'; \
		echo "0 3 * * * cd $(CURDIR) && make backup >> $(CURDIR)/backup.log 2>&1 # emo:backup"; \
		if [ -n "$$PING" ]; then echo "*/5 * * * * cd $(CURDIR) && make ping > /dev/null 2>&1 # emo:ping"; fi; \
	} | crontab - || exit 1; \
	echo "[emo] Scheduled (crontab -l):"; crontab -l | grep '# emo:'; \
	if [ -n "$$PING" ]; then $(MAKE) --no-print-directory ping && echo "[emo] First ping sent"; \
	else echo "[emo] No PING_URL in .env: nothing tells you when the server is down (ops.md §5.2)"; fi

# Run by `make cron` every 5 minutes with PING_URL, a healthchecks.io check
# (ops.md §5.2): a ping while BASE_URL/healthz answers 200 (app, scheduler,
# proxy, certificate) and the newest snapshot is under 26 h old, otherwise
# PING_URL/fail with the reason. The check mails you when the pings stop
ping:
	@URL="$(call env,PING_URL)"; \
	if [ -z "$$URL" ]; then echo "Set PING_URL in .env: a healthchecks.io check's ping URL"; exit 1; fi; \
	if ! curl -fsS -m 10 -o /dev/null "$(BASE)/healthz"; then WHY="$(BASE)/healthz does not answer 200"; \
	elif [ -z "$$(find data/backups -name 'emo-*.sqlite' -mmin -1560 2>/dev/null)" ]; then WHY="no backup in the last 26 hours (make backup)"; \
	else WHY=; fi; \
	if [ -z "$$WHY" ]; then curl -fsS -m 10 --retry 3 -o /dev/null "$$URL"; \
	else echo "$$WHY"; curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$$WHY" "$$URL/fail"; exit 1; fi

# From your own machine: the server's snapshots into ./backups (gitignored),
# an off-host copy without a storage account (ops.md §4.2)
backup-pull:
	@if [ -z "$(DEPLOY_HOST)" ]; then echo "Usage: make backup-pull DEPLOY_HOST=user@server [DEPLOY_DIR=/srv/emo]"; exit 1; fi
	@mkdir -p backups
	rsync -az $(DEPLOY_HOST):$(DEPLOY_DIR)/data/backups/ backups/
	@echo "[emo] Newest snapshot: backups/$$(ls -1t backups | head -1)"

# ops.md §4.3: stop, restore inside the image (FILE as seen in the container,
# e.g. /data/backups/emo-20261007-0300.sqlite), start, then `make smoke`.
restore:
	@if [ -z "$(FILE)" ]; then echo "Error: specify FILE=<path inside the container>"; exit 1; fi
	docker compose down
	docker compose run --rm --no-deps emo restore $(FILE)
	docker compose up -d
	@echo "Restored. Run make smoke to confirm sign-in works."

# Read-only checks of a snapshot (FILE as seen in the container)
verify-backup:
	@if [ -z "$(FILE)" ]; then echo "Error: specify FILE=<path>"; exit 1; fi
	@$(EMO) verify-backup $(FILE)

# Health, then a dry-run sign-in request for SMOKE_EMAIL through BASE_URL.
# SEND=1 also mails SMOKE_EMAIL a sample sign-in mail for real (`emo
# mail-test`, from inside the container) and shows what the SMTP server
# answered: a request-code 202 proves no mail, since it comes before sending
# and the dry run never sends
smoke:
	@$(EMO) healthcheck
	@BASE="$(BASE)"; EMAIL="$(call env,SMOKE_EMAIL)"; \
	if [ -z "$$EMAIL" ]; then echo "Set SMOKE_EMAIL in .env"; exit 1; fi; \
	CODE=$$(curl -s -o /dev/null -w '%{http_code}' -X POST "$$BASE/api/auth/request-code" \
		-H "Origin: $$BASE" -H 'Content-Type: application/json' -H 'X-Emo-Dry-Run: 1' \
		-d "{\"email\":\"$$EMAIL\"}"); \
	if [ "$$CODE" != "202" ]; then echo "Smoke FAILED: request-code returned $$CODE"; exit 1; fi; \
	echo "[emo] Sign-in request answered through $$BASE (dry run)"
	@$(if $(filter 1,$(SEND)),$(EMO) mail-test "$(call env,SMOKE_EMAIL)")
	@echo "Smoke passed$(if $(filter 1,$(SEND)),, (no mail sent; SEND=1 sends one))"

stats:
	@$(EMO) stats

healthcheck:
	@$(EMO) healthcheck

rotate-secret:
	@if [ -z "$(OLD)" ] || [ -z "$(NEW)" ]; then echo "Usage: make rotate-secret OLD=<hex> NEW=<hex> (server stopped, after make backup)"; exit 1; fi
	@$(EMO_STOPPED) rotate-secret --old $(OLD) --new $(NEW)

accounts:
	@$(EMO) accounts $(if $(filter 1,$(EMAILS)),--emails)

account-delete:
	@if [ -z "$(ID)" ]; then echo "Usage: make account-delete ID=<account id>"; exit 1; fi
	@$(EMO_TTY) account-delete $(ID)

login-code:
	@if [ -z "$(EMAIL)" ]; then echo "Usage: make login-code EMAIL=<address>"; exit 1; fi
	@$(EMO) login-code $(EMAIL)

keyring-revert:
	@if [ -z "$(ID)" ] || [ -z "$(REV)" ]; then echo "Usage: make keyring-revert ID=<account id> REV=<rev>"; exit 1; fi
	@$(EMO) keyring-revert $(ID) $(REV)

entry-delete:
	@if [ -z "$(ID)" ] || [ -z "$(ENTRY)" ]; then echo "Usage: make entry-delete ID=<account id> ENTRY=<entry id>"; exit 1; fi
	@$(EMO) entry-delete $(ID) $(ENTRY)

# Local, no server and no database (ops.md §7.4); asks for the passphrase,
# RECOVERY=1 for the recovery key
decrypt-bundle:
	@if [ -z "$(FILE)" ] || [ -z "$(OUT)" ]; then echo "Usage: make decrypt-bundle FILE=<emo-bundle.json> OUT=<dir>"; exit 1; fi
	@deno run -A server/main.ts decrypt-bundle $(FILE) --out $(OUT) $(if $(filter 1,$(RECOVERY)),--recovery)

# Dev only: a test account with ENTRIES random ciphertext entries
seed:
	@$(DEV_ENV) $(DENO_RUN) perf/seed.ts $(or $(ENTRIES),1000)
