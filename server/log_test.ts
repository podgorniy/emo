// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals } from "@std/assert";
import { log, logger, redactString, setLogSink } from "./log.ts";

function capture(level: "debug" | "info" | "warn" | "error" = "debug") {
  const lines: string[] = [];
  const restore = setLogSink((l) => lines.push(l), level);
  return { lines, restore };
}

Deno.test("log - one JSON object per line with ts, level and msg", () => {
  const { lines, restore } = capture();
  try {
    logger.info("http_request", {
      route: "/api/entries/:id",
      status: 201,
      dur_ms: 3,
    });
    assertEquals(lines.length, 1);
    const rec = JSON.parse(lines[0]);
    assertEquals(rec.level, "info");
    assertEquals(rec.msg, "http_request");
    assertEquals(rec.route, "/api/entries/:id");
    assert(!Number.isNaN(Date.parse(rec.ts)));
  } finally {
    restore();
  }
});

Deno.test("log - below the level nothing is written", () => {
  const { lines, restore } = capture("warn");
  try {
    log("info", "scheduler_tick");
    log("debug", "scheduler_tick");
    log("warn", "scheduler_tick_skipped");
    assertEquals(lines.length, 1);
  } finally {
    restore();
  }
});

Deno.test("log - secrets never reach the sink", () => {
  const { lines, restore } = capture();
  const key = "7K3M-9QX2-ABCD-EFGH-JKMN-PQRS-TVWX-YZ01";
  try {
    logger.error("mail_failed", {
      email: "person@example.org",
      code: "123456",
      token: "secret-token",
      recovery_key: key,
      passphrase: "hunter2 hunter2",
      cookie: "emo_session=abc",
      authorization: "Bearer x",
      body: "mail text",
      payload: { title: "x" },
      err: new Error(`SMTP refused person@example.org, key ${key}`),
      nested: { email: "a@b.cd", note: `key ${key.replaceAll("-", "")}` },
    });
    const out = lines.join("\n");
    for (
      const secret of [
        "person@example.org",
        "123456",
        "secret-token",
        key,
        key.replaceAll("-", ""),
        "hunter2",
        "emo_session",
        "Bearer",
        "mail text",
        "a@b.cd",
      ]
    ) {
      assert(!out.includes(secret), `leaked ${secret}: ${out}`);
    }
    const rec = JSON.parse(lines[0]);
    assertEquals(rec.err, "Error: SMTP refused [email], key [key]");
  } finally {
    restore();
  }
});

Deno.test("log - redactString leaves ordinary text alone", () => {
  assertEquals(redactString("scheduler lag 12 s"), "scheduler lag 12 s");
  assertEquals(redactString("to x@y.org"), "to [email]");
});
