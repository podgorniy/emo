// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Hono Application for Emo Server.
 * Implements security headers, database epoch middleware, CSRF, and all API routes.
 * Specification: architecture.md §3.1, reliability.md §4.1, api.md.
 */

import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";
import { bodyLimit } from "@hono/hono/body-limit";
import { routePath } from "@hono/hono/route";
import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import { getDb, getEpoch } from "./db/index.ts";
import { distDir, SOURCE_ARCHIVE } from "./dist.ts";
import { type Config, loadConfig } from "./config.ts";
import { MailService } from "./services/mail.ts";
import { PushService } from "./services/push.ts";
import { LAG_HIGH_SEC, SchedulerService } from "./services/scheduler.ts";
import { createCsrfMiddleware } from "./middleware/csrf.ts";
import { createAuthRoutes } from "./routes/auth.ts";
import { createInvitesRoutes } from "./routes/invites.ts";
import { createKeyringRoutes } from "./routes/keyring.ts";
import { createSessionsRoutes } from "./routes/sessions.ts";
import { createSettingsRoutes } from "./routes/settings.ts";
import { createAccountRoutes } from "./routes/account.ts";
import { createEntriesRoutes } from "./routes/entries.ts";
import { createPrefsRoutes } from "./routes/prefs.ts";
import { createRemindersRoutes } from "./routes/reminders.ts";
import { createPushRoutes } from "./routes/push.ts";
import type { HealthRes, InstanceRes } from "../shared/protocol.ts";
import { clientTooOld, minClientFor, parseSemver } from "../shared/version.ts";
import { SERVER_SEMVER, SERVER_VERSION } from "./version.ts";
import { type AppEnv, createAuthMiddleware } from "./middleware/auth.ts";
import { logger } from "./log.ts";
import { countOps } from "./services/ops_counters.ts";
import { rateLimiter } from "./services/rate_limit.ts";
import { encodeHex } from "../shared/crypto/encoding.ts";
import type { ApiError, SessionRes } from "../shared/protocol.ts";

/** api.md §1.4: any JSON request body. */
export const MAX_BODY_BYTES = 64 * 1024;

/** One machine, three origins (`URL.hostname` spelling). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

type SqliteFailure = "busy" | "full" | null;

/** node:sqlite in Deno reports the SQLite result only in the message. */
function sqliteFailure(err: unknown): SqliteFailure {
  const message = err instanceof Error ? err.message : "";
  if (/database is locked|SQLITE_BUSY/i.test(message)) return "busy";
  if (/database or disk is full|SQLITE_FULL/i.test(message)) return "full";
  return null;
}

function newRequestId(): string {
  return encodeHex(crypto.getRandomValues(new Uint8Array(8)));
}

const CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

export function createApp(
  db?: DatabaseSync,
  configOverride?: Partial<Config>,
  options?: {
    mailService?: MailService;
    pushService?: PushService;
    schedulerService?: SchedulerService;
    /** The built client (tests); default server/dist.ts */
    distDir?: string;
  },
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const database = db || getDb();
  rateLimiter.initDb(database);
  const config: Config = { ...loadConfig(), ...configOverride };

  const mailService = options?.mailService || new MailService(config);
  mailService.onCounter ??= (name) => countOps(database, name);
  const pushService = options?.pushService || new PushService(config);
  const schedulerService = options?.schedulerService ||
    new SchedulerService(database, pushService);

  // 0. Request id and one `http_request` line per request (ops.md §5.1)
  app.use("*", async (c, next) => {
    const reqId = newRequestId();
    c.set("reqId", reqId);
    const started = performance.now();
    await next();
    c.header("X-Request-Id", reqId);
    if (c.req.path.startsWith("/api/")) {
      const account = c.get("account");
      logger.info("http_request", {
        req_id: reqId,
        method: c.req.method,
        route: routePath(c),
        status: c.res.status,
        dur_ms: Math.round(performance.now() - started),
        ...(account ? { account_id: account.id } : {}),
        ...(c.req.header("X-Emo-Client")
          ? { client: c.req.header("X-Emo-Client") }
          : {}),
      });
    }
  });

  // Unhandled errors: the envelope with the request id, never a stack
  // (reliability.md §1.5). SQLite busy has already waited `busy_timeout`.
  app.onError((err, c: Context<AppEnv>) => {
    const reqId = c.get("reqId") ?? newRequestId();
    const failure = sqliteFailure(err);
    if (failure === "busy") {
      logger.warn("db_busy", { req_id: reqId, route: routePath(c) });
      return c.json(
        {
          error: { code: "db_busy", message: "Database busy; retry" },
        } satisfies ApiError,
        503,
      );
    }
    if (failure === "full") {
      logger.error("db_full", { req_id: reqId, route: routePath(c) });
      return c.json(
        {
          error: {
            code: "insufficient_storage",
            message: "Server storage is full",
          },
        } satisfies ApiError,
        507,
      );
    }
    logger.error("http_unhandled", { req_id: reqId, route: routePath(c), err });
    return c.json(
      {
        error: {
          code: "internal",
          message: `Internal error (request ${reqId})`,
        },
      } satisfies ApiError,
      500,
    );
  });

  app.notFound((c) =>
    c.json(
      { error: { code: "not_found", message: "Not found" } } satisfies ApiError,
      404,
    )
  );

  // 1. Security Headers & Protocol Headers Middleware
  app.use("*", async (c, next) => {
    await next();

    // Protocol headers. X-Emo-Server comes first and never depends on the
    // database: the client counts a 5xx without it as no answer from Emo
    c.header("X-Emo-Server", SERVER_VERSION);
    try {
      c.header("X-Emo-Epoch", getEpoch(database));
    } catch {
      // The database is failing: the error envelope still says it is Emo
      // (reliability.md §1.5)
    }

    // /api routes must never be cached
    if (c.req.path.startsWith("/api")) {
      c.header("Cache-Control", "no-store");
    }

    // Dev is plain http://localhost, where upgrading requests would break them
    c.header(
      "Content-Security-Policy",
      config.devMode ? CSP : `${CSP}; upgrade-insecure-requests`,
    );

    c.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    // Legacy mirror of frame-ancestors 'none'
    c.header("X-Frame-Options", "DENY");
  });

  // One origin per instance: a page opened at another loopback spelling of a
  // loopback BASE_URL (127.0.0.1 for localhost) moves to BASE_URL. The browser
  // keeps keys, the service worker and cookies per origin, and the CSRF check
  // accepts BASE_URL's alone, so sign-in there would end in 403. A public
  // BASE_URL never redirects: behind a proxy the Host can be anything
  const base = new URL(config.baseUrl);
  if (LOOPBACK_HOSTS.has(base.hostname)) {
    app.use("*", async (c, next) => {
      const url = new URL(c.req.url);
      if (
        (c.req.method === "GET" || c.req.method === "HEAD") &&
        url.hostname !== base.hostname && LOOPBACK_HOSTS.has(url.hostname) &&
        url.port === base.port && !url.pathname.startsWith("/api/") &&
        url.pathname !== "/healthz"
      ) {
        return c.redirect(`${base.origin}${url.pathname}${url.search}`, 308);
      }
      await next();
    });
  }

  // API answers over 1 KB go out gzip-compressed (performance.md §4.4):
  // a full pull page is ≈ 1.4 MB of base64. Answers are buffered JSON, so the
  // size is known; smaller ones are not worth the work
  app.use("/api/*", async (c, next) => {
    await next();
    const res = c.res;
    if (
      !/\bgzip\b/.test(c.req.header("Accept-Encoding") ?? "") ||
      res.headers.has("Content-Encoding") ||
      !(res.headers.get("Content-Type") ?? "").includes("json") ||
      !res.body
    ) return;
    const body = new Uint8Array(await res.arrayBuffer());
    const headers = new Headers(res.headers);
    headers.append("Vary", "Accept-Encoding");
    if (body.length < 1024) {
      c.res = new Response(body, { status: res.status, headers });
      return;
    }
    headers.set("Content-Encoding", "gzip");
    headers.delete("Content-Length");
    c.res = new Response(
      new Blob([body]).stream().pipeThrough(new CompressionStream("gzip")),
      { status: res.status, headers },
    );
  });

  // 2. Compatibility window (reliability.md §3): a client outside it gets
  // 426 and keeps saving locally until it updates. Tools that send no
  // X-Emo-Client (curl, the healthcheck) are not checked.
  app.use("/api/*", async (c, next) => {
    const header = c.req.header("X-Emo-Client");
    if (header !== undefined) {
      const client = parseSemver(header);
      if (!client || clientTooOld(client, SERVER_SEMVER)) {
        return c.json(
          {
            error: {
              code: "upgrade_required",
              message:
                `Client ${header} is outside the compatibility window of server ${SERVER_VERSION}`,
              min_client: minClientFor(SERVER_SEMVER),
            },
          } satisfies ApiError,
          426,
        );
      }
    }
    await next();
  });

  // 64 KiB for every /api body; the entry, prefs and keyring routes check
  // their own smaller blob limits
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "payload_too_large",
              message: "Request body over 64 KiB",
            },
          } satisfies ApiError,
          413,
        ),
    }),
  );

  // 3. CSRF Protection for mutating API routes
  const csrfMiddleware = createCsrfMiddleware(config);
  app.use("/api/*", csrfMiddleware);

  // 4. Health check endpoint (checked by compose healthcheck & ops)
  app.get("/healthz", (c) => {
    let dbOk = false;
    try {
      const check = database.prepare("SELECT 1 as alive;").get() as {
        alive: number;
      } | undefined;
      dbOk = check?.alive === 1;
    } catch {
      dbOk = false;
    }
    const lastTick = schedulerService.getLastTickAt();
    const lag = schedulerService.getLagSec();
    const schedulerOk = lag === null || lag <= LAG_HIGH_SEC;

    if (!dbOk || !schedulerOk) {
      const res: Omit<HealthRes, "version" | "epoch"> = {
        ok: false,
        db: dbOk ? "ok" : "error",
        scheduler_last_tick_at: lastTick,
        error: {
          code: "unhealthy",
          message: dbOk
            ? `scheduler tick older than ${LAG_HIGH_SEC}s`
            : "database cannot be queried",
        },
      };
      return c.json(res, 503);
    }

    const res: HealthRes = {
      ok: true,
      db: "ok",
      scheduler_last_tick_at: lastTick,
      ...(lag === null ? {} : { scheduler_lag_sec: lag }),
      mail: mailService.status(),
      version: SERVER_VERSION,
      epoch: getEpoch(database),
    };
    return c.json(res, 200);
  });

  // 5. Instance metadata (unauthenticated)
  app.get("/api/instance", (c) => {
    const res: InstanceRes = {
      version: SERVER_VERSION,
      source_url: config.sourceUrl,
      crisis_url: config.crisisUrl,
      privacy_notice_url: config.privacyNoticeUrl,
      operator_contact: config.operatorContact,
      recovery_mail_enabled: config.recoveryMailEnabled,
      invites_by_users: config.invitesByUsers,
      registration: config.registration,
    };
    return c.json(res, 200);
  });

  // 6. Mount API route routers
  const authRoutes = createAuthRoutes(database, config, mailService);
  app.route("/api/auth", authRoutes);

  // GET /api/session per api.md §2.1
  const authMiddleware = createAuthMiddleware(database);
  app.get("/api/session", authMiddleware, (c) => {
    const account = c.get("account");
    const keyringRow = database.prepare(`
      SELECT key_version FROM keyrings
      WHERE account_id = ?
      ORDER BY rev DESC
      LIMIT 1
    `).get(account.id) as { key_version: number } | undefined;

    return c.json(
      {
        account: {
          id: account.id,
          locale: account.locale,
          tz: account.tz,
          has_keyring: !!keyringRow,
          current_key_version: keyringRow ? keyringRow.key_version : null,
        },
      } satisfies SessionRes,
      200,
    );
  });

  app.route("/api/invites", createInvitesRoutes(database, config));
  app.route("/api/keyring", createKeyringRoutes(database));
  app.route("/api/sessions", createSessionsRoutes(database));
  app.route("/api/settings", createSettingsRoutes(database));
  app.route("/api/account", createAccountRoutes(database, config, mailService));
  app.route("/api/entries", createEntriesRoutes(database));
  app.route("/api/prefs", createPrefsRoutes(database));
  app.route("/api/reminders", createRemindersRoutes(database));
  app.route("/api/push", createPushRoutes(database, pushService));

  // 7. Static files and SPA fallback
  const MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
  };

  const dist = options?.distDir ?? distDir();

  /** A built-in page under a short address of its own (sw.js PAGES too) */
  const PAGES: Record<string, string> = {
    "/methodology": "/methodology.html",
  };

  /**
   * performance.md §4.4: the build's brotli or gzip sibling of a
   * compressible file when the browser accepts it, else the file itself.
   */
  const ENCODINGS: Array<[string, string]> = [["br", ".br"], ["gzip", ".gz"]];
  const COMPRESSIBLE = /\.(js|css|html|svg|json|webmanifest|txt|wasm)$/;
  async function readEncoded(
    file: string,
    c: Context,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (COMPRESSIBLE.test(file)) {
      c.header("Vary", "Accept-Encoding");
      const accepts = c.req.header("Accept-Encoding") ?? "";
      for (const [encoding, suffix] of ENCODINGS) {
        if (!new RegExp(`\\b${encoding}\\b`).test(accepts)) continue;
        try {
          const body = await Deno.readFile(file + suffix);
          c.header("Content-Encoding", encoding);
          return body;
        } catch {
          // No sibling (a small file): try the next, then the plain one
        }
      }
    }
    return await Deno.readFile(file);
  }

  // AGPL §13: the source of this exact build, packed by tools/pack_source.ts
  // and embedded with the client; `SOURCE_URL` points here unless set
  app.get(`/${SOURCE_ARCHIVE}`, async (c) => {
    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await Deno.readFile(path.join(dist, SOURCE_ARCHIVE));
    } catch {
      return c.text("Not found", 404);
    }
    c.header("Content-Type", "application/gzip");
    c.header(
      "Content-Disposition",
      `attachment; filename="emo-${config.version}-source.tar.gz"`,
    );
    c.header("Cache-Control", "no-cache");
    return c.body(body, 200);
  });

  app.get("*", async (c) => {
    const reqPath = c.req.path;
    if (reqPath.startsWith("/api/")) {
      return c.json(
        {
          error: { code: "not_found", message: "API endpoint not found" },
        } satisfies ApiError,
        404,
      );
    }

    const cleanPath = reqPath === "/"
      ? "/index.html"
      : PAGES[reqPath] ?? reqPath;
    // The build's own bookkeeping is not served
    if (cleanPath.startsWith("/.vite/")) {
      return c.text("Not found", 404);
    }
    const filePath = path.join(dist, cleanPath.replace(/^\//, ""));

    // Check if requested file exists
    try {
      const stat = await Deno.stat(filePath);
      if (stat.isFile) {
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        const content = await readEncoded(filePath, c);

        if (cleanPath.startsWith("/assets/")) {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        } else if (cleanPath === "/sw.js") {
          c.header("Cache-Control", "no-cache, no-store, must-revalidate");
        } else {
          c.header("Cache-Control", "no-cache, must-revalidate");
        }

        c.header("Content-Type", mime);
        return c.body(content, 200);
      }
    } catch {
      // Not found as a file
    }

    // M69: only a page navigation gets the app shell. A missing script, style
    // or icon is a 404 — never HTML under a file's URL, which a tab still on
    // an old build would run as a script and a service worker would cache.
    const accept = c.req.header("Accept") ?? "";
    const navigation = path.extname(cleanPath) === "" ||
      accept.includes("text/html");
    if (!navigation || cleanPath.startsWith("/assets/")) {
      return c.text("Not found", 404);
    }

    // SPA fallback: return index.html
    try {
      const indexPath = path.join(dist, "index.html");
      const indexContent = await readEncoded(indexPath, c);
      c.header("Content-Type", "text/html; charset=utf-8");
      c.header("Cache-Control", "no-cache, must-revalidate");
      return c.body(indexContent, 200);
    } catch {
      return c.text(
        "Client build not found. Run `deno task build:client`.",
        404,
      );
    }
  });

  return app;
}
