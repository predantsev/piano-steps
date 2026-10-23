import { isBlackKey, keyboardRange } from '@piano-steps/core';
import { describe, expect, it } from 'vitest';
import { fitRange, keyGeometry, timeToY } from './geometry.ts';

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

describe('fitRange', () => {
  const whites = ([lo, hi]: [number, number]) => {
    let c = 0;
    for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) c++;
    return c;
  };
  it('two-hand Für Elise bars 2–3 (A2…E5): G2…F5, 21 white keys instead of 28', () => {
    expect(fitRange([45, 52, 57, 64, 69, 71, 72, 76])).toEqual([43, 77]);
    expect(whites(fitRange([45, 76]))).toBe(21);
  });
  it('a small melody still gets at least 15 white keys, ends on white keys', () => {
    const r = fitRange([60, 62, 64, 65, 67]);
    expect(whites(r)).toBeGreaterThanOrEqual(15);
    expect(isBlackKey(r[0]) || isBlackKey(r[1])).toBe(false);
    expect(r[0]).toBeLessThan(60);
    expect(r[1]).toBeGreaterThan(67);
  });
  it('black-key extremes get a white key beyond them', () => {
    const [lo, hi] = fitRange([61, 82], 1);
    expect([lo, hi]).toEqual([59, 84]);
  });
  it('stays on the piano', () => {
    const [lo, hi] = fitRange([21, 108]);
    expect(lo).toBe(21);
    expect(hi).toBe(108);
  });
});
