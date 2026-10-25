// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.ts";
import { runMigrations } from "./db/index.ts";
import { SERVER_SEMVER, SERVER_VERSION } from "./version.ts";
import { setLogSink } from "./log.ts";

Deno.test("app - healthz and security headers", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);

  const app = createApp(db, { version: "0.1.0" });
  const req = new Request("http://localhost/healthz");
  const res = await app.fetch(req);

  assertEquals(res.status, 200);

  // Security headers check
  assertEquals(res.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(res.headers.get("Cross-Origin-Opener-Policy"), "same-origin");
  assertEquals(res.headers.get("Referrer-Policy"), "no-referrer");
  assertEquals(res.headers.get("X-Emo-Server"), SERVER_VERSION);
  assertEquals(!!res.headers.get("X-Emo-Epoch"), true);

  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.db, "ok");
  assertEquals(body.version, SERVER_VERSION);
  assertEquals(typeof body.epoch, "string");

  db.close();
});

Deno.test("app - instance endpoint returns metadata", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);

  const app = createApp(db, {
    version: "0.1.0",
    sourceUrl: "https://github.com/example/emo",
    crisisUrl: "https://findahelpline.com",
  });

  const req = new Request("http://localhost/api/instance");
  const res = await app.fetch(req);

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.version, SERVER_VERSION);
  assertEquals(body.source_url, "https://github.com/example/emo");
  assertEquals(body.crisis_url, "https://findahelpline.com");
  // Anyone may create an account unless REGISTRATION=invite
  assertEquals(body.registration, "open");
  const closed = createApp(db, { version: "0.1.0", registration: "invite" });
  assertEquals(
    (await (await closed.fetch(req.clone())).json()).registration,
    "invite",
  );

  db.close();
});

Deno.test("app - static files and SPA fallback", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);

  const app = createApp(db, { version: "0.1.0" });

  // 1. Root / serves index.html
  const rootReq = new Request("http://localhost/");
  const rootRes = await app.fetch(rootReq);
  assertEquals(rootRes.status, 200);
  assertEquals(
    rootRes.headers.get("Content-Type")?.includes("text/html"),
    true,
  );

  // 2. The web app manifest
  const manifestReq = new Request("http://localhost/manifest.webmanifest");
  const manifestRes = await app.fetch(manifestReq);
  assertEquals(manifestRes.status, 200);
  assertEquals(
    manifestRes.headers.get("Content-Type")?.includes(
      "application/manifest+json",
    ),
    true,
  );

  // 3. /sw.js serves service worker
  const swReq = new Request("http://localhost/sw.js");
  const swRes = await app.fetch(swReq);
  assertEquals(swRes.status, 200);
  assertEquals(swRes.headers.get("Content-Type")?.includes("javascript"), true);

  // 4. SPA fallback for a page (e.g. /journal) serves index.html
  const spaReq = new Request("http://localhost/journal", {
    headers: { Accept: "text/html" },
  });
  const spaRes = await app.fetch(spaReq);
  assertEquals(spaRes.status, 200);
  assertEquals(spaRes.headers.get("Content-Type")?.includes("text/html"), true);

  // 4b. The methodology under its short address: the page, not the app
  const pageRes = await app.fetch(
    new Request("http://localhost/methodology", {
      headers: { Accept: "text/html" },
    }),
  );
  assertEquals(pageRes.status, 200);
  assert((await pageRes.text()).includes("Why Emo asks what it asks"));

  // 5. Unknown API route returns 404 JSON (not SPA fallback)
  const apiNotFoundReq = new Request("http://localhost/api/unknown");
  const apiNotFoundRes = await app.fetch(apiNotFoundReq);
  assertEquals(apiNotFoundRes.status, 404);
  const errBody = await apiNotFoundRes.json();
  assertEquals(errBody.error.code, "not_found");

  db.close();
});

Deno.test("app - a client outside the compatibility window gets 426", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const app = createApp(db);
  const { major, minor } = SERVER_SEMVER;
  const instance = (client?: string) =>
    app.fetch(
      new Request("http://localhost/api/instance", {
        headers: client ? { "X-Emo-Client": client } : {},
      }),
    );

  assertEquals((await instance()).status, 200); // tools send no version
  assertEquals((await instance(SERVER_VERSION)).status, 200);
  assertEquals((await instance(`${major}.${minor + 3}.0`)).status, 200);
  if (minor > 0) {
    assertEquals((await instance(`${major}.${minor - 1}.9`)).status, 200);
  }
  for (
    const old of [`${major + 1}.0.0`, `${major}.${minor - 2}.0`, "nonsense"]
  ) {
    if (old.includes("-")) continue;
    const res = await instance(old);
    assertEquals(res.status, 426, old);
    const body = await res.json();
    assertEquals(body.error.code, "upgrade_required");
    assertEquals(body.error.min_client, `${major}.${Math.max(0, minor - 1)}`);
    assertEquals(res.headers.get("X-Emo-Server"), SERVER_VERSION);
  }
  db.close();
});

Deno.test("app - errors use the envelope: body limit, unknown routes, bad input", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const restoreLog = setLogSink(() => {});
  const app = createApp(db, { baseUrl: "http://localhost:8080" });
  const origin = {
    Origin: "http://localhost:8080",
    "Content-Type": "application/json",
  };
  const call = (path: string, init: RequestInit = {}) =>
    app.fetch(new Request(`http://localhost:8080${path}`, init));
  const errorOf = async (res: Response) => (await res.json()).error;

  try {
    // Over 64 KiB, before anything reads it (request-code is unauthenticated)
    const big = await call("/api/auth/request-code", {
      method: "POST",
      headers: origin,
      body: JSON.stringify({ email: "a@b.cd", pad: "x".repeat(70 * 1024) }),
    });
    assertEquals(big.status, 413);
    assertEquals((await errorOf(big)).code, "payload_too_large");

    // Unknown /api routes, any method
    for (const method of ["GET", "POST", "DELETE"]) {
      const res = await call("/api/nope", { method, headers: origin });
      assertEquals(res.status, 404, method);
      assertEquals((await errorOf(res)).code, "not_found");
      assert(/^[0-9a-f]{16}$/.test(res.headers.get("X-Request-Id") ?? ""));
    }

    // `Origin: null` is a mismatch, not a crash
    const nullOrigin = await call("/api/auth/request-code", {
      method: "POST",
      headers: { Origin: "null", "Content-Type": "application/json" },
      body: "{}",
    });
    assertEquals(nullOrigin.status, 403);
    // The scheme counts (L6)
    const https = await call("/api/auth/request-code", {
      method: "POST",
      headers: {
        Origin: "https://localhost:8080",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assertEquals(https.status, 403);

    // A non-string email
    const email = await call("/api/auth/request-code", {
      method: "POST",
      headers: origin,
      body: JSON.stringify({ email: 42 }),
    });
    assertEquals(email.status, 400);
    assertEquals((await errorOf(email)).code, "invalid_field");
    const verify = await call("/api/auth/verify", {
      method: "POST",
      headers: origin,
      body: JSON.stringify({ email: ["x"], code: 123456, tz: {} }),
    });
    assertEquals(verify.status, 400);

    // A malformed `%` in the session cookie is no session
    const cookie = await call("/api/session", {
      headers: { Cookie: "emo_session=%E0%A4%A" },
    });
    assertEquals(cookie.status, 401);
  } finally {
    restoreLog();
    db.close();
  }
});

Deno.test("app - a page at another loopback spelling of BASE_URL moves to BASE_URL", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const restoreLog = setLogSink(() => {});
  const local = createApp(db, { baseUrl: "http://localhost:8080" });
  const get = (app: typeof local, url: string) =>
    app.fetch(new Request(url, { redirect: "manual" }));

  try {
    // 127.0.0.1 and [::1] are this machine to the user but other origins to
    // the browser: their sign-in would end in 403 origin_mismatch
    for (const host of ["127.0.0.1", "[::1]"]) {
      const res = await get(local, `http://${host}:8080/settings?tab=a`);
      assertEquals(res.status, 308, host);
      assertEquals(
        res.headers.get("Location"),
        "http://localhost:8080/settings?tab=a",
      );
    }
    // Not the healthcheck (it calls 127.0.0.1), the API, another port or BASE_URL
    for (
      const url of [
        "http://127.0.0.1:8080/healthz",
        "http://127.0.0.1:8080/api/session",
        "http://127.0.0.1:9090/",
        "http://localhost:8080/",
      ]
    ) {
      assert((await get(local, url)).status !== 308, url);
    }
    // The API at the other spelling is still refused, not redirected
    const post = await local.fetch(
      new Request("http://127.0.0.1:8080/api/auth/request-code", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:8080",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    assertEquals(post.status, 403);

    // A public BASE_URL never redirects (a proxy may send any Host)
    const hosted = createApp(db, { baseUrl: "https://emo.example.com" });
    assert((await get(hosted, "http://127.0.0.1:8080/")).status !== 308);
  } finally {
    restoreLog();
    db.close();
  }
});

Deno.test("app - an unhandled error is a 500 envelope with the request id", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const lines: string[] = [];
  const restoreLog = setLogSink((l) => lines.push(l));
  const app = createApp(db);
  db.close(); // every query now throws
  try {
    const res = await app.fetch(
      new Request("http://localhost/api/session", {
        headers: { Cookie: "emo_session=abc" },
      }),
    );
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error.code, "internal");
    const reqId = res.headers.get("X-Request-Id")!;
    assert(body.error.message.includes(reqId));
    assert(!JSON.stringify(body).includes("at "), "no stack to the client");
    assert(
      lines.some((l) => l.includes("http_unhandled") && l.includes(reqId)),
    );
    // Still Emo's answer, with the database down: the client tells it from a
    // reverse proxy answering for a stopped server (reliability.md §1.5)
    assertEquals(res.headers.get("X-Emo-Server"), SERVER_VERSION);
    assert(res.headers.get("Content-Security-Policy"));
  } finally {
    restoreLog();
  }
});

Deno.test("app - missing files are 404; only pages get the app shell (M69)", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const app = createApp(db);
  const get = (p: string, accept = "*/*") =>
    app.fetch(
      new Request(`http://localhost${p}`, { headers: { Accept: accept } }),
    );
  try {
    for (
      const missing of ["/assets/old-abc123.js", "/icon-999.png", "/nope.css"]
    ) {
      const res = await get(missing);
      assertEquals(res.status, 404, missing);
      assert(
        !(res.headers.get("Content-Type") ?? "").includes("text/html"),
        missing,
      );
      await res.body?.cancel();
    }
    assertEquals((await get("/.vite/manifest.json")).status, 404);
    // A page route is a navigation: the shell (or the "build missing" note)
    const page = await get("/settings", "text/html");
    assert(page.status === 200 || page.status === 404);
    await page.body?.cancel();
  } finally {
    db.close();
  }
});

Deno.test("app - every response carries the reliability.md §4.1 headers", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const app = createApp(db, { baseUrl: "http://localhost:8080" });
  const origin = { Origin: "http://localhost:8080" };
  const responses: Array<[string, Response]> = [
    ["page", await app.request("/")],
    ["api", await app.request("/api/instance")],
    ["api 404", await app.request("/api/nowhere")],
    ["api 401", await app.request("/api/session")],
    [
      "api 400",
      await app.request("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...origin },
        body: "{",
      }),
    ],
    [
      "api 413",
      await app.request("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...origin },
        body: JSON.stringify({ email: "x".repeat(70_000) }),
      }),
    ],
    [
      "api 426",
      await app.request("/api/instance", {
        headers: { "X-Emo-Client": "nonsense" },
      }),
    ],
  ];
  const csp = responses[0][1].headers.get("Content-Security-Policy");
  assert(
    csp?.includes("style-src 'self'") && csp.includes("default-src 'none'"),
  );
  for (const [what, res] of responses) {
    await res.body?.cancel();
    const h = (name: string) => res.headers.get(name);
    assertEquals(h("Content-Security-Policy"), csp, what);
    assertEquals(
      h("Strict-Transport-Security"),
      "max-age=31536000; includeSubDomains",
      what,
    );
    assertEquals(h("Referrer-Policy"), "no-referrer", what);
    assertEquals(
      h("Permissions-Policy"),
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
      what,
    );
    assertEquals(h("X-Content-Type-Options"), "nosniff", what);
    assertEquals(h("Cross-Origin-Opener-Policy"), "same-origin", what);
    assertEquals(h("Cross-Origin-Resource-Policy"), "same-origin", what);
    assertEquals(h("X-Frame-Options"), "DENY", what);
    if (what !== "page") {
      assertEquals(h("Cache-Control"), "no-store", what);
      assertEquals(!!h("X-Emo-Epoch"), true, what);
    }
  }
  assertEquals(
    responses.map(([, r]) => r.status),
    [200, 200, 404, 401, 400, 413, 426],
  );
});

Deno.test("app - /source.tar.gz is this build's archive, a download; 404 without one", async () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const dir = await Deno.makeTempDir();
  try {
    const app = (dist: string) =>
      createApp(db, { version: "1.2.3" }, { distDir: dist });
    const get = (dist: string) =>
      app(dist).fetch(new Request("http://localhost/source.tar.gz"));

    const missing = await get(dir);
    assertEquals(missing.status, 404);
    await missing.body?.cancel();

    const bytes = new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]);
    await Deno.writeFile(`${dir}/source.tar.gz`, bytes);
    const res = await get(dir);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/gzip");
    assertEquals(
      res.headers.get("Content-Disposition"),
      'attachment; filename="emo-1.2.3-source.tar.gz"',
    );
    assertEquals(new Uint8Array(await res.arrayBuffer()), bytes);
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
