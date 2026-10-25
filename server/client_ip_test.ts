// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import {
  clientIp,
  isPrivateAddress,
  parseTrustedProxies,
  trustedProxiesProblems,
} from "./client_ip.ts";
import { startTestServer } from "./testing/harness.ts";

const privateOnly = parseTrustedProxies("private");

Deno.test("client ip - a client cannot pick its bucket with X-Forwarded-For", () => {
  assertEquals(clientIp("203.0.113.9", "1.2.3.4", privateOnly), "203.0.113.9");
  assertEquals(clientIp("203.0.113.9", undefined, privateOnly), "203.0.113.9");
  assertEquals(clientIp(undefined, "1.2.3.4", privateOnly), "unknown");
});

Deno.test("client ip - behind a trusted proxy, the right-most untrusted hop", () => {
  assertEquals(
    clientIp("127.0.0.1", "198.51.100.7", privateOnly),
    "198.51.100.7",
  );
  // A spoofed entry on the left is ignored
  assertEquals(
    clientIp("172.18.0.2", "6.6.6.6, 198.51.100.7", privateOnly),
    "198.51.100.7",
  );
  // Two proxies
  assertEquals(
    clientIp("127.0.0.1", "198.51.100.7, 10.0.0.2", privateOnly),
    "198.51.100.7",
  );
  assertEquals(clientIp("::1", undefined, privateOnly), "::1");
  assertEquals(clientIp("127.0.0.1", "10.0.0.5", privateOnly), "10.0.0.5");
});

Deno.test("client ip - TRUSTED_PROXIES: none, exact addresses, validation", () => {
  const none = parseTrustedProxies("none");
  assertEquals(clientIp("127.0.0.1", "198.51.100.7", none), "127.0.0.1");
  const exact = parseTrustedProxies("203.0.113.5");
  assertEquals(clientIp("203.0.113.5", "198.51.100.7", exact), "198.51.100.7");
  assertEquals(clientIp("10.0.0.1", "198.51.100.7", exact), "10.0.0.1");

  assertEquals(trustedProxiesProblems(""), []);
  assertEquals(trustedProxiesProblems("private, 203.0.113.5, 2001:db8::1"), []);
  assertEquals(trustedProxiesProblems("private,proxy.local").length, 1);
});

Deno.test("client ip - private ranges", () => {
  for (
    const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.1.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]
  ) {
    assertEquals(isPrivateAddress(ip), true, ip);
  }
  for (
    const ip of [
      "172.15.0.1",
      "172.32.0.1",
      "8.8.8.8",
      "2001:db8::1",
      "::ffff:8.8.8.8",
    ]
  ) {
    assertEquals(isPrivateAddress(ip), false, ip);
  }
});

Deno.test("client ip - spoofed headers share the peer's request-code limit", async () => {
  const { app } = startTestServer();
  const info = {
    remoteAddr: { transport: "tcp", hostname: "203.0.113.9", port: 50000 },
  } as Deno.ServeHandlerInfo<Deno.NetAddr>;
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const res = await app.fetch(
      new Request("http://localhost:8080/api/auth/request-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:8080",
          "X-Forwarded-For": `198.51.100.${i}`,
        },
        body: JSON.stringify({ email: `spoof${i}@example.org`, locale: "en" }),
      }),
      info,
    );
    await res.body?.cancel();
    statuses.push(res.status);
  }
  // 10 per IP per hour (api.md §1.3)
  assertEquals(statuses.slice(0, 10).every((s) => s === 202), true);
  assertEquals(statuses[10], 429);
});
