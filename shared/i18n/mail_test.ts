// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals } from "@std/assert";
import { loginCodeMail, recoveryKeyMail } from "./mail.ts";

Deno.test("mail - the code and the hostname, never a link", () => {
  for (const locale of ["en", "ru", "uk"] as const) {
    const m = loginCodeMail(locale, "042317", "emo.example.org");
    assert(m.subject.includes("042317"));
    assert(m.text.includes("042317") && m.text.includes("emo.example.org"));
    assert(!/https?:/.test(m.text), m.text);
    assert(m.text.includes("\n\n"), "real line breaks");
  }
});

Deno.test("mail - the renewed line only for a replaced key", () => {
  const key = "60RK-4CSM-6MV3-EE1S-78XK-RF9Y-7WV3-3927";
  const first = recoveryKeyMail("en", key, "emo.example.org", false);
  const again = recoveryKeyMail("en", key, "emo.example.org", true);
  assert(first.text.includes(key));
  assertEquals(first.text.includes("no longer works"), false);
  assertEquals(again.text.includes("no longer works"), true);
});
