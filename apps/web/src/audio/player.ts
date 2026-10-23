import type { Hand, LessonNote } from '@piano-steps/core';
import { TIME_EPS, pitchName } from '@piano-steps/core';
import * as Tone from 'tone';

/**
 * Plays a lesson (or a slice of it) with a sampled grand piano.
 *
 * - Sound starts only after a user gesture (`unlock()`), which iOS/iPadOS requires.
 * - Until the samples have loaded, a soft synth stands in, so the first tap is never silent.
 * - `time` is lesson time in seconds; read it in requestAnimationFrame to draw.
 * - Notes are handed to the audio graph by a short look-ahead scheduler, so pause/stop
 *   take effect within ~0.15 s instead of letting pre-scheduled notes ring on.
 */

export type PlayerState = 'stopped' | 'playing' | 'paused';

export interface PlayOptions {
  from?: number;
  to?: number;
  loop?: boolean;
  /** 1 = original tempo, 0.5 = half speed. */
  rate?: number;
  /** Only these hands make sound (others are still "played" for visuals). */
  hands?: Hand[];
  /** Run the clock without sound (e.g. "watch only"). */
  muted?: boolean;
}

export type PlayerEvent = { type: 'state'; state: PlayerState } | { type: 'loop' } | { type: 'end' };
type Listener = (e: PlayerEvent) => void;

const SALAMANDER = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4',
  'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'];
const LOOKAHEAD = 0.15; // seconds of audio scheduled ahead
const TICK_MS = 25;

export class LessonPlayer {
  state: PlayerState = 'stopped';
  samplesLoaded = false;
  private notes: LessonNote[] = [];
  private sampler: Tone.Sampler | null = null;
  private synth: Tone.PolySynth | null = null;
  private listeners = new Set<Listener>();
  private opts: Required<Omit<PlayOptions, 'hands'>> & { hands?: Hand[] } = {
    from: 0, to: Infinity, loop: false, rate: 1, muted: false,
  };
  private startedAt = 0; // audio-clock time when the current run started
  private startLesson = 0; // lesson time at startedAt
  private pausedAt = 0;
  private nextIdx = 0; // next note index to schedule
  private runEnd = 0; // lesson time where this run ends
  private timer: ReturnType<typeof setInterval> | null = null;
  private unlocked = false;

  /** Call from a user gesture (tap/click). Safe to call many times. */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    this.unlocked = true;
    await Tone.start();
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.8 },
      volume: -10,
    }).toDestination();
    const urls: Record<string, string> = {};
    for (const n of SAMPLE_NOTES) urls[n] = `${n.replace('#', 's')}.mp3`;
    this.sampler = new Tone.Sampler({
      urls,
      baseUrl: SALAMANDER,
      release: 1,
      onload: () => {
        this.samplesLoaded = true;
      },
    }).toDestination();
  }

  get isUnlocked() {
    return this.unlocked;
  }

  load(notes: readonly LessonNote[]) {
    this.stop();
    this.notes = [...notes].sort((a, b) => a.start - b.start);
  }

  /** Current lesson time in seconds, as heard (look-ahead and output latency already accounted for). */
  get time(): number {
    if (this.state === 'playing') {
      const t = this.startLesson + (this.audibleNow() - this.startedAt) * this.opts.rate;
      return Math.max(this.startLesson, t);
    }
    if (this.state === 'paused') return this.pausedAt;
    return this.opts.from;
  }

  get rate() {
    return this.opts.rate;
  }

  get options(): Readonly<PlayOptions> {
    return this.opts;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  play(options: PlayOptions = {}) {
    this.halt();
    this.opts = {
      from: options.from ?? 0,
      to: options.to ?? Infinity,
      loop: options.loop ?? false,
      rate: options.rate ?? 1,
      muted: options.muted ?? false,
      hands: options.hands,
    };
    this.run(this.opts.from);
  }

  /** Resume after pause (or start from `from`). */
  resume() {
    this.run(this.state === 'paused' ? this.pausedAt : this.opts.from);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.pausedAt = this.time;
    this.halt();
    this.setState('paused');
  }

  stop() {
    this.halt();
    this.pausedAt = this.opts.from;
    this.setState('stopped');
  }

  /** Change speed on the fly (keeps the current position). */
  setRate(rate: number) {
    if (this.state === 'playing') {
      const t = this.time;
      this.halt();
      this.opts.rate = rate;
      this.run(t);
    } else this.opts.rate = rate;
  }

  /** Sound a set of keys right now (preview a chord / a step). */
  playChord(pitches: number[], durationSec = 0.8, velocity = 0.8) {
    const inst = this.instrument();
    if (!inst || pitches.length === 0) return;
    inst.triggerAttackRelease(pitches.map((p) => pitchName(p)), durationSec, Tone.now() + 0.01, velocity);
  }

  /** Key down / up from the on-screen keyboard. */
  noteOn(pitch: number, velocity = 0.8) {
    this.instrument()?.triggerAttack(pitchName(pitch), Tone.now(), velocity);
  }
  noteOff(pitch: number) {
    this.instrument()?.triggerRelease(pitchName(pitch), Tone.now() + 0.05);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private instrument(): Tone.Sampler | Tone.PolySynth | null {
    return this.samplesLoaded ? this.sampler : this.synth;
  }

  /**
   * Two clocks, both in AudioContext seconds:
   * - scheduling: `Tone.now()` = currentTime + Tone's look-ahead — when an attack handed over now plays;
   * - audible: currentTime − output latency — what the listener hears right now.
   * `time` (what the UI draws) follows the audible clock, so keys light up with the sound.
   */
  private audibleNow(): number {
    const ctx = Tone.getContext();
    const raw = ctx.rawContext as unknown as { outputLatency?: number; baseLatency?: number };
    return ctx.immediate() - (raw.outputLatency || raw.baseLatency || 0);
  }

  private run(fromLesson: number) {
    const lastEnd = this.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
    this.runEnd = Math.min(this.opts.to, lastEnd);
    this.startedAt = Tone.now() + 0.05;
    this.startLesson = fromLesson;
    this.nextIdx = this.notes.findIndex((n) => n.start >= fromLesson - TIME_EPS);
    if (this.nextIdx < 0) this.nextIdx = this.notes.length;
    this.setState('playing');
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    const { rate, muted, hands, to } = this.opts;
    // schedule on the scheduling clock: everything that must be handed over before the next ticks
    const horizon = this.startLesson + (Tone.now() + LOOKAHEAD - this.startedAt) * rate;
    const inst = muted ? null : this.instrument();
    while (this.nextIdx < this.notes.length) {
      const n = this.notes[this.nextIdx];
      if (n.start > horizon || n.start >= to - TIME_EPS) break;
      this.nextIdx++;
      if (!inst || (hands && n.hand && !hands.includes(n.hand))) continue;
      const at = this.startedAt + (n.start - this.startLesson) / rate;
      inst.triggerAttackRelease(
        pitchName(n.pitch),
        Math.max(0.05, Math.min(n.duration, to - n.start) / rate),
        Math.max(at, Tone.now()),
        n.velocity ?? 0.8,
      );
    }
    if (this.time >= this.runEnd) {
      if (this.opts.loop) {
        this.halt(false);
        this.emit({ type: 'loop' });
        this.run(this.opts.from);
      } else {
        this.halt();
        this.pausedAt = this.opts.from;
        this.setState('stopped');
        this.emit({ type: 'end' });
      }
    }
  }

  private halt(release = true) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (release) {
      this.sampler?.releaseAll();
      this.synth?.releaseAll();
    }
  }

  private setState(s: PlayerState) {
    if (this.state === s) return;
    this.state = s;
    this.emit({ type: 'state', state: s });
  }

  private emit(e: PlayerEvent) {
    for (const l of this.listeners) l(e);
  }
}
