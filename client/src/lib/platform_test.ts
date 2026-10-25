// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { isApplePlatform } from "./platform.ts";

Deno.test("platform - ⌘ on Apple, Ctrl elsewhere", () => {
  const mac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const win =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  const linux =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  assertEquals(isApplePlatform(mac, "MacIntel"), true);
  assertEquals(isApplePlatform("", "iPhone"), true);
  assertEquals(isApplePlatform(win, "Win32"), false);
  assertEquals(isApplePlatform(linux, "Linux x86_64"), false);
});
