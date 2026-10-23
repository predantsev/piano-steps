import { isBlackKey, keyboardRange } from '@piano-steps/core';
import { describe, expect, it } from 'vitest';
import { keyGeometry, timeToY } from './geometry.ts';

/** The CSS percentages PianoKeyboard.tsx renders, recomputed independently. */
function keyboardCss(lo: number, hi: number) {
  const whites: number[] = [];
  for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) whites.push(p);
  const whiteW = 100 / whites.length;
  const css = new Map<number, { left: number; width: number }>();
  whites.forEach((p, i) => css.set(p, { left: i * whiteW, width: whiteW }));
  for (let p = lo; p <= hi; p++)
    if (isBlackKey(p)) css.set(p, { left: (whites.indexOf(p - 1) + 1) * whiteW - whiteW * 0.3, width: whiteW * 0.6 });
  return css;
}

describe('keyGeometry', () => {
  for (const range of [keyboardRange([60, 67]), keyboardRange([45, 76]), [21, 108] as [number, number]]) {
    it(`matches the on-screen keyboard for ${range[0]}…${range[1]}`, () => {
      const geo = keyGeometry(range);
      const css = keyboardCss(range[0], range[1]);
      expect(geo.size).toBe(range[1] - range[0] + 1);
      for (const [p, k] of geo) {
        expect(k.x * 100).toBeCloseTo(css.get(p)!.left, 9);
        expect(k.w * 100).toBeCloseTo(css.get(p)!.width, 9);
      }
    });
  }

  it('centres black keys on the boundary between their white neighbours', () => {
    const geo = keyGeometry([48, 71]); // C3…B4
    const c = geo.get(60)!;
    const cs = geo.get(61)!;
    const d = geo.get(62)!;
    expect(cs.black).toBe(true);
    expect(cs.x + cs.w / 2).toBeCloseTo(c.x + c.w, 12);
    expect(d.x).toBeCloseTo(c.x + c.w, 12);
    expect(cs.w).toBeCloseTo(c.w * 0.6, 12);
  });

  it('white keys tile the full width', () => {
    const geo = keyGeometry([48, 83]);
    const whites = [...geo.values()].filter((k) => !k.black);
    expect(whites[0].x).toBe(0);
    expect(whites.at(-1)!.x + whites.at(-1)!.w).toBeCloseTo(1, 12);
  });
});

describe('timeToY', () => {
  it('puts "now" on the bottom edge and now + lookAhead on the top edge', () => {
    expect(timeToY(10, 10, 3, 400)).toBe(400);
    expect(timeToY(13, 10, 3, 400)).toBe(0);
    expect(timeToY(11.5, 10, 3, 400)).toBe(200);
  });
});
