// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Emo mark (ui.md §16.2): six discs of the one highlight
 * colour (principle 7), each a little smaller than the last and resting a
 * little lower inside it, like sheets of thin paper laid one on another. The
 * place where each one rests turns a little further round, so the layers curl
 * gently in toward the core: attention settling into the body. The five outer
 * discs are translucent, so the tone deepens toward the core on any ground and
 * in any theme; the core is opaque. No face, heart, emoji or warm colour
 * (principle 6).
 *
 * Geometry in a 100 × 100 box: the outer disc is centred on (50, 50) with
 * radius 34. `tools/gen_icons.ts` draws every icon from it; the app draws it
 * with `components/common/Mark.svelte`, and Home's Now is the same nest with
 * a larger core, its curl turned toward a cursor, a finger or a tilt
 * (`nestCurl`, `client/src/lib/bead.ts`).
 */

export interface Disc {
  cx: number;
  cy: number;
  r: number;
}

/** A direction and a distance across a nest */
export interface Vec {
  x: number;
  y: number;
}

/** Discs, the outer one first */
const LAYERS = 6;
/** Each disc's radius as a share of the one it rests in */
const RATIO = 0.77;
/** Where the second disc rests, in degrees clockwise from 3 o'clock */
const FIRST = 80;
/** How much further round each next disc rests, in degrees */
const TURN = 24;
/** How far down each disc sinks, as a share of touching its outer disc */
const SINK = 0.9;
/** The farthest a disc may rest from centre: a rim of the one before shows */
export const NEST_REACH = 0.92;

/** Opacity of each disc but the core */
export const MARK_ALPHA = 0.26;

/** Outer disc's radius in the 100 × 100 box */
export const MARK_RADIUS = 34;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The curl: where each disc but the outer one rests in the one before it, as
 * a share of its room (how far it could move from that disc's centre). The
 * nest sinks toward `fall` (degrees clockwise from 3 o'clock; the mark's is
 * 90, straight down) by `depth` (the mark's: 0.9), and each disc rests a
 * further 24° round, so the layers curl in toward the core.
 */
export function nestCurl(
  layers: number,
  fall = 90,
  depth = SINK,
): Vec[] {
  const d = Math.max(0, Math.min(depth, NEST_REACH));
  return Array.from({ length: layers - 1 }, (_, i) => {
    const a = ((fall + FIRST - 90 + TURN * i) * Math.PI) / 180;
    return { x: d * Math.cos(a), y: d * Math.sin(a) };
  });
}

/**
 * `layers` discs nested the mark's way, the outer one centred on (0, 0) with
 * `radius`, each `ratio` of the one before; disc i + 1 rests in disc i at
 * `rests[i]` (`nestCurl`; the mark's by default), never past `NEST_REACH`.
 */
export function nestDiscs(
  layers: number,
  ratio: number,
  radius: number,
  rests: readonly Vec[] = nestCurl(layers),
): Disc[] {
  const out: Disc[] = [];
  let cx = 0;
  let cy = 0;
  let r = radius;
  for (let i = 0; i < layers; i++) {
    out.push({ cx, cy, r });
    const next = r * ratio;
    let { x, y } = rests[i] ?? { x: 0, y: 0 };
    const far = Math.hypot(x, y);
    if (far > NEST_REACH) {
      [x, y] = [(x / far) * NEST_REACH, (y / far) * NEST_REACH];
    }
    cx += (r - next) * x;
    cy += (r - next) * y;
    r = next;
  }
  return out;
}

export const MARK_DISCS: readonly Disc[] = nestDiscs(
  LAYERS,
  RATIO,
  MARK_RADIUS,
).map((d) => ({ cx: round(50 + d.cx), cy: round(50 + d.cy), r: round(d.r) }));

/**
 * Where an icon puts the mark, in box units: its weight is low and to the
 * left, in the core, so on a square it sits a little up and right of centre
 * to look centred.
 */
export const MARK_LIFT = { dx: 1.5, dy: -3.5 };

/** The mark alone, cropped to its outer disc */
export const MARK_VIEWBOX = `${50 - MARK_RADIUS} ${50 - MARK_RADIUS} ${
  2 * MARK_RADIUS
} ${2 * MARK_RADIUS}`;
