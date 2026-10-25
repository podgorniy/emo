// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ui.md §3: Now is the mark's nest with a core that holds the
 * label. Its curl turns so the core points where it is aimed (a cursor, a
 * finger, a tilt) and sinks as deep as the aim is long; however far, every
 * disc keeps a rim of the one before. A cursor on Now centres the core; one
 * farther away takes it further out, smoothly. At rest it sinks the mark's
 * way, shallower. A tilt reads as gravity across the screen, turned with it.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { MARK_DISCS, nestDiscs, type Vec } from "../../../shared/brand.ts";
import {
  BEAD_LAYERS,
  BEAD_RATIO,
  BEAD_REST_AIM,
  BEAD_SPAN,
  beadCurl,
  beadPose,
  cursorAim,
  screenGravity,
} from "./bead.ts";

const core = (aim: Vec) =>
  nestDiscs(BEAD_LAYERS, BEAD_RATIO, 1, beadCurl(aim)).at(-1)!;
const far = (v: Vec) => Math.hypot(v.x, v.y);

const AIMS = [
  { x: 0, y: 0 },
  { x: 0, y: -0.4 },
  { x: 0.9, y: 0 },
  { x: -2, y: -2 },
  { x: 0.3, y: 5 },
  BEAD_REST_AIM,
];

Deno.test("bead - every disc keeps a rim of the one before, however it is aimed", () => {
  for (const aim of AIMS) {
    const discs = nestDiscs(BEAD_LAYERS, BEAD_RATIO, 104, beadCurl(aim));
    for (let i = 1; i < discs.length; i++) {
      const [o, d] = [discs[i - 1], discs[i]];
      const rim = o.r - d.r - Math.hypot(d.cx - o.cx, d.cy - o.cy);
      assert(rim > 0.5, `aim ${JSON.stringify(aim)}: disc ${i} rim ${rim}`);
    }
  }
});

Deno.test("bead - the core holds the label: over half of Now across", () => {
  const c = nestDiscs(BEAD_LAYERS, BEAD_RATIO, 1).at(-1)!;
  assert(c.r > 0.5, `${c.r}`);
});

Deno.test("bead - the core points where it is aimed, as far as the aim is long", () => {
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg * Math.PI) / 180;
    const aim = { x: 0.5 * Math.cos(rad), y: 0.5 * Math.sin(rad) };
    const c = core(aim);
    assertAlmostEquals(c.cx, aim.x * BEAD_SPAN, 1e-9, `${deg}°`);
    assertAlmostEquals(c.cy, aim.y * BEAD_SPAN, 1e-9, `${deg}°`);
  }
  // No aim: every disc centred
  const flat = core({ x: 0, y: 0 });
  assertAlmostEquals(Math.hypot(flat.cx, flat.cy), 0, 1e-12);
});

Deno.test("bead - at rest it sinks and curls the mark's way, less deep than the mark", () => {
  const pose = beadPose();
  assertEquals(pose.length, BEAD_LAYERS - 1);
  // Each disc lower than the one before; the curl turns them to the left
  for (const [, y] of pose) assert(y > 0);
  assert(pose[0][0] > 0 && pose.at(-1)![0] < 0);
  // The cores' distances from centre, as shares of the outer radius
  const rest = core(BEAD_REST_AIM);
  const m = MARK_DISCS.at(-1)!;
  const mark = Math.hypot(m.cx - 50, m.cy - 50) / MARK_DISCS[0].r;
  assert(Math.hypot(rest.cx, rest.cy) < 0.7 * mark);
});

Deno.test("bead - a cursor: centred on Now, toward it and further out as it goes away", () => {
  assertEquals(cursorAim(0, 0), { x: 0, y: 0 });
  let was = 0;
  for (const d of [0.25, 0.5, 1, 2, 4, 10]) {
    const a = cursorAim(-d * 0.6, -d * 0.8);
    assert(far(a) > was && far(a) <= 0.9, `${d}: ${far(a)}`);
    assertAlmostEquals(Math.atan2(a.y, a.x), Math.atan2(-0.8, -0.6), 1e-9);
    was = far(a);
  }
  // On Now's rim the core is well on its way, never pinned at the edge
  const rim = far(cursorAim(1, 0));
  assert(rim > 0.4 && rim < 0.7, `${rim}`);
});

Deno.test("bead - a tilt is gravity across the screen, turned with it", () => {
  const near = (a: Vec, x: number, y: number) => {
    assertAlmostEquals(a.x, x, 1e-9);
    assertAlmostEquals(a.y, y, 1e-9);
  };
  // Upright: straight down the screen; flat: nothing across it
  near(screenGravity(90, 0), 0, 1);
  near(screenGravity(0, 0), 0, 0);
  // Flat, the right edge lowered: toward the right
  near(screenGravity(0, 30), 0.5, 0);
  // Upright and turned to landscape (the top edge to the left): down the
  // screen is still down
  near(screenGravity(0, -90, 90), 0, 1);
});
