// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import {
  clientTooOld,
  minClientFor,
  parseSemver,
  serverTooOld,
} from "./version.ts";

const v = (s: string) => parseSemver(s)!;

Deno.test("version - parse", () => {
  assertEquals(parseSemver("1.2.3"), { major: 1, minor: 2, patch: 3 });
  assertEquals(parseSemver(" 0.10.0\n"), { major: 0, minor: 10, patch: 0 });
  assertEquals(parseSemver("1.2.3-rc.1")?.minor, 2);
  assertEquals(parseSemver("1.2"), null);
  assertEquals(parseSemver("abc"), null);
});

Deno.test("version - the client may be one minor behind the server", () => {
  assertEquals(clientTooOld(v("1.4.0"), v("1.4.9")), false);
  assertEquals(clientTooOld(v("1.3.7"), v("1.4.0")), false);
  assertEquals(clientTooOld(v("1.2.9"), v("1.4.0")), true);
  assertEquals(clientTooOld(v("0.9.0"), v("1.0.0")), true);
  assertEquals(clientTooOld(v("2.0.0"), v("1.9.0")), true);
  assertEquals(minClientFor(v("1.4.2")), "1.3");
  assertEquals(minClientFor(v("1.0.0")), "1.0");
});

Deno.test("version - a server more than one minor behind pauses sync", () => {
  assertEquals(serverTooOld(v("1.4.0"), v("1.5.0")), false);
  assertEquals(serverTooOld(v("1.3.0"), v("1.5.0")), true);
  assertEquals(serverTooOld(v("1.9.0"), v("2.0.0")), false); // the server sends 426 instead
});
