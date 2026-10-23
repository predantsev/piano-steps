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

/**
 * A keyboard range sized to the notes being practised, so the keys are as wide as the screen
 * allows (core `keyboardRange()` pads to whole octaves and ≥ 25 keys, which keeps a two-hand
 * fragment at 28 white keys ≈ 41 px on an iPad). One white key of margin on each side, at least
 * `minWhites` white keys, and both ends on white keys — `PianoKeyboard` places a black key from the
 * white key below it, so a black end key would break its layout.
 */
export function fitRange(pitches: Iterable<number>, minWhites = 15): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pitches) {
    min = Math.min(min, p);
    max = Math.max(max, p);
  }
  if (!Number.isFinite(min)) return [48, 71];
  const LO = 21; // A0
  const HI = 108; // C8
  const down = (p: number) => {
    let q = p - 1;
    while (q > LO && isBlackKey(q)) q--;
    return Math.max(LO, q);
  };
  const up = (p: number) => {
    let q = p + 1;
    while (q < HI && isBlackKey(q)) q++;
    return Math.min(HI, q);
  };
  let lo = isBlackKey(min) ? down(min) : min;
  let hi = isBlackKey(max) ? up(max) : max;
  lo = down(lo);
  hi = up(hi);
  const whites = () => {
    let c = 0;
    for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) c++;
    return c;
  };
  for (let i = 0; whites() < minWhites && (lo > LO || hi < HI); i++) {
    if ((i % 2 === 0 && hi < HI) || lo <= LO) hi = up(hi);
    else lo = down(lo);
  }
  return [lo, hi];
}
