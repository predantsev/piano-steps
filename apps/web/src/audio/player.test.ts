import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake audio context: currentTime advances with fake timers; Tone.now() adds a 0.1 s look-ahead.
const LOOK_AHEAD = 0.1;
const OUTPUT_LATENCY = 0.02;
const clock = { t: 0 };
const attacks: { note: string; at: number }[] = [];
const releases = { n: 0 };
const audio = { state: 'suspended', allowStart: true, starts: 0, listeners: [] as (() => void)[] };

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
    releaseAll() {
      releases.n++;
    }
  }
  return {
    start: async () => {
      audio.starts++;
      if (audio.allowStart) audio.state = 'running';
    },
    now: () => clock.t + LOOK_AHEAD,
    getContext: () => ({
      immediate: () => clock.t,
      rawContext: { outputLatency: OUTPUT_LATENCY },
      get state() {
        return audio.state;
      },
      on: (_e: string, fn: () => void) => audio.listeners.push(fn),
    }),
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
    releases.n = 0;
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

  it('loops seamlessly: the next pass is queued exactly one pass-length later, no freeze at the wrap', async () => {
    const p = new LessonPlayer();
    await p.unlock();
    p.load([
      { pitch: 60, start: 0, duration: 0.5 },
      { pitch: 64, start: 0.5, duration: 0.5 },
    ]);
    const events: string[] = [];
    p.subscribe((e) => events.push(e.type === 'state' ? `state:${e.state}` : e.type));
    p.play({ from: 0, to: 1, loop: true });
    const samples: number[] = [];
    for (let i = 0; i < 600; i++) {
      clock.t += 0.005;
      vi.advanceTimersByTime(5);
      samples.push(p.time);
    }
    const c4 = attacks.filter((a) => a.note === 'C4').map((a) => a.at);
    expect(c4.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < c4.length; i++) expect(c4[i] - c4[i - 1]).toBeCloseTo(1, 6);
    expect(events.filter((e) => e === 'loop').length).toBeGreaterThanOrEqual(2);
    // time only ever moves forward, except one jump back per wrap; it never sits still for > 10 ms while playing
    let stuck = 0;
    let maxStuck = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[0] === 0 && i < 40) continue; // start-up delay before the first note
      if (samples[i] === samples[i - 1]) maxStuck = Math.max(maxStuck, ++stuck);
      else stuck = 0;
    }
    expect(maxStuck).toBeLessThanOrEqual(2);
    p.stop();
  });

  it('an empty range ends at once instead of looping forever', async () => {
    const p = new LessonPlayer();
    await p.unlock();
    p.load([{ pitch: 60, start: 0, duration: 1 }]);
    const events: string[] = [];
    p.subscribe((e) => events.push(e.type));
    p.play({ from: 5, to: 6, loop: true });
    expect(p.state).toBe('stopped');
    expect(events.filter((e) => e === 'end')).toHaveLength(1);
    advance(0.5);
    expect(events.filter((e) => e === 'loop')).toHaveLength(0);
  });

  it('ends after the last pass when not looping', async () => {
    const p = new LessonPlayer();
    await p.unlock();
    p.load([{ pitch: 60, start: 0, duration: 0.5 }]);
    const events: string[] = [];
    p.subscribe((e) => events.push(e.type));
    p.play({ from: 0 });
    advance(1);
    expect(p.state).toBe('stopped');
    expect(events.filter((e) => e === 'end')).toHaveLength(1);
  });

  it('stop() silences chord previews too', async () => {
    const p = new LessonPlayer();
    await p.unlock();
    p.playChord([60, 64, 67], 9);
    const before = releases.n;
    p.stop();
    expect(releases.n).toBeGreaterThan(before);
  });
});

// iPad bug #25: iOS refused the first gesture (or interrupted the context) and the old one-shot
// unlock never tried again — the clock stood still at the first note, with no sound.
describe('LessonPlayer audio unlock', () => {
  beforeEach(() => {
    audio.state = 'suspended';
    audio.allowStart = true;
    audio.starts = 0;
    audio.listeners.length = 0;
  });

  it('retries on the next gesture when a gesture was refused', async () => {
    const p = new LessonPlayer();
    audio.allowStart = false;
    await p.unlock();
    expect(p.isUnlocked).toBe(false);
    audio.allowStart = true;
    await p.unlock();
    expect(audio.starts).toBe(2);
    expect(p.isUnlocked).toBe(true);
    await p.unlock(); // running → nothing to do
    expect(audio.starts).toBe(2);
  });

  it('resumes and reports it when the context is interrupted while playing', async () => {
    const p = new LessonPlayer();
    await p.unlock();
    p.load([{ pitch: 60, start: 0, duration: 5 }]);
    const running: boolean[] = [];
    p.subscribe((e) => e.type === 'audio' && running.push(e.running));
    p.play({ from: 0 });
    audio.allowStart = false;
    audio.state = 'interrupted';
    for (const l of audio.listeners) l();
    expect(audio.starts).toBe(2); // tried to resume on its own
    expect(running).toEqual([false]);
    expect(p.isUnlocked).toBe(false); // so the next gesture unlocks again
    p.stop();
  });
});
