// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The ambient light's behaviour (ui.md §13.7), loaded with
 * `Aura.svelte` as a lazy chunk. The drift itself is CSS keyframes on the
 * compositor; this file only:
 * - puts the lamp behind Now (measured, never guessed);
 * - lets the fields lean a little toward a finger held on the empty page
 *   (≤ 24 px; a mouse: a gentle follow ≤ 20 px), critically damped, back on
 *   release; pressing Now gathers the lamp. Nothing else: no ripples, no
 *   trails, nothing that accumulates or answers a check-in;
 * - puts it to sleep (frames stop) after 20 s without input, when the page
 *   is hidden, and keeps it still where asked (History, Settings, the
 *   "Moving background" switch, reduced motion, Save-Data).
 * The rAF loop runs only while a lean is settling.
 */

export interface AuraControl {
  /** Drifting and leaning (Home, sign-in) or a still picture */
  setMoving(moving: boolean): void;
  /** Measure Now again (the screen changed) */
  placeLamp(): void;
  stop(): void;
}

/** Lean per field: the lamp most, the pool less, the daylight a little away, the deep pool gentle */
const K = [0.05, 0.03, -0.02, 0.015];
/** Rad/s: settles in about 0.8 s, no overshoot */
const OMEGA = 6;
const SLEEP_MS = 20_000;
/** Not the empty page: a finger here is using the app */
const CONTROLS =
  "button, a, input, textarea, select, label, [role=button], [role=switch], [role=tab], [role=radio], [role=dialog], .auth-card, .login-card, .seg, .dots, .toast-container";

interface Field {
  el: HTMLElement;
  k: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
}

export function startAura(root: HTMLElement, moving: boolean): AuraControl {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData === true;
  const fields: Field[] = [...root.children].map((el, i) => ({
    el: el as HTMLElement,
    k: K[i] ?? 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    tx: 0,
    ty: 0,
  }));
  let isMoving = moving;
  const lively = () => isMoving && !reduce.matches && !saveData;

  // ----- Still, asleep -----
  let idle: ReturnType<typeof setTimeout> | null = null;
  function sync() {
    root.classList.toggle("still", !lively());
    if (!lively()) release();
  }
  function sleep() {
    root.classList.add("asleep");
  }
  function wake() {
    if (document.hidden) return;
    root.classList.remove("asleep");
    if (idle) clearTimeout(idle);
    idle = setTimeout(sleep, SLEEP_MS);
  }
  const onVisibility = () => (document.hidden ? sleep() : wake());

  // ----- The lamp behind Now -----
  function placeLamp() {
    const now = document.querySelector("button.now");
    // No Now on this screen (sign-in, Settings): the lamp stays where it is
    if (!now) return;
    const r = now.getBoundingClientRect();
    root.style.setProperty("--lamp-x", `${Math.round(r.left + r.width / 2)}px`);
    root.style.setProperty("--lamp-y", `${Math.round(r.top + r.height / 2)}px`);
  }

  // ----- The lean -----
  let frame = 0;
  let last = 0;
  function step(t: number) {
    const dt = Math.min(1 / 30, last ? (t - last) / 1000 : 1 / 60);
    last = t;
    let busy = false;
    for (const f of fields) {
      f.vx += (OMEGA * OMEGA * (f.tx - f.x) - 2 * OMEGA * f.vx) * dt;
      f.vy += (OMEGA * OMEGA * (f.ty - f.y) - 2 * OMEGA * f.vy) * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (
        Math.abs(f.tx - f.x) > 0.1 || Math.abs(f.ty - f.y) > 0.1 ||
        Math.abs(f.vx) > 0.05 || Math.abs(f.vy) > 0.05
      ) busy = true;
      f.el.style.translate = `${f.x.toFixed(2)}px ${f.y.toFixed(2)}px`;
    }
    frame = busy ? requestAnimationFrame(step) : 0;
    if (!busy) last = 0;
  }
  const settle = () => {
    if (!frame) frame = requestAnimationFrame(step);
  };
  // The fields' centres, read at most once a second (the drift is slow)
  let centres: Array<[number, number]> = [];
  let measured = 0;
  function centresNow() {
    const t = performance.now();
    if (t - measured > 1000) {
      measured = t;
      centres = fields.map((f) => {
        const r = f.el.getBoundingClientRect();
        return [r.left + r.width / 2 - f.x, r.top + r.height / 2 - f.y];
      });
    }
    return centres;
  }
  /** Each field toward the point, capped */
  function lean(px: number, py: number, cap: number) {
    const c = centresNow();
    const clamp = (v: number) => Math.max(-cap, Math.min(cap, v));
    fields.forEach((f, i) => {
      f.tx = clamp((px - c[i][0]) * f.k);
      f.ty = clamp((py - c[i][1]) * f.k);
    });
    settle();
  }
  function release() {
    for (const f of fields) f.tx = f.ty = 0;
    if (fields.some((f) => f.x || f.y)) settle();
  }

  let held: { id: number; x: number; y: number } | null = null;
  function down(e: PointerEvent) {
    wake();
    if (!lively()) return;
    const target = e.target as Element | null;
    if (target?.closest("button.now")) {
      root.classList.add("gather");
      return;
    }
    if (e.pointerType === "mouse" || target?.closest(CONTROLS)) return;
    held = { id: e.pointerId, x: e.clientX, y: e.clientY };
    lean(e.clientX, e.clientY, 24);
  }
  function move(e: PointerEvent) {
    wake();
    if (!lively()) return;
    if (held && e.pointerId === held.id) {
      const dx = e.clientX - held.x, dy = e.clientY - held.y;
      // A sideways swipe is a pane change, not play
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        held = null;
        release();
        return;
      }
      lean(e.clientX, e.clientY, 24);
    } else if (!held && e.pointerType === "mouse" && fine.matches) {
      lean(e.clientX, e.clientY, 20);
    }
  }
  function up(e: PointerEvent) {
    root.classList.remove("gather");
    if (held && e.pointerId === held.id) {
      held = null;
      release();
    }
  }
  const leave = () => {
    if (!held) release();
  };

  const opts = { passive: true } as const;
  addEventListener("pointerdown", down, opts);
  addEventListener("pointermove", move, opts);
  addEventListener("pointerup", up, opts);
  addEventListener("pointercancel", up, opts);
  document.documentElement.addEventListener("pointerleave", leave, opts);
  addEventListener("keydown", wake, opts);
  addEventListener("focusin", wake, opts);
  addEventListener("resize", placeLamp, opts);
  document.addEventListener("visibilitychange", onVisibility);
  addEventListener("pagehide", sleep);
  addEventListener("pageshow", wake);
  reduce.addEventListener("change", sync);

  placeLamp();
  sync();
  wake();

  return {
    setMoving(m: boolean) {
      isMoving = m;
      sync();
    },
    placeLamp,
    stop() {
      if (frame) cancelAnimationFrame(frame);
      if (idle) clearTimeout(idle);
      removeEventListener("pointerdown", down);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      document.documentElement.removeEventListener("pointerleave", leave);
      removeEventListener("keydown", wake);
      removeEventListener("focusin", wake);
      removeEventListener("resize", placeLamp);
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("pagehide", sleep);
      removeEventListener("pageshow", wake);
      reduce.removeEventListener("change", sync);
    },
  };
}
