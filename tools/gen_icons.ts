// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Writes the app icons of ui.md §16.2 into client/public, and the
 * 1024 master into design/: the Emo mark of shared/brand.ts — six discs of the
 * one highlight colour, translucent but for the core — on the Calm ground
 * #E4EDF1; periwinkle on the Dusk ground where an SVG follows a dark system
 * setting. No face, heart, emoji or warm colour. Pure Deno, no image
 * libraries: every pixel is 6×6 samples, each composited front to back, and
 * encoded as PNG.
 *
 *   deno run -A tools/gen_icons.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARK_ALPHA,
  MARK_DISCS,
  MARK_LIFT,
  MARK_RADIUS,
  MARK_VIEWBOX,
} from "../shared/brand.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "client/public");

type RGBA = [number, number, number, number];
const rgba = (hex: string): RGBA => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  255,
];

/** Calm ground and the light highlight; Dusk ground and the dark one */
const LIGHT = { ground: "#E4EDF1", mark: "#4F46E5" };
const DARK = { ground: "#14172B", mark: "#8EA2FF" };
const WHITE: RGBA = [255, 255, 255, 255];

interface Spec {
  size: number;
  /** The mark's outer radius as a share of the size; lifted (MARK_LIFT) */
  mark: number;
  /** Corner radius of the ground as a share of the size; null = no ground */
  corner: number | null;
  colour: RGBA;
  /** Opacity of each disc but the core */
  alpha: number;
}

/** The ground and the discs, front to back, averaged over 6×6 samples. */
function render({ size, mark, corner, colour, alpha }: Spec): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const ground = rgba(LIGHT.ground);
  const scale = (mark * size) / MARK_RADIUS;
  const discs = MARK_DISCS.map((d, i) => ({
    x: size / 2 + (d.cx - 50 + MARK_LIFT.dx) * scale,
    y: size / 2 + (d.cy - 50 + MARK_LIFT.dy) * scale,
    r2: (d.r * scale) ** 2,
    a: i === MARK_DISCS.length - 1 ? 1 : alpha,
  }));
  const cr = (corner ?? 0) * size;
  const inGround = (x: number, y: number) => {
    if (corner === null) return false;
    const dx = Math.max(cr - x, 0, x - (size - cr));
    const dy = Math.max(cr - y, 0, y - (size - cr));
    return dx * dx + dy * dy <= cr * cr;
  };
  const S = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Premultiplied sums over the samples
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S;
          const fy = y + (sy + 0.5) / S;
          const c = [0, 0, 0, 0];
          const over = (col: RGBA, a: number) => {
            for (let k = 0; k < 3; k++) c[k] = col[k] * a + c[k] * (1 - a);
            c[3] = a + c[3] * (1 - a);
          };
          if (inGround(fx, fy)) over(ground, 1);
          for (const d of discs) {
            if ((fx - d.x) ** 2 + (fy - d.y) ** 2 <= d.r2) over(colour, d.a);
          }
          for (let k = 0; k < 4; k++) sum[k] += c[k];
        }
      }
      const a = sum[3] / (S * S);
      if (a > 0) {
        const out: RGBA = [0, 0, 0, Math.round(a * 255)];
        for (let k = 0; k < 3; k++) out[k] = Math.round(sum[k] / sum[3]);
        px.set(out, (y * size + x) * 4);
      }
    }
  }
  return px;
}

const fix = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The mark as SVG markup in a 100 × 100 box, its outer radius `mark` × 100,
 * lifted (MARK_LIFT) on a ground; class `m` takes the highlight colour.
 */
function discsSvg(mark: number, lift: boolean): string {
  const scale = (mark * 100) / MARK_RADIUS;
  const at = (v: number, by: number) =>
    fix(50 + (v - 50 + (lift ? by : 0)) * scale);
  const circle = (i: number) => {
    const d = MARK_DISCS[i];
    return `<circle cx="${at(d.cx, MARK_LIFT.dx)}" cy="${
      at(d.cy, MARK_LIFT.dy)
    }" r="${fix(d.r * scale)}" />`;
  };
  const last = MARK_DISCS.length - 1;
  const outer = MARK_DISCS.slice(0, last).map((_, i) => `    ${circle(i)}`);
  return [
    `  <g class="m" fill-opacity="${MARK_ALPHA}">`,
    ...outer,
    `  </g>`,
    `  <g class="m">`,
    `    ${circle(last)}`,
    `  </g>`,
  ].join("\n");
}

/**
 * Light colours, dark ones when the system is dark (unless `fixed`); laid out
 * as `deno fmt` lays it out, so `make fmt-check` passes on what this writes
 */
function svgStyle(ground: boolean, fixed = false): string {
  const rules = (p: typeof LIGHT, pad: string) =>
    [...(ground ? [[".g", p.ground]] : []), [".m", p.mark]].flatMap((
      [sel, fill],
    ) => [`${pad}${sel} {`, `${pad}  fill: ${fill};`, `${pad}}`]);
  return [
    "  <style>",
    ...rules(LIGHT, "  "),
    ...(fixed ? [] : [
      "  @media (prefers-color-scheme:dark) {",
      ...rules(DARK, "    "),
      "  }",
    ]),
    "  </style>",
  ].join("\n");
}

const HEADER = [
  "  <!-- SPDX-License-Identifier: AGPL-3.0-or-later -->",
  "  <!-- Generated by tools/gen_icons.ts from shared/brand.ts: do not edit. -->",
];

/** The mark on its ground, as the icons draw it */
function iconSvg(mark: number, corner: number, fixed = false): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`,
    ...HEADER,
    svgStyle(true, fixed),
    `  <rect class="g" width="100" height="100" rx="${fix(corner * 100)}" />`,
    discsSvg(mark, true),
    `</svg>`,
    "",
  ].join("\n");
}

/** The mark alone, cropped to its outer disc, for beside the name */
function markSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">`,
    ...HEADER,
    svgStyle(false),
    discsSvg(MARK_RADIUS / 100, false),
    `</svg>`,
    "",
  ].join("\n");
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream()
    .pipeThrough(
      new CompressionStream("deflate"),
    );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function png(
  size: number,
  rgba: Uint8Array,
  opaque: boolean,
): Promise<Uint8Array> {
  const channels = opaque ? 3 : 4;
  const raw = new Uint8Array(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * channels + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      for (let k = 0; k < channels; k++) {
        raw[y * (size * channels + 1) + 1 + x * channels + k] =
          rgba[(y * size + x) * 4 + k];
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlib(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A one-image ICO holding a PNG (supported by every current browser). */
function ico(size: number, pngBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(22 + pngBytes.length);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, 1, true);
  out[6] = size;
  out[7] = size;
  v.setUint16(10, 1, true);
  v.setUint16(12, 32, true);
  v.setUint32(14, pngBytes.length, true);
  v.setUint32(18, 22, true);
  out.set(pngBytes, 22);
  return out;
}

const MARK = rgba(LIGHT.mark);
const enc = new TextEncoder();
const files: Array<[string, Uint8Array]> = [];
// "any": the ground with rounded corners, the mark across 68 %
for (const size of [192, 512]) {
  files.push([
    `icon-${size}.png`,
    await png(
      size,
      render({
        size,
        mark: 0.34,
        corner: 0.22,
        colour: MARK,
        alpha: MARK_ALPHA,
      }),
      false,
    ),
  ]);
}
// Maskable: full-bleed ground, the mark across 60 %, inside the central 80 %
files.push([
  "icon-maskable-512.png",
  await png(
    512,
    render({
      size: 512,
      mark: 0.3,
      corner: 0,
      colour: MARK,
      alpha: MARK_ALPHA,
    }),
    true,
  ),
]);
// iOS: 180×180, no transparency (iOS rounds the corners itself)
files.push([
  "apple-touch-icon.png",
  await png(
    180,
    render({
      size: 180,
      mark: 0.34,
      corner: 0,
      colour: MARK,
      alpha: MARK_ALPHA,
    }),
    true,
  ),
]);
// Notification badge: white on transparent; Android keeps only the alpha, so
// the layers stay a little denser to read at status-bar size
files.push([
  "badge-96.png",
  await png(
    96,
    render({ size: 96, mark: 0.46, corner: null, colour: WHITE, alpha: 0.34 }),
    false,
  ),
]);
// Tab size: the mark a little larger, so its layers still read at 16 px
const fav32 = await png(
  32,
  render({
    size: 32,
    mark: 0.37,
    corner: 0.22,
    colour: MARK,
    alpha: MARK_ALPHA,
  }),
  false,
);
files.push(["favicon.ico", ico(32, fav32)]);
files.push(["favicon.svg", enc.encode(iconSvg(0.37, 0.22))]);
// Beside the name on the static pages (methodology.html)
files.push(["mark.svg", enc.encode(markSvg())]);

for (const [name, bytes] of files) {
  await Deno.writeFile(path.join(OUT, name), bytes);
  console.log(`${name.padEnd(24)} ${(bytes.length / 1024).toFixed(1)} KB`);
}

// The master (ui.md §16.2): full bleed, light colours only, 1024 px
const DESIGN = path.join(ROOT, "design");
await Deno.writeTextFile(
  path.join(DESIGN, "icon-master.svg"),
  iconSvg(0.34, 0, true),
);
await Deno.writeFile(
  path.join(DESIGN, "icon-master.png"),
  await png(
    1024,
    render({
      size: 1024,
      mark: 0.34,
      corner: 0,
      colour: MARK,
      alpha: MARK_ALPHA,
    }),
    true,
  ),
);
console.log("design/icon-master.svg, design/icon-master.png");
