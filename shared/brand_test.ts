// SPDX-License-Identifier: AGPL-3.0-or-later
import { assert, assertEquals } from "@std/assert";
import { MARK_ALPHA, MARK_DISCS, MARK_LIFT, MARK_RADIUS } from "./brand.ts";

Deno.test("brand - each disc rests inside the one before it, never touching", () => {
  assertEquals(MARK_DISCS[0], { cx: 50, cy: 50, r: MARK_RADIUS });
  for (let i = 1; i < MARK_DISCS.length; i++) {
    const [o, d] = [MARK_DISCS[i - 1], MARK_DISCS[i]];
    const apart = Math.hypot(d.cx - o.cx, d.cy - o.cy);
    // A rim of the outer disc stays visible all round
    assert(apart + d.r < o.r - 0.1, `disc ${i} leaves disc ${i - 1}`);
    assert(d.cy > o.cy, `disc ${i} rests lower than disc ${i - 1}`);
  }
});

Deno.test("brand - the layers deepen toward the core and stay translucent", () => {
  const core = 1 - (1 - MARK_ALPHA) ** (MARK_DISCS.length - 1);
  assert(MARK_ALPHA > 0.15 && core < 0.9, `${MARK_ALPHA} stacks to ${core}`);
});

Deno.test("brand - a lifted mark stays inside the maskable safe zone", () => {
  // gen_icons.ts draws the maskable icon with the outer radius 30 % of it;
  // Android may crop to a circle 80 % across
  const scale = 0.3 / MARK_RADIUS;
  for (const d of MARK_DISCS) {
    const x = (d.cx - 50 + MARK_LIFT.dx) * scale;
    const y = (d.cy - 50 + MARK_LIFT.dy) * scale;
    assert(Math.hypot(x, y) + d.r * scale < 0.4);
  }
});
