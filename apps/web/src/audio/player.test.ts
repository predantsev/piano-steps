import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake audio context: currentTime advances with fake timers; Tone.now() adds a 0.1 s look-ahead.
const LOOK_AHEAD = 0.1;
const OUTPUT_LATENCY = 0.02;
const clock = { t: 0 };
const attacks: { note: string; at: number }[] = [];

vi.mock('tone', () => {
  class Inst {
    toDestination() {
      return this;
    }
    triggerAttackRelease(note: string | string[], _d: number, at: number) {
      for (const n of [note].flat()) attacks.push({ note: n, at });
    }
    triggerAttack() {}
    triggerRelease() {}
    releaseAll() {}
  }
  return {
    start: async () => {},
    now: () => clock.t + LOOK_AHEAD,
    getContext: () => ({ immediate: () => clock.t, rawContext: { outputLatency: OUTPUT_LATENCY } }),
    PolySynth: Inst,
    Synth: class {},
    Sampler: Inst,
  };
});

const { LessonPlayer } = await import('./player.ts');

describe('LessonPlayer clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clock.t = 10;
    attacks.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  const advance = (sec: number) => {
    for (let i = 0; i < Math.round(sec / 0.005); i++) {
      clock.t += 0.005;
      vi.advanceTimersByTime(5);
    }
  };

  it('reports the time a note is heard, not when it was scheduled', async () => {
    const p = new LessonPlayer();
    await p.unlock();
    p.load([
      { pitch: 60, start: 0, duration: 0.5 },
      { pitch: 64, start: 1, duration: 0.5 },
    ]);
    p.play({ from: 0 });
    advance(1.0);
    const e4 = attacks.find((a) => a.note === 'E4');
    expect(e4).toBeDefined(); // handed over ahead of time
    // move the audio clock to the moment E4 is audible: its attack time + output latency
    clock.t = e4!.at + OUTPUT_LATENCY;
    expect(p.time).toBeCloseTo(1, 3);
  });

  it('runs at the playback rate and keeps position when the rate changes', async () => {
    const p = new LessonPlayer();
    await p.unlock();
    p.load([{ pitch: 60, start: 0, duration: 4 }]);
    p.play({ from: 0, rate: 0.5 });
    advance(0.5); // past the start-up delay (scheduling offset + look-ahead + output latency)
    const t0 = p.time;
    advance(1);
    expect(p.time - t0).toBeCloseTo(0.5, 1);
    const before = p.time;
    p.setRate(1);
    expect(p.time).toBeGreaterThanOrEqual(before - 0.01);
  });
});
