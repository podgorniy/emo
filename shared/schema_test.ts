// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import {
  array,
  bool,
  both,
  int,
  is,
  lit,
  nullable,
  object,
  optional,
  str,
} from "./schema.ts";

const item = object({
  id: str,
  n: int,
  tag: optional(lit("a", "b")),
  at: nullable(str),
});
const page = both(object({ items: array(item) }), object({ more: bool }));

Deno.test("schema - accepts the shape and ignores unknown fields", () => {
  const ok = {
    items: [{ id: "x", n: 1, at: null }, { id: "y", n: 2, tag: "b", at: "t" }],
    more: false,
    extra: "newer server",
  };
  assertEquals(page.check(ok), null);
  assertEquals(is(page, ok), true);
});

Deno.test("schema - names the first wrong field", () => {
  const cases: Array<[unknown, string]> = [
    [null, "body: expected an object"],
    [{ items: {}, more: true }, "body.items: expected an array"],
    [
      { items: [{ id: "x", n: 1.5, at: null }], more: true },
      "body.items[0].n: expected an integer",
    ],
    [
      { items: [{ id: "x", n: 1, tag: "c", at: null }], more: true },
      'body.items[0].tag: expected "a" | "b"',
    ],
    [
      { items: [{ id: "x", n: 1 }], more: true },
      "body.items[0].at: expected a string",
    ],
    [{ items: [] }, "body.more: expected true or false"],
  ];
  for (const [value, problem] of cases) {
    assertEquals(page.check(value), problem);
  }
});
