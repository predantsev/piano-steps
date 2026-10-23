import type { LessonNote } from '@piano-steps/core';
import { describe, expect, it } from 'vitest';
import { keyMarks } from './marks.ts';
import {
  covers,
  isActive,
  nextOnsetBars,
  playerHands,
  soundingBars,
  stepAtOrAfter,
  visibleBars,
  waitSteps,
  windowNotes,
} from './timeline.ts';

const n = (pitch: number, start: number, duration: number, hand?: 'L' | 'R'): LessonNote => ({
  pitch,
  start,
  duration,
  ...(hand ? { hand } : {}),
});

// two bars of a tiny tune: R melody on every beat, L bass held for two beats
const notes: LessonNote[] = [
  n(64, 0, 0.5, 'R'),
  n(48, 0, 1.9, 'L'),
  n(62, 0.5, 0.5, 'R'),
  n(60, 1, 0.5, 'R'),
  n(62, 1.5, 0.5, 'R'),
  n(64, 2, 0.5, 'R'),
  n(43, 2, 1.9, 'L'),
  n(64, 2.5, 0.5, 'R'),
  n(64, 3, 0.9),
];

describe('hands', () => {
  it('a note without a hand belongs to every selection (same as the player)', () => {
    expect(isActive(n(60, 0, 1), 'R')).toBe(true);
    expect(isActive(n(60, 0, 1), 'L')).toBe(true);
    expect(isActive(n(60, 0, 1, 'L'), 'R')).toBe(false);
    expect(isActive(n(60, 0, 1, 'L'), 'both')).toBe(true);
    expect(playerHands('both')).toBeUndefined();
    expect(playerHands('L')).toEqual(['L']);
  });
});

describe('windowNotes', () => {
  it('keeps notes starting inside the window and clips them at its end', () => {
    const w = windowNotes(notes, { start: 1, end: 2.25 });
    expect(w.map((x) => x.pitch)).toEqual([60, 62, 43, 64]);
    expect(w.find((x) => x.pitch === 43)!.duration).toBeCloseTo(0.25);
    expect(w.find((x) => x.pitch === 60)!.duration).toBe(0.5);
  });
});

describe('visibleBars', () => {
  const span = { start: 0, end: 2 };
  const win = windowNotes(notes, span);

  it('shows what sounds now and what starts within the look-ahead', () => {
    const bars = visibleBars(win, span, 0.6, 1, false, 'both');
    expect(bars.map((b) => b.note.pitch).sort()).toEqual([48, 60, 62, 62].sort());
  });

  it('when looping, the next pass is already falling while this one ends', () => {
    const bars = visibleBars(win, span, 1.6, 1, true, 'both');
    const next = bars.filter((b) => b.iteration === 1);
    expect(next.map((b) => b.start).sort()).toEqual([2, 2, 2.5]);
    expect(bars.some((b) => b.iteration === 0 && b.note.pitch === 62 && b.start === 1.5)).toBe(true);
  });

  it('time past the window end (wait-mode fall into the next pass) maps to the next iteration', () => {
    const bars = visibleBars(win, span, 2.1, 0.5, true, 'both');
    expect(bars.every((b) => b.iteration >= 1)).toBe(true);
    expect(bars.some((b) => b.start === 2.5)).toBe(true);
  });

  it('marks the other hand inactive', () => {
    const bars = visibleBars(win, span, 0, 1, false, 'R');
    expect(bars.find((b) => b.note.pitch === 48)!.active).toBe(false);
    expect(bars.find((b) => b.note.pitch === 64)!.active).toBe(true);
  });
});

describe('sounding / next', () => {
  const span = { start: 0, end: 4 };
  const bars = visibleBars(windowNotes(notes, span), span, 1, 3, false, 'R');
  it('sounding bars are active ones under the now-line', () => {
    expect(soundingBars(bars, 1).map((b) => b.note.pitch)).toEqual([60]);
  });
  it('next onset groups a chord within the tolerance', () => {
    expect(nextOnsetBars(bars, 1).map((b) => b.note.pitch)).toEqual([62]);
    const both = visibleBars(windowNotes(notes, span), span, 1.5, 3, false, 'both');
    expect(nextOnsetBars(both, 1.5).map((b) => b.note.pitch).sort()).toEqual([43, 64]);
  });
});

describe('wait steps', () => {
  it('only the practised hand makes stops', () => {
    const w = windowNotes(notes, { start: 0, end: 4 });
    expect(waitSteps(w, 'both').length).toBe(7);
    expect(waitSteps(w, 'L').map((s) => s.pitches)).toEqual([[48], [43], [64]]); // + the hand-less note
    expect(waitSteps(w, 'both')[0].pitches).toEqual([48, 64]);
  });
  it('stepAtOrAfter wraps to the first step', () => {
    const steps = waitSteps(windowNotes(notes, { start: 0, end: 4 }), 'R');
    expect(stepAtOrAfter(steps, 0.5)).toBe(1);
    expect(stepAtOrAfter(steps, 0.7)).toBe(2);
    expect(stepAtOrAfter(steps, 9)).toBe(0);
  });
  it('covers needs every required pitch', () => {
    expect(covers([48, 64], new Set([64]))).toBe(false);
    expect(covers([48, 64], new Set([64, 48, 50]))).toBe(true);
    expect(covers([], new Set([1]))).toBe(false);
  });
});

describe('keyMarks', () => {
  const span = { start: 0, end: 4 };
  const win = windowNotes(notes, span);
  it('at rest nothing is lit and the first step is outlined', () => {
    const bars = visibleBars(win, span, 0, 3, false, 'both');
    const m = keyMarks({ phase: 'idle', bars, now: 0, pressed: new Set(), wrong: null, held: [] });
    expect([...m.keys]).toEqual([
      [48, { mark: 'next' }],
      [64, { mark: 'next' }],
    ]);
  });
  it('while playing, sounding keys take their hand colour and the next step is outlined', () => {
    const bars = visibleBars(win, span, 0.6, 3, false, 'both');
    const m = keyMarks({ phase: 'playing', bars, now: 0.6, pressed: new Set(), wrong: null, held: [] });
    expect(m.keys.get(62)).toEqual({ mark: 'R', label: undefined });
    expect(m.keys.get(48)).toEqual({ mark: 'L', label: undefined });
    expect(m.keys.get(60)).toEqual({ mark: 'next' });
    expect(m.focusTime).toBe(1);
  });
  it('wait-mode feedback: right keys ok, a wrong key bad', () => {
    const bars = visibleBars(win, span, 1, 3, false, 'both');
    const m = keyMarks({ phase: 'waiting', bars, now: 1, pressed: new Set([60]), wrong: 61, held: [61] });
    expect(m.keys.get(60)).toEqual({ mark: 'ok' });
    expect(m.keys.get(61)).toEqual({ mark: 'bad' });
    expect(m.focusTime).toBe(1);
  });
});
