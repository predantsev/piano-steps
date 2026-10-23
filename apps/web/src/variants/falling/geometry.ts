import { isBlackKey } from '@piano-steps/core';

/** One key's horizontal slot, as fractions (0…1) of the keyboard width. */
export interface KeyRect {
  pitch: number;
  x: number;
  w: number;
  black: boolean;
}

/**
 * Key positions for a range — the exact formula `ui/PianoKeyboard.tsx` uses for its CSS
 * percentages (white keys equal width; black keys 60 % of a white key, centred on the boundary
 * after the white key below them), so the falling lane lines up with the keys pixel for pixel.
 */
export function keyGeometry(range: readonly [number, number]): Map<number, KeyRect> {
  const [lo, hi] = range;
  const whites: number[] = [];
  for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) whites.push(p);
  const whiteW = whites.length ? 1 / whites.length : 1;
  const out = new Map<number, KeyRect>();
  whites.forEach((p, i) => out.set(p, { pitch: p, x: i * whiteW, w: whiteW, black: false }));
  for (let p = lo; p <= hi; p++) {
    if (!isBlackKey(p)) continue;
    const leftWhite = whites.indexOf(p - 1);
    out.set(p, { pitch: p, x: (leftWhite + 1) * whiteW - whiteW * 0.3, w: whiteW * 0.6, black: true });
  }
  return out;
}

/**
 * Vertical position of a lesson time in the lane: the now-line is the bottom edge (y = height),
 * `lookAhead` seconds of lesson time fit between the now-line and the top (y = 0).
 */
export function timeToY(t: number, now: number, lookAhead: number, height: number): number {
  return height - ((t - now) / lookAhead) * height;
}
