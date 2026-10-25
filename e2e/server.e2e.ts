// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * reliability.md §1.5, §6: the compiled binary stops cleanly on SIGTERM
 * (stop accepting, release the lease, checkpoint and close the database) and
 * exits 0 well inside its 10 s budget.
 */
import { assertEquals } from "@std/assert";
import { startServer } from "./harness.ts";

Deno.test("e2e - SIGTERM stops the binary cleanly with exit 0", async () => {
  const server = await startServer();
  const res = await fetch(`${server.url}/api/instance`);
  assertEquals(res.status, 200);
  await res.body?.cancel();
  const started = Date.now();
  assertEquals(await server.stop(), 0);
  assertEquals(Date.now() - started < 10_000, true);
});

Deno.test("e2e - the app and large API answers are sent compressed", async () => {
  const server = await startServer();
  try {
    const head = async (path: string, accept: string) => {
      const out = await new Deno.Command("curl", {
        args: [
          "-s",
          "-o",
          "/dev/null",
          "-D",
          "-",
          "-H",
          `Accept-Encoding: ${accept}`,
          `${server.url}${path}`,
        ],
      }).output();
      const text = new TextDecoder().decode(out.stdout);
      return /content-encoding: (\S+)/i.exec(text)?.[1] ?? null;
    };
    const html = await (await fetch(`${server.url}/`)).text();
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)![1];
    assertEquals(await head(script, "gzip, deflate, br"), "br");
    assertEquals(await head(script, "gzip"), "gzip");
    assertEquals(await head(script, "identity"), null);
    assertEquals(await head("/", "br"), "br");
    // /api/instance is small: not worth compressing
    assertEquals(await head("/api/instance", "gzip"), null);
    // A 404 envelope is small too; /healthz is not under /api
    assertEquals(await head("/api/nowhere", "gzip"), null);
  } finally {
    await server.stop();
  }
});
