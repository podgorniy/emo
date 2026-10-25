// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The body figure's geometry (ui.md §7.2, viewBox `0 0 260 520`),
 * shared by the check-in's body map (`BodyMap.svelte`) and the read-only
 * figure of a past check-in (`history/BodyGlyph.svelte`), so both draw the
 * same silhouette and the same zones.
 *
 * The silhouette is one closed path: a neutral standing figure about seven
 * heads tall, drawn as its left half (crown → crotch, cubic Béziers) and
 * mirrored around x = 130. Same outline front and back but for the base of
 * the head (a chin, or the round back of the skull) and the feet (a forefoot
 * turned slightly out, or the narrower heel). No face.
 *
 * The zones are shapes too, and their borders are the body's own lines: the
 * collarbones, the edge of the ribcage, the hip creases; from behind the line
 * of the shoulders and the folds under the seat. Between an arm and the torso
 * a zone ends in the gap that separates them (`GAP`), so it never paints a
 * sliver of the neighbour.
 */

export type Rect = [number, number, number, number];
export type View = "front" | "back";

type Pt = [number, number];
/** A line to a point, or a cubic segment: control 1, control 2, end point. */
type Seg = Pt | [number, number, number, number, number, number];
/** An open run of segments from a start point. */
interface Run {
  from: Pt;
  segs: Seg[];
}

const run = (from: Pt, ...segs: Seg[]): Run => ({ from, segs });
const end = (s: Seg): Pt => s.length === 2 ? s : [s[4], s[5]];
const last = (r: Run): Pt =>
  r.segs.length ? end(r.segs[r.segs.length - 1]) : r.from;

/** The same run, end to start. */
function rev(r: Run): Run {
  const segs: Seg[] = [];
  for (let i = r.segs.length - 1; i >= 0; i--) {
    const s = r.segs[i];
    const [px, py] = i > 0 ? end(r.segs[i - 1]) : r.from;
    segs.push(s.length === 2 ? [px, py] : [s[2], s[3], s[0], s[1], px, py]);
  }
  return { from: last(r), segs };
}

/** Mirrored around the body's axis, x = 130. */
const m = (x: number) => 260 - x;
function mir(r: Run): Run {
  return {
    from: [m(r.from[0]), r.from[1]],
    segs: r.segs.map((s): Seg =>
      s.length === 2
        ? [m(s[0]), s[1]]
        : [m(s[0]), s[1], m(s[2]), s[3], m(s[4]), s[5]]
    ),
  };
}

const num = (v: number) => +v.toFixed(2);

/** SVG path data: the runs end to end, a line bridging any gap; `Z` if closed. */
function d(runs: Run[], close: boolean): string {
  let out = "";
  let at: Pt | null = null;
  for (const r of runs) {
    if (!at) out += `M${num(r.from[0])} ${num(r.from[1])}`;
    else if (at[0] !== r.from[0] || at[1] !== r.from[1]) {
      out += ` L${num(r.from[0])} ${num(r.from[1])}`;
    }
    for (const s of r.segs) {
      out += `${s.length === 2 ? " L" : " C"}${s.map(num).join(" ")}`;
    }
    at = last(r);
  }
  return close ? out + " Z" : out;
}

/** A closed shape symmetric about the axis, from its left half: axis top → axis bottom. */
const sym = (...half: Run[]) =>
  d([...half, ...half.map(mir).map(rev).reverse()], true);
/** A closed shape on the left and its mirror on the right, as two subpaths. */
const pair = (...left: Run[]) => `${d(left, true)} ${d(left.map(mir), true)}`;
/** A line drawn from the left edge to the axis, and on to the right as its mirror. */
const across = (...half: Run[]) =>
  d([...half, ...half.map(mir).map(rev).reverse()], false);
/** A line on the left and its mirror. */
const both = (...left: Run[]) => [d(left, false), d(left.map(mir), false)];

/** The head, crown to the base of the neck: a chin from the front, a round occiput from behind. */
const HEAD: Record<View, Seg[]> = {
  front: [
    // crown to the widest point of the head, down to the ear
    [114, 4, 100, 16, 99, 34],
    [99, 36, 99, 39, 99, 42],
    // ear
    [95, 41, 93, 50, 96, 57],
    [97, 59, 99, 59, 100, 58],
    // jaw to the neck, neck
    [103, 68, 109, 77, 115, 80],
    [116, 86, 115, 92, 114, 98],
  ],
  back: [
    [114, 4, 100, 16, 99, 34],
    [99, 36, 99, 39, 99, 42],
    [95, 41, 93, 50, 96, 57],
    [97, 59, 99, 59, 100, 58],
    // the skull rounds into the neck: no jaw
    [102, 68, 107, 80, 114, 86],
    [115, 90, 115, 94, 114, 98],
  ],
};

/**
 * Base of the neck to the ankle; the right half is its mirror. Landmarks at
 * natural proportions: elbow at the waist (y 200), wrist just above the
 * crotch (y 280), fingertips at mid-thigh, knee y 374, ankle y 488.
 */
const BODY: Seg[] = [
  // trapezius, sloping, into a rounded shoulder; the deltoid down from it
  [104, 99.5, 86, 102.5, 75, 106.5],
  [64, 110, 59, 118, 58, 131],
  // upper arm (outer) to the elbow, forearm to the wrist
  [57, 150, 55.5, 174, 54.5, 196],
  [53.5, 216, 51.5, 244, 50, 266],
  // a relaxed hand, back to the front: the little-finger edge, the fingers
  // together, the index finger's inner edge …
  [48.5, 273, 46.5, 282, 46, 292],
  [45.5, 304, 48, 317, 53, 321.5],
  [56, 324, 60, 323.5, 62, 320],
  [63.5, 316, 64, 306, 64, 298],
  // … and the thumb toward the thigh, back to the inner wrist
  [65.5, 300, 67.5, 304, 69.5, 306.5],
  [71.5, 308.5, 74, 307, 73.5, 303.5],
  [73, 297, 71.5, 286, 69, 276],
  [68.5, 273, 68, 270.5, 68, 268],
  // forearm (inner) to the elbow, upper arm to the armpit: clear of the torso
  [70, 250, 74, 226, 77, 201],
  [79, 182, 81.5, 160, 83.5, 144],
  [84, 141, 85.5, 140, 86.5, 142],
  // ribs to the waist, waist to the hip
  [87, 160, 89.5, 182, 90, 200],
  [90.5, 216, 82.5, 232, 81.5, 250],
  // hip to the thigh, thigh to the knee
  [81, 262, 82, 276, 84, 292],
  [86, 316, 90, 346, 95, 374],
  // the calf swells below the knee, then tapers to the ankle
  [93.5, 388, 92.5, 402, 93.5, 416],
  [96, 440, 104.5, 468, 105, 488],
];

/** The foot, ankle to ankle: a forefoot turned slightly out from the front, the heel from behind. */
const FOOT: Record<View, Seg[]> = {
  front: [
    [104, 496, 100.5, 503, 99, 508.5],
    // outer toes, the toes' line, the big toe, the inner foot
    [97.5, 513.5, 101, 516.5, 107, 516.5],
    [114, 516.5, 121, 516, 125, 513.5],
    [127.5, 511.5, 127, 506, 125, 500],
    [123.5, 495, 122.5, 491.5, 122.5, 488],
  ],
  back: [
    // the heel, narrower: no toes
    [105.5, 496, 104, 503, 105, 509],
    [106, 514, 109.5, 516, 114, 516],
    [118.5, 516, 122, 514, 123, 509],
    [124, 503, 123, 495, 122.5, 488],
  ],
};

const LOWER: Seg[] = [
  // inner calf to the knee, inner thigh to the crotch (a rounded arch)
  [122.5, 470, 125, 446, 125.5, 424],
  [126, 408, 123.5, 392, 122, 376],
  [121.5, 356, 123.5, 326, 126, 304],
  [126.8, 292, 127.6, 280.5, 130, 280],
];

/** The silhouette per view, as an SVG path: the same but for the head's base and the feet. */
export const PATH: Record<View, string> = {
  front: sym(run([130, 4], ...HEAD.front, ...BODY, ...FOOT.front, ...LOWER)),
  back: sym(run([130, 4], ...HEAD.back, ...BODY, ...FOOT.back, ...LOWER)),
};

/**
 * The left gap between the body's parts, top to bottom: from the armpit
 * between the arm and the torso, then between the hand and the thigh. A zone
 * that stops at the side of the torso ends here, out of the silhouette.
 */
const GAP: Pt[] = [
  [85, 140.5],
  [84.5, 160],
  [83.5, 200],
  [79.5, 230],
  [76, 250],
  [75, 268],
  [77.5, 285],
  [79.5, 305],
  [80, 335],
];

function gapX(y: number): number {
  for (let i = 1; i < GAP.length; i++) {
    const [x0, y0] = GAP[i - 1];
    const [x1, y1] = GAP[i];
    if (y <= y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  return GAP[GAP.length - 1][0];
}

const onGap = (y: number): Pt => [gapX(y), y];
/** The gap from one height to another, as a run. */
const gap = (y0: number, y1: number) =>
  run(onGap(y0), ...GAP.filter(([, y]) => y > y0 && y < y1), onGap(y1));

// Borders shared by the front and the back
/** The deltoid's lower edge, armpit → across the upper arm (and on, out of the figure) */
const DELTOID = run([85, 140.5], [78, 143.5, 66, 146.5, 57, 147.2], [30, 150]);
/** The waist, side → axis, sagging a little as it wraps the body */
const WAIST = run(onGap(199), [90, 199], [103, 201.5, 117, 202.5, 130, 202.5]);
/** Below the arms everything is legs; the arm's region ends here */
const FLOOR = run([80, 335], [0, 335], [0, 520], [130, 520]);

// Front borders, axis → side or side → axis
/** The forehead from the face: wraps the head, ear to ear (the whole width) */
const BROW = run([80, 34.28], [113.33, 52.57, 146.67, 52.57, 180, 34.28]);
/** The collarbone from the notch at the base of the throat to the neck's side … */
const CLAV_IN = run(
  [130, 112],
  [127.5, 112, 125, 110.6, 122, 109.6],
  [119.5, 108.8, 116.8, 108.4, 114, 108.2],
);
/** … and out toward the shoulder */
const CLAV_OUT = run([114, 108.2], [107, 107.7, 99, 107.6, 94, 108.6]);
/** Collarbone → armpit, between the chest and the shoulder's cap (not drawn) */
const CAP = run([94, 108.6], [85, 140.5]);
/** The edge of the ribcage: side at the waist → the end of the breastbone */
const RIBS = run(onGap(199), [90, 199], [91, 182, 117, 166, 130, 160]);
/** Belly → lower belly */
const BELLY = run(onGap(238), [83, 238], [98, 241, 115, 242, 130, 242]);
/** The hip crease, side → crotch; drawn only its inner part, short of the crotch */
const GROIN = run(
  onGap(256),
  [81.5, 256],
  [92, 260.5, 108, 268, 120, 274.6],
  [123.6, 276.6, 127, 278.4, 130, 280],
);

// Back borders
/** The line of the shoulders, from the base of the neck (axis) to the neck's side … */
const YOKE_IN = run([130, 116], [124.5, 116, 119, 116.8, 114, 118.4]);
/** … and down to the armpit */
const YOKE_OUT = run([114, 118.4], [104, 121.5, 92, 129, 85, 140.5]);
/** The seat from the thigh: the hip's side, down the seat's edge (not drawn), the fold under it */
const SEAT = run(
  onGap(256),
  [81.5, 256],
  [86, 266, 92, 277, 97, 283],
  [100, 288, 112, 291, 126, 290],
  [130, 290],
);

/** The shoulder's cap and the slope above the collarbone (front) or the line of the shoulders (back) */
const SHOULDERS: Record<View, string> = {
  front: pair(
    run([114, 92], [114, 108.2]),
    CLAV_OUT,
    CAP,
    DELTOID,
    run([30, 150], [30, 92]),
  ),
  back: pair(
    run([114, 92], [114, 118.4]),
    YOKE_OUT,
    DELTOID,
    run([30, 150], [30, 92]),
  ),
};
/** The arms with the hands, from under the shoulder's cap, beside the torso */
const ARMS = pair(rev(DELTOID), gap(140.5, 335), run([80, 335], [10, 335]));

/** Zone shapes (fill, clipped to the silhouette) per view. */
export const BANDS: Record<View, Record<string, string>> = {
  front: {
    forehead_eyes: d([run([80, 0], [180, 0], [180, 34.28]), rev(BROW)], true),
    jaw: d([BROW, run([180, 34.28], [180, 80], [80, 80])], true),
    // The neck down to the notch between the collarbones
    throat: sym(
      run([130, 80], [100, 80], [100, 98], [114, 98], [114, 108.2]),
      rev(CLAV_IN),
    ),
    shoulders: SHOULDERS.front,
    chest: sym(CLAV_IN, CLAV_OUT, CAP, gap(140.5, 199), RIBS),
    // Under the ribcage's arch, above the waist
    solar_plexus: sym(rev(RIBS), WAIST),
    belly: sym(rev(WAIST), gap(199, 238), BELLY),
    lower_belly: sym(rev(BELLY), gap(238, 256), GROIN),
    arms_hands: ARMS,
    legs_feet: sym(rev(GROIN), gap(256, 335), FLOOR),
  },
  back: {
    // The whole head from behind (2026-10-09, UX-25)
    head_back: d([run([80, 0], [180, 0], [180, 85], [80, 85])], true),
    neck: sym(
      run([130, 85], [100, 85], [100, 98], [114, 98], [114, 118.4]),
      rev(YOKE_IN),
    ),
    shoulders: SHOULDERS.back,
    upper_back: sym(YOKE_IN, YOKE_OUT, gap(140.5, 199), WAIST),
    // Down to the folds under the seat: the seat is part of the lower back
    lower_back: sym(rev(WAIST), gap(199, 256), SEAT),
    arms_hands: ARMS,
    legs_feet: sym(rev(SEAT), gap(256, 335), FLOOR),
  },
};

/**
 * The zones' borders that are drawn (SVG path data, clipped to the
 * silhouette): each is a line of the body. Where a border runs through the
 * solid shoulder (collarbone → armpit) or the side of the seat, only the fill
 * shows it.
 */
export const SEAMS: Record<View, string[]> = {
  front: [
    // ear to ear, inside the ears
    "M103 44 Q130 52 157 44",
    // the collarbones, through the notch; each stops short of the shoulder
    across(rev(CLAV_OUT), rev(CLAV_IN)),
    ...both(DELTOID),
    across(RIBS),
    across(WAIST),
    across(BELLY),
    ...both(run([103, 266.5], [109, 269.4, 115, 272.2, 120, 274.6])),
  ],
  back: [
    // the line of the shoulders, one curve from arm to arm
    across(rev(DELTOID), rev(YOKE_OUT), rev(YOKE_IN)),
    across(WAIST),
    // the fold under each side of the seat, from the gap between the legs
    ...both(run([126, 290], [112, 291, 100, 288, 97, 283])),
  ],
};

/**
 * Interior marks (SVG path data): the body's curvatures, never a face, and
 * never touching a border. Front: the belly button, the lower edge of each
 * kneecap, the fingers' parting, the toes. Back: the hairline at the nape,
 * the spine, the cleft of the seat, the crease behind each knee, the
 * Achilles tendons.
 */
export const DETAILS: Record<View, string[]> = {
  front: [
    "M130 211.6 L130 216.4",
    "M104 379 q4.5 3.5 9 0",
    "M147 379 q4.5 3.5 9 0",
  ],
  back: [
    "M130 92 L130 111",
    "M130 121 L130 198",
    "M130 207 L130 248",
    "M130 261 L130 275",
    "M101 379 q7.5 2.5 15 0",
    "M144 379 q7.5 2.5 15 0",
    ...both(run([110, 468], [111.6, 478, 111.6, 488, 110.6, 498])),
    ...both(run([117.6, 468], [116, 478, 116, 488, 117, 498])),
  ],
};

/**
 * Hit targets: real buttons over the zones (`BodyMap.svelte`). A zone's first
 * is ≥ 44 units tall (≥ 44 px at 1×) and the one assistive technology sees;
 * the others, aria-hidden, follow the zone's curved borders more closely and
 * sit under it. Where two zones' targets overlap the later zone wins, never
 * over another zone's centre (bodyFigure_test.ts).
 */
export const HITS: Record<View, Array<[string, Rect[]]>> = {
  front: [
    ["forehead_eyes", [[96, 0, 68, 46]]],
    ["jaw", [[96, 46, 68, 44]]],
    ["shoulders", [[8, 96, 103, 48], [149, 96, 103, 48]]],
    ["throat", [[111, 80, 38, 44]]],
    // Under the collarbones; down the sides of the ribcage's arch
    ["chest", [[90, 110, 80, 50], [84, 160, 28, 16], [148, 160, 28, 16], [
      84,
      176,
      16,
      12,
    ], [160, 176, 16, 12]]],
    ["solar_plexus", [[112, 160, 36, 44], [100, 176, 60, 28], [
      92,
      188,
      76,
      16,
    ]]],
    ["belly", [[84, 202, 92, 44]]],
    ["lower_belly", [[82, 240, 96, 44]]],
    ["arms_hands", [[6, 144, 76, 184], [178, 144, 76, 184]]],
    // From the crotch down, and the hips below the hip creases
    ["legs_feet", [
      [80, 284, 50, 236],
      [130, 284, 50, 236],
      [76, 258, 24, 26],
      [160, 258, 24, 26],
      [100, 268, 14, 16],
      [146, 268, 14, 16],
    ]],
  ],
  back: [
    ["head_back", [[96, 0, 68, 85]]],
    ["shoulders", [[8, 96, 104, 48], [148, 96, 104, 48]]],
    ["neck", [[112, 85, 36, 44]]],
    // Under the line of the shoulders, which falls toward the armpits
    ["upper_back", [[104, 122, 52, 80], [92, 130, 76, 72], [86, 138, 88, 64]]],
    ["lower_back", [[80, 202, 100, 88]]],
    ["arms_hands", [[6, 144, 76, 184], [178, 144, 76, 184]]],
    ["legs_feet", [[80, 290, 50, 230], [130, 290, 50, 230], [80, 272, 12, 18], [
      168,
      272,
      12,
      18,
    ]]],
  ],
};

/** The order zones are listed in, wherever they are spelled out (ui.md §7.5). */
export const ZONE_ORDER = [
  "forehead_eyes",
  "jaw",
  "head_back",
  "throat",
  "neck",
  "shoulders",
  "chest",
  "solar_plexus",
  "belly",
  "lower_belly",
  "upper_back",
  "lower_back",
  "arms_hands",
  "legs_feet",
];
