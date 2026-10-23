import { demoLessons, parseVoice, prepareLesson, validateLessonInput, type LessonInput, type LessonNote } from '@piano-steps/core';
import { describe, expect, it } from 'vitest';
import {
  buildSteps,
  countInFrom,
  fragmentStatus,
  heldOver,
  isAccent,
  isStepPlayed,
  layoutStrip,
  lessonHasLeft,
  masteredCount,
  maxChord,
  metronome,
  stepAt,
  stepKind,
  tickIndex,
  trackOffset,
} from './model.ts';

const bpm = 60; // 1 beat = 1 s, easy numbers
const R = parseVoice('E4 E4 F4 G4/2 C4+E4', { bpm, hand: 'R' });
const L = parseVoice('C3/5 G2+D3', { bpm, hand: 'L' });
const notes: LessonNote[] = [...R, ...L];
const frag = { start: 0, end: 7 };

/** A lesson as the variant gets it from the API: validated and prepared (fragment bounds snapped). */
function prepared(l: LessonInput) {
  const v = validateLessonInput(l);
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return prepareLesson(v.value);
}

describe('buildSteps', () => {
  const steps = buildSteps(notes, frag);

  it('one step per onset, both hands in one step, split into lanes', () => {
    expect(steps.map((s) => s.time)).toEqual([0, 1, 2, 3, 5]);
    expect(steps[0].lanes.R?.pitches).toEqual([64]);
    expect(steps[0].lanes.L?.pitches).toEqual([48]);
    expect(steps[1].lanes.L).toBeUndefined();
    expect(steps[4].lanes.R?.pitches).toEqual([60, 64]);
    expect(steps[4].lanes.L?.pitches).toEqual([43, 50]);
  });

  it('slot = time to the next step, the last one runs to the fragment end', () => {
    expect(steps.map((s) => s.slotSec)).toEqual([1, 1, 1, 2, 2]);
  });

  it('hold = the longest note of that hand in the step', () => {
    expect(steps[0].lanes.L?.holdSec).toBeCloseTo(4.75); // C3 for 5 beats × 0.95
    expect(steps[3].lanes.R?.holdSec).toBeCloseTo(1.9);
  });

  it('keeps only notes starting inside the fragment', () => {
    expect(buildSteps(notes, { start: 1, end: 3 }).map((s) => s.time)).toEqual([1, 2]);
  });

  it('notes without a hand go to the right-hand lane', () => {
    const s = buildSteps([{ pitch: 60, start: 0, duration: 1 }], { start: 0, end: 1 });
    expect(s[0].lanes.R?.pitches).toEqual([60]);
    expect(lessonHasLeft([{ pitch: 60, start: 0, duration: 1 }])).toBe(false);
    expect(lessonHasLeft(notes)).toBe(true);
  });

  it('collects finger numbers per pitch', () => {
    const s = buildSteps([{ pitch: 60, start: 0, duration: 1, hand: 'R', finger: 1 }], { start: 0, end: 1 });
    expect(s[0].lanes.R?.fingers.get(60)).toBe(1);
  });

  it('largest chord per hand', () => {
    expect(maxChord(steps)).toEqual({ R: 2, L: 2 });
  });
});

describe('step semantics', () => {
  const steps = buildSteps(notes, frag);

  it('kind: single, chord, both hands', () => {
    expect(stepKind(steps[1])).toBe('single');
    expect(stepKind(steps[0])).toBe('hands');
    expect(stepKind(buildSteps(R, frag)[4])).toBe('chord');
  });

  it('held over: the left-hand C3 is still down during steps 2–4', () => {
    expect(heldOver(steps, 0)).toEqual([]);
    expect(heldOver(steps, 1).map((n) => n.pitch)).toEqual([48]);
    expect(heldOver(steps, 3).map((n) => n.pitch)).toEqual([48]);
    expect(heldOver(steps, 4)).toEqual([]);
  });

  it('stepAt follows the clock', () => {
    expect(stepAt(steps, -0.5)).toBe(-1);
    expect(stepAt(steps, 0)).toBe(0);
    expect(stepAt(steps, 2.5)).toBe(2);
    expect(stepAt(steps, 4.99)).toBe(3);
    expect(stepAt(steps, 99)).toBe(4);
  });

  it('a step counts as played once all its keys were pressed (any order)', () => {
    expect(isStepPlayed(new Set([60]), steps[4])).toBe(false);
    expect(isStepPlayed(new Set([60, 64, 43, 50]), steps[4])).toBe(true);
    expect(isStepPlayed(new Set([64, 48, 99]), steps[0])).toBe(true);
    expect(isStepPlayed(new Set(), { pitches: [] })).toBe(false);
  });
});

describe('layoutStrip', () => {
  const steps = buildSteps(notes, frag); // slots 1,1,1,2,2 s

  it('fits the width, widths proportional to time when above the minimum', () => {
    const l = layoutStrip(steps, 700, { minW: 50, maxW: 1000 });
    expect(l.total).toBeCloseTo(700, 0);
    expect(l.ws[3] / l.ws[0]).toBeCloseTo(2, 2);
    expect(l.xs[1]).toBeCloseTo(l.ws[0]);
  });

  it('clamps to the minimum and the maximum', () => {
    const l = layoutStrip([{ time: 0, slotSec: 0.1 }, { time: 0.1, slotSec: 10 }], 400, { minW: 72, maxW: 300 });
    expect(l.ws[0]).toBeGreaterThanOrEqual(72);
    expect(l.ws[1]).toBeLessThanOrEqual(300);
  });

  it('overflows (wider than the viewport) when even minimum cards do not fit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ time: i * 0.25, slotSec: 0.25 }));
    const l = layoutStrip(many, 600, { minW: 72 });
    expect(l.ws.every((w) => w === 72)).toBe(true);
    expect(l.total).toBe(30 * 72);
    // the current card is kept in view
    for (const i of [0, 10, 29]) {
      const off = trackOffset(l, 600, i);
      expect(l.xs[i] + off).toBeGreaterThanOrEqual(-1);
      expect(l.xs[i] + l.ws[i] + off).toBeLessThanOrEqual(601);
    }
  });

  it('xAt maps lesson time into the cards (piecewise linear) and clamps', () => {
    const l = layoutStrip(steps, 700, { minW: 50, maxW: 1000 });
    expect(l.xAt(0)).toBe(0);
    expect(l.xAt(0.5)).toBeCloseTo(l.ws[0] / 2);
    expect(l.xAt(4)).toBeCloseTo(l.xs[3] + l.ws[3] / 2);
    expect(l.xAt(100)).toBe(l.total);
  });

  it('centres a short track', () => {
    const l = layoutStrip([{ time: 0, slotSec: 1 }], 1000, { minW: 72, maxW: 300 });
    expect(trackOffset(l, 1000, 0)).toBe(350);
  });
});

describe('play-along metronome', () => {
  it('ticks on the time-signature unit', () => {
    expect(metronome({ bpm: 120, timeSignature: [4, 4] })).toEqual({ tickSec: 0.5, perBar: 4 });
    expect(metronome({ bpm: 72, timeSignature: [3, 8] })).toEqual({ tickSec: (60 / 72) * 0.5, perBar: 3 });
    expect(metronome({ bpm: 60 })).toEqual({ tickSec: 1, perBar: 4 });
    expect(metronome(undefined)).toBeNull();
  });
  it('ticks and accents follow the lesson grid (bars from t = 0), not the fragment start', () => {
    expect(tickIndex(10, 0.5)).toBe(20);
    expect(tickIndex(10.49, 0.5)).toBe(20);
    expect(tickIndex(10.5, 0.5)).toBe(21);
    expect(tickIndex(-0.5, 0.5)).toBe(-1);
    expect(isAccent(20, 4)).toBe(true);
    expect(isAccent(21, 4)).toBe(false);
    expect(isAccent(-4, 4)).toBe(true);
    expect(isAccent(-1, 4)).toBe(false);
  });
  it('the bar phase follows the fragment start, so a lesson with a pickup accents the real downbeats', () => {
    const fe = demoLessons().find((l) => l.slug === 'fur-elise-opening')!;
    const m = metronome(fe.tempo)!; // 3/8: tick = one eighth
    const bars23 = prepared(fe).fragments[1];
    const bar = tickIndex(bars23.start, m.tickSec);
    expect(isAccent(bar, m.perBar, bar)).toBe(true); // the fragment's first note = downbeat
    expect(isAccent(bar + 3, m.perBar, bar)).toBe(true); // next bar line
    expect(isAccent(bar + 1, m.perBar, bar)).toBe(false);
    // the count-in's first tick is the accent too
    const first = tickIndex(countInFrom(bars23.start, m, 1), m.tickSec);
    expect(first).toBe(bar - 3);
    expect(isAccent(first, m.perBar, bar)).toBe(true);
    expect(isAccent(bar, m.perBar)).toBe(false); // what a grid from t = 0 alone would get wrong
  });
  it('the count-in is exactly one bar: its first tick is the accented downbeat, perBar ticks before the start', () => {
    const m = { tickSec: 0.5, perBar: 4 };
    for (const start of [0, 2, 8, 10]) { // fragments cut on bar lines
      const from = countInFrom(start, m, 1);
      const first = tickIndex(from, m.tickSec); // the player holds time at `from` for the first frames
      expect(first).toBe(tickIndex(start, m.tickSec) - 4);
      expect(isAccent(first, 4)).toBe(true);
      // ticks emitted from `from` up to the start: one bar, no extra weak tick
      const ticks = new Set<number>();
      for (let t = from; t < start - 1e-9; t += 1 / 240) ticks.add(tickIndex(t, m.tickSec));
      expect(ticks.size).toBe(4);
    }
    // a start off the grid counts in from the grid tick before it
    expect(countInFrom(0.25, m, 1)).toBe(-2);
    expect(countInFrom(7.2, m, 1)).toBe(5);
  });
  it('without a tempo the get-ready time is 1.5 s of wall clock at any speed', () => {
    expect(countInFrom(4, null, 1)).toBe(2.5);
    expect(countInFrom(4, null, 0.25)).toBe(3.625); // 0.375 lesson s = 1.5 s at 25 %
  });
});

describe('progress helpers', () => {
  const progress = [
    { fragmentPosition: 0, status: 'mastered' as const, attempts: 2 },
    { fragmentPosition: 1, status: 'learning' as const, attempts: 1 },
    { fragmentPosition: 9, status: 'mastered' as const, attempts: 1 }, // stale (lesson got shorter)
  ];
  it('status per fragment, "new" when never practised', () => {
    expect(fragmentStatus(progress, 0)).toBe('mastered');
    expect(fragmentStatus(progress, 1)).toBe('learning');
    expect(fragmentStatus(progress, 2)).toBe('new');
  });
  it('counts only fragments that exist', () => {
    expect(masteredCount(progress, 3)).toBe(1);
  });
});

describe('demo lessons', () => {
  it('every fragment has steps and every note lands in exactly one fragment', () => {
    for (const l of demoLessons()) {
      const fragments = prepared(l).fragments; // what the variant gets from the API
      expect(fragments.length).toBeGreaterThan(0);
      let count = 0;
      for (const f of fragments) {
        const steps = buildSteps(l.notes, f);
        expect(steps.length).toBeGreaterThan(0);
        count += steps.reduce((a, s) => a + s.notes.length, 0);
      }
      expect(count).toBe(l.notes.length);
    }
  });

  it('a phrase that starts a hair before a rounded fragment bound opens the next fragment (core snaps the bound)', () => {
    const fe = demoLessons().find((l) => l.slug === 'fur-elise-opening')!;
    const a4 = fe.notes.find((n) => n.pitch === 69)!;
    expect(a4.start).toBeCloseTo(1.6667, 4);
    // an agent-authored lesson with bounds rounded to 3 decimals, as the demo had before core #8
    const rounded = { ...fe, slug: 'fe-rounded', fragments: [{ start: 0, end: 1.667 }, { start: 1.667, end: 4.167 }] };
    const [pm, pb] = prepared(rounded).fragments;
    expect(pm.end).toBeCloseTo(1.6667, 4);
    const m = buildSteps(fe.notes, pm);
    expect(m.length).toBe(8);
    expect(m.at(-1)!.slotSec).toBeGreaterThan(0.1);
    expect(buildSteps(fe.notes, pb)[0].pitches).toEqual([45, 69]); // A2 + A4
  });

  it('a note 10 ms before the end of a fragment followed by a gap stays in that fragment (no local edge shift)', () => {
    const gap: LessonNote[] = [
      { pitch: 60, start: 1, duration: 1 },
      { pitch: 62, start: 9.99, duration: 0.2 }, // 10 ms before a fragment end that has a gap after it
      { pitch: 64, start: 12.5, duration: 0.5 },
    ];
    expect(buildSteps(gap, { start: 0, end: 10 }).flatMap((s) => s.pitches)).toEqual([60, 62]);
    expect(buildSteps(gap, { start: 12, end: 20 }).flatMap((s) => s.pitches)).toEqual([64]);
  });
});
