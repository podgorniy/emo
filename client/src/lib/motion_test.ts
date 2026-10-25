// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §5.1: the motion tokens exist twice, as CSS in
 * `boot.css` and as numbers and curves in `motion.ts`; they must say the
 * same thing, and the reduced-motion block must zero every duration.
 */
import { assert, assertEquals } from "@std/assert";
import {
  DUR,
  EASE,
  motionOK,
  SPRING_LINEAR,
  SPRING_SOFT_LINEAR,
} from "./motion.ts";

const css = await Deno.readTextFile(new URL("../boot.css", import.meta.url));

/** A curve with whitespace and leading zeros normalised away */
const norm = (s: string) =>
  s.replace(/\s+/g, "").replace(/(^|[^\d])0\./g, "$1.");

/** Every value of `--name` in the file, in order */
function values(name: string): string[] {
  const re = new RegExp(`${name}:\\s*([^;]+);`, "g");
  return [...css.matchAll(re)].map((m) => m[1].trim());
}

Deno.test("motion - the durations in boot.css are DUR, and 0 under reduced motion", () => {
  const names: Array<[string, number]> = [
    ["--dur-1", DUR[1]],
    ["--dur-2", DUR[2]],
    ["--dur-3", DUR[3]],
    ["--dur-4", DUR[4]],
    ["--dur-5", DUR[5]],
    ["--dur-spring", DUR.spring],
    ["--dur-spring-soft", DUR.springSoft],
  ];
  for (const [name, ms] of names) {
    assertEquals(values(name), [`${ms}ms`, "0ms"], name);
  }
});

Deno.test("motion - the curves in boot.css are EASE", () => {
  const pairs: Array<[string, string]> = [
    ["--ease-standard", EASE.standard],
    ["--ease-out", EASE.out],
    ["--ease-in", EASE.in],
    ["--ease-in-out", EASE.inOut],
    ["--ease-emphasized", EASE.emphasized],
  ];
  for (const [name, curve] of pairs) {
    assertEquals(values(name).map(norm), [norm(curve)], name);
  }
  // The springs: a back-out fallback, then linear() where it is supported
  const spring = values("--ease-spring").map(norm);
  assertEquals(spring.length, 2);
  assertEquals(spring[1], norm(SPRING_LINEAR));
  const soft = values("--ease-spring-soft").map(norm);
  assertEquals(soft.length, 2);
  assertEquals(soft[1], norm(SPRING_SOFT_LINEAR));
  // Without CSS (here) EASE falls back to the cubic-bezier versions
  assertEquals(norm(EASE.spring), spring[0]);
  assertEquals(norm(EASE.springSoft), soft[0]);
});

Deno.test("motion - nothing moves where the reduced-motion query cannot be read", () => {
  assert(!motionOK());
});
