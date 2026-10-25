// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A press on the measurement slider (`Slider.svelte`, ui.md §6.2, §14.4):
 * whether it answers, and what. Only a still tap answers by
 * itself: let go within 10 px of where it went down, and not taken by the
 * browser for a scroll or a zoom (`pointercancel`), so a scroll or a pull
 * that starts on a slider never answers it. A tap on the thumb answers where
 * it is (the midpoint, while untouched); a tap elsewhere on the track, the
 * value under the finger (iOS does not move the thumb on a track tap,
 * Android does). A slide along the track answers through the range's own
 * input events.
 */

/** A pointer that went this far (CSS px) was a slide or a scroll, not a tap */
export const STILL_PX = 10;

/** A tap this close to the thumb's centre (CSS px) is a tap on the thumb */
export const THUMB_REACH_PX = 22;

/** One press, from its pointerdown to its pointerup or pointercancel */
export interface Press {
  downX: number;
  downY: number;
  upX: number;
  upY: number;
  /** The browser took the pointer (`pointercancel`): a scroll or a zoom */
  cancelled: boolean;
  /** A range input event already answered during the press (a slide) */
  sawInput: boolean;
  /**
   * The value the browser moved the range to by itself during the press
   * (Android's jump to the finger), held back and not answered yet
   */
  held?: number | null;
  /** The slider's value, where its thumb rests */
  value: number;
  /** Where the thumb's centre can go: from `trackLeft`, `trackWidth` long */
  trackLeft: number;
  trackWidth: number;
  min: number;
  max: number;
  step: number;
}

/**
 * What a press answers: nothing, the value where the thumb is, or a value
 * under the finger
 */
export type TapIntent =
  | { kind: "none" }
  | { kind: "thumb" }
  | { kind: "value"; value: number };

const NONE: TapIntent = { kind: "none" };

/** A move this far from the press, more along the track than across it */
export function isSlide(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= STILL_PX && Math.abs(dx) > Math.abs(dy);
}

/** The thumb's centre at `value` */
export function thumbX(
  value: number,
  min: number,
  max: number,
  trackLeft: number,
  trackWidth: number,
): number {
  return max > min
    ? trackLeft + ((value - min) / (max - min)) * trackWidth
    : trackLeft + trackWidth / 2;
}

/** The value whose thumb centre is nearest to `x`, on the step */
export function valueAt(
  x: number,
  min: number,
  max: number,
  step: number,
  trackLeft: number,
  trackWidth: number,
): number {
  const share = trackWidth > 0
    ? Math.min(1, Math.max(0, (x - trackLeft) / trackWidth))
    : 0.5;
  const steps = Math.round((share * (max - min)) / step);
  return Math.min(max, min + steps * step);
}

/** What a press that has ended answers (see the header) */
export function tapIntent(p: Press): TapIntent {
  if (p.cancelled || p.sawInput) return NONE;
  const dx = p.upX - p.downX;
  const dy = p.upY - p.downY;
  if (Math.hypot(dx, dy) >= STILL_PX) {
    // A slide the page saw only end: what the browser set stands
    return p.held != null && isSlide(dx, dy)
      ? { kind: "value", value: p.held }
      : NONE;
  }
  const thumb = thumbX(p.value, p.min, p.max, p.trackLeft, p.trackWidth);
  if (Math.abs(p.upX - thumb) <= THUMB_REACH_PX) return { kind: "thumb" };
  return {
    kind: "value",
    value: valueAt(p.upX, p.min, p.max, p.step, p.trackLeft, p.trackWidth),
  };
}
