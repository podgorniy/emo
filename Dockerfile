# SPDX-License-Identifier: AGPL-3.0-or-later
# Stage 1: Build binary and assets
# Deno 2.9.6 (also in deno.json and .tool-versions): Temporal is built in
# without unstable flags (development.md §1, §9). Pinned by digest.
FROM denoland/deno:2.9.6@sha256:2014dc167ece617ef7e7ba40631ac2234c59e75ce693e7cc2dc2602b3c87859d AS builder

WORKDIR /app

# Copy dependency files and install exactly what deno.lock records
COPY deno.json deno.lock package.json ./
RUN deno install --frozen

# Copy sources
COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/
COPY VERSION ./
# The bundle-size gate that `deno task build` runs (performance.md §5)
COPY perf/ ./perf/
# The rest of the source: `deno task build` packs it into the archive the
# server offers at /source.tar.gz (AGPL §13, tools/pack_source.ts)
COPY .dockerignore .env.example .gitignore .tool-versions CHANGELOG.md \
     Caddyfile Dockerfile LICENSE Makefile README.md compose.yml ./
COPY .github/ ./.github/
COPY tools/ ./tools/
COPY e2e/ ./e2e/
COPY llm/ ./llm/

# Build client assets, pack the source and compile the single binary (embeds
# client/dist with the archive and the SQL migrations; one definition in
# deno.json, used by `make build` too)
RUN deno task build

# Stage 2: Minimal distroless runtime, pinned by digest
FROM gcr.io/distroless/cc-debian12:nonroot@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f

WORKDIR /
COPY --from=builder /app/bin/emo /emo

ENV DATA_DIR=/data
ENV PORT=8080
VOLUME ["/data"]

USER nonroot:nonroot
EXPOSE 8080

ENTRYPOINT ["/emo"]
CMD ["serve"]
