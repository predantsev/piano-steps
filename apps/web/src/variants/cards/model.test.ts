import { autoFragments, demoLessons, parseVoice, type LessonNote } from '@piano-steps/core';
import { describe, expect, it } from 'vitest';
import {
  buildSteps,
  fragmentStatus,
  fragmentWindow,
  heldOver,
  isStepPlayed,
  layoutStrip,
  lessonHasLeft,
  masteredCount,
  maxChord,
  stepAt,
  stepKind,
  trackOffset,
} from './model.ts';

const bpm = 60; // 1 beat = 1 s, easy numbers
const R = parseVoice('E4 E4 F4 G4/2 C4+E4', { bpm, hand: 'R' });
const L = parseVoice('C3/5 G2+D3', { bpm, hand: 'L' });
const notes: LessonNote[] = [...R, ...L];
const frag = { start: 0, end: 7 };

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
      const fragments = l.fragments ?? autoFragments(l.notes, { tempo: l.tempo });
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

  it('a note a hair before a rounded fragment end opens the next fragment (Für Elise)', () => {
    const fe = demoLessons().find((l) => l.slug === 'fur-elise-opening')!;
    const [motif, bars23] = fe.fragments!;
    expect(motif.end).toBe(1.667); // rounded bound…
    const a4 = fe.notes.find((n) => n.pitch === 69)!;
    expect(a4.start).toBeCloseTo(1.6667, 4); // …the phrase starts a hair earlier
    const m = buildSteps(fe.notes, motif);
    expect(m.length).toBe(8);
    expect(m.at(-1)!.slotSec).toBeGreaterThan(0.1);
    expect(buildSteps(fe.notes, bars23)[0].pitches).toEqual([45, 69]); // A2 + A4
    expect(fragmentWindow(motif)).toEqual({ from: 0, to: 1.647 });
  });
});
