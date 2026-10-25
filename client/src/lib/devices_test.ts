// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { deviceName, timeAgo } from "./devices.ts";

Deno.test("devices - names from user agents", () => {
  assertEquals(
    deviceName(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ),
    "iPhone · Safari",
  );
  assertEquals(
    deviceName(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
    ),
    "Mac · Firefox",
  );
  assertEquals(
    deviceName(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
    ),
    "Android · Chrome",
  );
  assertEquals(deviceName("curl/8.0"), null);
});

Deno.test("devices - relative last seen", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  assertEquals(timeAgo("2026-10-08T10:00:00Z", "en", now), "2 hr. ago");
  assertEquals(timeAgo("2026-10-05T12:00:00Z", "en", now), "3 days ago");
});
