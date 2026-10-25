// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Now as the mark (ui.md §3): six discs of the accent nested
 * the mark's way (shared/brand.ts), with a core large enough for the label.
 * The nest has an aim: where the core sits from Now's centre. The whole curl
 * turns toward it and sinks as deep as it is far, so the core points at it
 * and the layers fan out behind:
 * - a mouse anywhere on the page: the core follows the cursor, centred under
 *   it on Now and leaning further as it goes away;
 * - a press that travels more than 8 px carries the core under the finger
 *   (mouse, finger or pen), and that press does not open the check-in;
 * - on a phone that reports its tilt without asking (Android), the core rolls
 *   toward the low side and settles back as the tilt holds, like a level
 *   finding its rest in a few seconds. Where the tilt needs a permission
 *   (iPhone), it is never asked for: dragging does the same;
 * - nothing to follow (touch, the cursor off the page): it rests a little
 *   low, the mark's way but shallower, so the label sits near the middle.
 * Each layer follows on a critically damped spring, the core last, so they
 * part a moment and settle together: no bounce, no overshoot. Nothing moves
 * on its own, ever (ui.md §5.1: Now never breathes or pulses); reduced motion
 * keeps it at rest. Frames run only while a disc is settling.
 */
import { nestCurl, nestDiscs, type Vec } from "../../../shared/brand.ts";
import { motionOK } from "./motion.ts";

/** Discs in Now, the outer one first, as in the mark */
export const BEAD_LAYERS = 6;
/** Each disc's radius as a share of the one before: the core holds a label */
export const BEAD_RATIO = 0.885;
/** How deep the nest rests with nothing to follow (the mark's: 0.9) */
export const BEAD_REST = 0.6;
/** The deepest a cursor, a finger or a tilt takes it */
const DEEP = 0.9;
/** A cursor this many radii of Now away has the core 63 % of the way out */
const FOLLOW_R = 1.2;

/** A press that travels this far is a drag, not a tap, in CSS pixels */
export const DRAG_PX = 8;
/** The aim of a tilt, per unit of gravity across the screen */
const TILT_GAIN = 3.4;
/** A tilt smaller than this is a hand's tremor, in units of gravity */
const TILT_DEAD = 0.015;
/** Seconds: the tremor filter, and how long a held tilt takes to settle */
const TILT_SMOOTH_S = 0.08;
const TILT_REST_S = 2.5;
/** Rad/s: following (the core a little later) and carried */
const OMEGA = 10;
const OMEGA_HELD = 20;

const DEG = Math.PI / 180;
const polar = (deg: number, r: number): Vec => ({
  x: r * Math.cos(deg * DEG),
  y: r * Math.sin(deg * DEG),
});

/** The core of a nest sunk straight down by 0.5: how the curl turns it */
const probe = nestDiscs(
  BEAD_LAYERS,
  BEAD_RATIO,
  1,
  nestCurl(BEAD_LAYERS, 90, 0.5),
).at(-1)!;
/** Degrees from the way the nest falls to where its core ends up */
const TWIST = Math.atan2(probe.cy, probe.cx) / DEG - 90;
/** The core's distance from centre per unit of depth, in Now's radii */
export const BEAD_SPAN = Math.hypot(probe.cx, probe.cy) / 0.5;

/** The aim at rest: the mark's fall, shallower */
export const BEAD_REST_AIM = polar(90 + TWIST, BEAD_REST);

function clampAim(a: Vec, max = DEEP): Vec {
  const far = Math.hypot(a.x, a.y);
  return far > max ? { x: (a.x / far) * max, y: (a.y / far) * max } : a;
}

/**
 * Where each disc but the outer one rests in the one before (`nestCurl`)
 * for the core to sit toward `aim`, as deep as it is long (at most 0.9).
 */
export function beadCurl(aim: Vec): Vec[] {
  const a = clampAim(aim);
  const depth = Math.hypot(a.x, a.y);
  if (depth < 1e-6) return nestCurl(BEAD_LAYERS, 90, 0);
  return nestCurl(BEAD_LAYERS, Math.atan2(a.y, a.x) / DEG - TWIST, depth);
}

/**
 * The aim for a cursor (dx, dy) from Now's centre, in Now's radii: toward
 * it, nothing right over the centre, deeper as it goes away, smoothly.
 */
export function cursorAim(dx: number, dy: number): Vec {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 0 };
  const depth = DEEP * (1 - Math.exp(-d / FOLLOW_R));
  return { x: (dx / d) * depth, y: (dy / d) * depth };
}

/**
 * Where each disc but the outer one sits in the one before it, as CSS
 * `translate` percentages of its own size (`NowBead.svelte` centres each
 * disc's box in its outer disc's box). At rest by default.
 */
export function beadPose(
  rests: readonly Vec[] = beadCurl(BEAD_REST_AIM),
): Array<[number, number]> {
  const discs = nestDiscs(BEAD_LAYERS, BEAD_RATIO, 1, rests);
  return discs.slice(1).map((d, i) => {
    const o = discs[i];
    return [
      ((d.cx - o.cx) / (2 * d.r)) * 100,
      ((d.cy - o.cy) / (2 * d.r)) * 100,
    ];
  });
}

/**
 * Gravity across the screen (x right, y down; 1 = the screen upright) from a
 * `deviceorientation` reading and the screen's turn (`screen.orientation`).
 */
export function screenGravity(
  beta: number,
  gamma: number,
  angle = 0,
): Vec {
  const x = Math.cos(beta * DEG) * Math.sin(gamma * DEG);
  const y = Math.sin(beta * DEG);
  const a = angle * DEG;
  return {
    x: x * Math.cos(a) + y * Math.sin(a),
    y: -x * Math.sin(a) + y * Math.cos(a),
  };
}

interface Layer {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * The action on Now's button: its discs are the `.disc` elements inside it,
 * the outer one first (document order). A click that ends a drag is
 * swallowed before the button's own handler; a keyboard click never is.
 */
export function bead(node: HTMLElement): { destroy(): void } {
  const els = [...node.querySelectorAll<HTMLElement>(".disc")].slice(1);
  const start = beadCurl(BEAD_REST_AIM);
  const layers: Layer[] = els.map((el, i) => ({
    el,
    x: start[i].x,
    y: start[i].y,
    vx: 0,
    vy: 0,
  }));

  /** The cursor, in client pixels, while a mouse or pen is over the page */
  let cursor: { x: number; y: number } | null = null;
  let tilt: Vec = { x: 0, y: 0 };
  let held: { id: number; x: number; y: number; r: number; from: Vec } | null =
    null;
  let carry: Vec | null = null;
  let dragged = false;

  function centre(): { x: number; y: number; r: number } {
    const b = node.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, r: b.width / 2 };
  }
  function aim(): Vec {
    if (carry) return clampAim(carry);
    let base = BEAD_REST_AIM;
    if (cursor) {
      const c = centre();
      base = cursorAim((cursor.x - c.x) / c.r, (cursor.y - c.y) / c.r);
    }
    return clampAim({ x: base.x + tilt.x, y: base.y + tilt.y });
  }

  // ----- The springs -----
  let frame = 0;
  let last = 0;
  function write() {
    const pose = beadPose(layers.map((l) => ({ x: l.x, y: l.y })));
    layers.forEach((l, i) => {
      l.el.style.translate = `${pose[i][0].toFixed(2)}% ${
        pose[i][1].toFixed(2)
      }%`;
    });
  }
  function step(t: number) {
    const dt = Math.min(1 / 20, last ? (t - last) / 1000 : 1 / 60);
    last = t;
    const goal = beadCurl(aim());
    let busy = false;
    layers.forEach((l, i) => {
      // Exact for a still goal, so stable at any frame time
      const w = carry ? OMEGA_HELD : OMEGA * (1 - 0.06 * i);
      const decay = Math.exp(-w * dt);
      for (const k of ["x", "y"] as const) {
        const v = k === "x" ? "vx" : "vy";
        const e = l[k] - goal[i][k];
        const c = l[v] + w * e;
        l[k] = goal[i][k] + (e + c * dt) * decay;
        l[v] = (l[v] - w * c * dt) * decay;
        if (Math.abs(l[k] - goal[i][k]) > 0.002 || Math.abs(l[v]) > 0.01) {
          busy = true;
        }
      }
    });
    write();
    frame = busy ? requestAnimationFrame(step) : 0;
    if (!busy) last = 0;
  }
  function settle() {
    if (!motionOK()) {
      // Still: at rest, at once
      cursor = carry = null;
      tilt = { x: 0, y: 0 };
      if (layers.some((l, i) => l.x !== start[i].x || l.y !== start[i].y)) {
        layers.forEach((l, i) =>
          Object.assign(l, { x: start[i].x, y: start[i].y, vx: 0, vy: 0 })
        );
        write();
      }
      return;
    }
    if (!frame) frame = requestAnimationFrame(step);
  }

  // ----- The cursor anywhere on the page; a press that carries the core -----
  function follow(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    cursor = { x: e.clientX, y: e.clientY };
    settle();
  }
  function away() {
    cursor = null;
    settle();
  }
  function down(e: PointerEvent) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    held = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      r: centre().r,
      from: aim(),
    };
    dragged = false;
    try {
      node.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (already released): the press still works
    }
  }
  function move(e: PointerEvent) {
    if (!held || e.pointerId !== held.id) return;
    const dx = e.clientX - held.x, dy = e.clientY - held.y;
    if (!motionOK() || (!dragged && Math.hypot(dx, dy) < DRAG_PX)) return;
    dragged = true;
    // The core under the finger, as far as the layers reach
    const span = held.r * BEAD_SPAN;
    carry = { x: held.from.x + dx / span, y: held.from.y + dy / span };
    settle();
  }
  function up(e: PointerEvent) {
    if (!held || e.pointerId !== held.id) return;
    held = null;
    carry = null;
    settle();
  }
  function click(e: MouseEvent) {
    // A keyboard click has no pointer travel behind it
    if (!dragged || e.detail === 0) return;
    dragged = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // ----- The tilt, where it comes without asking -----
  type Orientation = typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<string>;
  };
  const Orientation = (globalThis as { DeviceOrientationEvent?: Orientation })
    .DeviceOrientationEvent;
  const tiltable = !!Orientation &&
    typeof Orientation.requestPermission !== "function";
  let smooth: Vec | null = null;
  let level: Vec = { x: 0, y: 0 };
  let tiltAt = 0;
  function orient(e: DeviceOrientationEvent) {
    if (e.beta === null || e.gamma === null) return;
    const g = screenGravity(e.beta, e.gamma, screen.orientation?.angle ?? 0);
    const t = e.timeStamp / 1000;
    const dt = smooth ? Math.max(0, Math.min(0.5, t - tiltAt)) : 0;
    tiltAt = t;
    if (!smooth) {
      smooth = g;
      level = g;
      return;
    }
    const a = 1 - Math.exp(-dt / TILT_SMOOTH_S);
    const b = 1 - Math.exp(-dt / TILT_REST_S);
    smooth = {
      x: smooth.x + (g.x - smooth.x) * a,
      y: smooth.y + (g.y - smooth.y) * a,
    };
    level = {
      x: level.x + (smooth.x - level.x) * b,
      y: level.y + (smooth.y - level.y) * b,
    };
    const dx = smooth.x - level.x, dy = smooth.y - level.y;
    const far = Math.hypot(dx, dy);
    const next = far <= TILT_DEAD ? { x: 0, y: 0 } : {
      x: (dx / far) * (far - TILT_DEAD) * TILT_GAIN,
      y: (dy / far) * (far - TILT_DEAD) * TILT_GAIN,
    };
    if (Math.abs(next.x - tilt.x) + Math.abs(next.y - tilt.y) < 0.004) return;
    tilt = next;
    settle();
  }

  const root = document.documentElement;
  const passive = { passive: true } as const;
  addEventListener("pointermove", follow, passive);
  addEventListener("pointerdown", follow, passive);
  root.addEventListener("pointerleave", away, passive);
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", up);
  node.addEventListener("lostpointercapture", up);
  node.addEventListener("click", click, { capture: true });
  if (tiltable) addEventListener("deviceorientation", orient);

  return {
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      removeEventListener("pointermove", follow);
      removeEventListener("pointerdown", follow);
      root.removeEventListener("pointerleave", away);
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.removeEventListener("lostpointercapture", up);
      node.removeEventListener("click", click, { capture: true });
      if (tiltable) removeEventListener("deviceorientation", orient);
    },
  };
}
