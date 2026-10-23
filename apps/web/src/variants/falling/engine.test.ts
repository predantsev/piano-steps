import type { LessonNote } from '@piano-steps/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerEvent, PlayOptions } from '../../audio/player.ts';
import { PracticeEngine, PREROLL_SEC, type PlayerLike, type PracticeOptions } from './engine.ts';

class FakePlayer implements PlayerLike {
  state: 'stopped' | 'playing' | 'paused' = 'stopped';
  time = 0;
  plays: PlayOptions[] = [];
  chords: number[][] = [];
  rates: number[] = [];
  private listeners = new Set<(e: PlayerEvent) => void>();
  play(o: PlayOptions = {}) {
    this.plays.push(o);
    this.time = o.from ?? 0;
    this.setState('playing');
  }
  stop() {
    this.setState('stopped');
  }
  setRate(r: number) {
    this.rates.push(r);
  }
  playChord(p: number[]) {
    this.chords.push(p);
  }
  subscribe(fn: (e: PlayerEvent) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  /** The scheduler reached the end of a non-looping run. */
  finish() {
    this.state = 'stopped';
    this.emit({ type: 'state', state: 'stopped' });
    this.emit({ type: 'end' });
  }
  wrap() {
    this.emit({ type: 'loop' });
  }
  private setState(s: 'stopped' | 'playing' | 'paused') {
    if (this.state === s) return;
    this.state = s;
    this.emit({ type: 'state', state: s });
  }
  private emit(e: PlayerEvent) {
    for (const l of this.listeners) l(e);
  }
}

const n = (pitch: number, start: number, duration: number, hand?: 'L' | 'R'): LessonNote => ({
  pitch,
  start,
  duration,
  ...(hand ? { hand } : {}),
});
// steps (both hands): 0 {48,64} · 0.5 {62} · 1 {60} · 1.5 {62}; fragment = [0, 2)
const notes = [n(64, 0, 0.45, 'R'), n(48, 0, 1.9, 'L'), n(62, 0.5, 0.45, 'R'), n(60, 1, 0.45, 'R'), n(62, 1.5, 0.45, 'R'), n(67, 2, 1, 'R')];

let player: FakePlayer;
let clock: number;
let attempts: number;
let lag: number;
const make = (opts: Partial<PracticeOptions> = {}) => {
  const e = new PracticeEngine(
    player,
    notes,
    { rate: 1, hands: 'both', loop: true, wait: false, sound: true, ...opts },
    { onAttempt: () => attempts++, onChange: () => {}, now: () => clock, audioLag: () => lag },
  );
  e.attach();
  e.setSpan({ start: 0, end: 2 });
  return e;
};
const advance = (e: PracticeEngine, ms: number) => {
  clock += ms;
  e.tick();
};

beforeEach(() => {
  player = new FakePlayer();
  clock = 1000;
  attempts = 0;
  lag = 0;
});

describe('continuous mode', () => {
  it('starts with a lead-in, then plays the fragment looped', () => {
    const e = make();
    expect(e.phase).toBe('idle');
    e.primary();
    expect(e.phase).toBe('preroll');
    expect(e.visualTime()).toBeCloseTo(-PREROLL_SEC);
    advance(e, PREROLL_SEC * 1000 + 1);
    expect(e.phase).toBe('playing');
    expect(player.plays).toEqual([{ from: 0, to: 2, loop: true, rate: 1, hands: undefined, muted: false }]);
    player.wrap();
    player.wrap();
    expect(attempts).toBe(2);
  });

  it('draws behind the player clock by the audio lag (scaled by speed)', () => {
    const e = make();
    e.primary();
    advance(e, 2000);
    lag = 0.1;
    e.setOptions({ rate: 0.5 });
    expect(player.rates).toEqual([0.5]);
    player.time = 1;
    expect(e.visualTime()).toBeCloseTo(0.95);
    player.time = 0.02;
    expect(e.visualTime()).toBe(0); // never before the run start
  });

  it('pause keeps the drawn position; resume plays from there and loops from the start on end', () => {
    const e = make();
    e.primary();
    advance(e, 2000);
    player.time = 1.2;
    e.primary(); // pause
    expect(e.phase).toBe('paused');
    expect(e.visualTime()).toBeCloseTo(1.2);
    e.primary(); // resume
    expect(player.plays.at(-1)).toMatchObject({ from: 1.2, loop: false });
    player.finish();
    expect(attempts).toBe(1);
    expect(player.plays.at(-1)).toMatchObject({ from: 0, loop: true });
    expect(e.phase).toBe('playing');
  });

  it('without loop a run ends in "done" and counts one attempt', () => {
    const e = make({ loop: false });
    e.primary();
    advance(e, 2000);
    expect(player.plays.at(-1)).toMatchObject({ loop: false });
    player.finish();
    expect(e.phase).toBe('done');
    expect(attempts).toBe(1);
    expect(e.visualTime()).toBe(0);
  });

  it('switching hands while playing keeps going from the same place with the other hand muted', () => {
    const e = make();
    e.primary();
    advance(e, 2000);
    player.time = 0.7;
    e.setOptions({ hands: 'R' });
    expect(player.plays.at(-1)).toMatchObject({ from: 0.7, hands: ['R'], loop: false });
  });

  it('a stop from outside (the shell) leaves the engine paused', async () => {
    const e = make();
    e.primary();
    advance(e, 2000);
    player.time = 0.8;
    e.tick();
    player.stop();
    await Promise.resolve();
    expect(e.phase).toBe('paused');
    expect(e.visualTime()).toBeCloseTo(0.8);
  });
});

describe('wait mode', () => {
  it('waits on the first step, falls to the next on Next, sounding it as it lands', () => {
    const e = make({ wait: true });
    expect(e.phase).toBe('waiting');
    expect(e.waitingStep?.pitches).toEqual([48, 64]);
    expect(e.visualTime()).toBe(0);
    lag = 0.1;
    e.next();
    expect(e.phase).toBe('falling');
    expect(player.plays).toEqual([]); // wait mode never runs the player's scheduler
    advance(e, 300);
    expect(e.visualTime()).toBeCloseTo(0.3);
    expect(player.chords).toEqual([]);
    advance(e, 120); // 0.42: within the 0.1 s audio lag of the 0.5 landing
    expect(player.chords).toEqual([[62]]);
    expect(e.phase).toBe('falling');
    advance(e, 100);
    expect(e.phase).toBe('waiting');
    expect(e.stepIdx).toBe(1);
    expect(e.visualTime()).toBe(0.5);
    expect(player.chords).toEqual([[62]]); // not twice
  });

  it('the fall runs at the chosen speed', () => {
    const e = make({ wait: true, rate: 0.25 });
    e.next();
    advance(e, 1000);
    expect(e.visualTime()).toBeCloseTo(0.25);
    advance(e, 1000);
    expect(e.phase).toBe('waiting');
  });

  it('playing the right keys advances; a wrong key only flashes', () => {
    const e = make({ wait: true });
    e.noteOn(50);
    expect(e.wrong?.pitch).toBe(50);
    expect(e.phase).toBe('waiting');
    e.noteOn(64);
    expect(e.phase).toBe('waiting');
    expect([...e.pressed]).toEqual([64]);
    e.noteOn(48);
    expect(e.phase).toBe('falling');
    advance(e, 700);
    expect(e.wrong).toBeNull();
  });

  it('Next during a fall lands immediately', () => {
    const e = make({ wait: true });
    e.next();
    e.next();
    expect(e.phase).toBe('waiting');
    expect(e.stepIdx).toBe(1);
    expect(player.chords).toEqual([[62]]);
  });

  it('after the last step it loops to the first one and counts an attempt', () => {
    const e = make({ wait: true });
    for (let i = 0; i < 3; i++) e.next(), e.next();
    expect(e.stepIdx).toBe(3);
    e.next(); // fall from 1.5 into the next pass: lands on step 0 at 0 + period
    advance(e, 400);
    expect(e.visualTime()).toBeCloseTo(1.9);
    advance(e, 200);
    expect(e.phase).toBe('waiting');
    expect(e.stepIdx).toBe(0);
    expect(e.visualTime()).toBe(0);
    expect(attempts).toBe(1);
    expect(player.chords.at(-1)!.sort()).toEqual([64]);
    expect(player.chords.at(-2)).toEqual([48]);
  });

  it('without loop the last step falls out to the fragment end and stops', () => {
    const e = make({ wait: true, loop: false });
    for (let i = 0; i < 3; i++) e.next(), e.next();
    const before = player.chords.length;
    e.next();
    advance(e, 600);
    expect(e.phase).toBe('done');
    expect(attempts).toBe(1);
    expect(player.chords.length).toBe(before);
    e.next();
    expect(e.phase).toBe('waiting');
    expect(e.stepIdx).toBe(0);
  });

  it('one hand: stops only on that hand, Hear it replays the waiting step even when muted', () => {
    const e = make({ wait: true, hands: 'L', sound: false });
    expect(e.steps.map((s) => s.pitches)).toEqual([[48]]);
    e.hearStep();
    expect(player.chords).toEqual([[48]]);
  });

  it('turning wait mode off during the fall into the next pass starts over cleanly', () => {
    const e = make({ wait: true });
    e.setSpan({ start: 0.25, end: 2.25 }); // steps 0.5 · 1 · 1.5 · 2 — the first one is after the start
    for (let i = 0; i < 3; i++) e.next(), e.next();
    e.next(); // last step → falls from 2.0 towards 0.5 + period = 2.5, past span.end
    advance(e, 350);
    expect(e.visualTime()).toBeCloseTo(2.35);
    e.setOptions({ wait: false });
    expect(e.phase).toBe('idle');
    expect(e.visualTime()).toBe(0.25);
    expect(attempts).toBe(0);
  });

  it('turning wait mode off resumes continuous mode from where it stood', () => {
    const e = make({ wait: true });
    e.next();
    e.next();
    e.setOptions({ wait: false });
    expect(e.phase).toBe('paused');
    expect(e.visualTime()).toBe(0.5);
    e.primary();
    expect(player.plays.at(-1)).toMatchObject({ from: 0.5 });
  });
});
