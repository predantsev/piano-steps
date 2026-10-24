import type { Hand, LessonNote } from '@piano-steps/core';
import { TIME_EPS, pitchName } from '@piano-steps/core';
import * as Tone from 'tone';

/**
 * Plays a lesson (or a slice of it) with a sampled grand piano.
 *
 * - Sound starts only after a user gesture (`unlock()`), which iOS/iPadOS requires. iOS may refuse a
 *   gesture or interrupt the context later (backgrounding, a call), so every gesture retries until the
 *   context is actually running; while it is not, the clock stands still and `audioRunning` is false.
 * - Until the samples have loaded, a soft synth stands in, so the first tap is never silent.
 * - `time` is lesson time in seconds *as heard*; read it in requestAnimationFrame to draw.
 * - Notes are handed to the audio graph by a short look-ahead scheduler, so pause/stop
 *   take effect within ~0.15 s instead of letting pre-scheduled notes ring on.
 * - A loop is scheduled seamlessly: the next pass is queued right behind the current one,
 *   so there is no gap or visual freeze at the wrap.
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

export type PlayerEvent =
  | { type: 'state'; state: PlayerState }
  | { type: 'loop' }
  | { type: 'end' }
  | { type: 'audio'; running: boolean };
type Listener = (e: PlayerEvent) => void;

const SALAMANDER = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4',
  'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'];
const LOOKAHEAD = 0.15; // seconds of audio scheduled ahead
const TICK_MS = 25;
const START_DELAY = 0.05; // seconds between play() and the first note, on the scheduling clock

/** One pass over the range: lesson time `from` sounds at AudioContext time `at` (scheduling clock). */
interface Segment {
  at: number;
  from: number;
}

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
  private segments: Segment[] = []; // passes queued so far; the last one is being scheduled
  private heardSeg = 0; // index of the pass currently audible
  private nextIdx = 0; // next note index to schedule in the last segment
  private runEnd = 0; // lesson time where every pass ends
  private pausedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watching = false;

  /**
   * Call from a user gesture (tap/click/key). Safe to call on every gesture: it does nothing once the
   * audio context is running, and tries again whenever it is not (refused gesture, iOS interruption).
   */
  async unlock(): Promise<void> {
    if (this.audioRunning && this.synth) return;
    // First thing in the gesture: iOS honours resume() only synchronously inside the handler.
    const started = Tone.start();
    this.primeOutput();
    this.watchContext();
    this.createInstruments();
    try {
      await started;
    } catch {
      /* refused — the next gesture tries again */
    }
  }

  /** The audio context is running, so the clock advances and notes sound. */
  get audioRunning(): boolean {
    return Tone.getContext().state === 'running';
  }

  /** A gesture created the instruments and the context is running. */
  get isUnlocked() {
    return !!this.synth && this.audioRunning;
  }

  load(notes: readonly LessonNote[]) {
    this.stop();
    this.notes = [...notes].sort((a, b) => a.start - b.start);
  }

  /** Current lesson time in seconds, as heard (look-ahead and output latency already accounted for). */
  get time(): number {
    if (this.state === 'playing') {
      const now = this.audibleNow();
      const i = this.heardIndex(now);
      const seg = this.segments[i];
      const t = seg.from + (now - seg.at) * this.opts.rate;
      return Math.min(Math.max(seg.from, t), this.runEnd);
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

  /** Stop playback and silence everything, including notes started with playChord/noteOn. */
  stop() {
    this.halt();
    this.pausedAt = this.opts.from;
    this.setState('stopped');
  }

  /** Silence every sounding note without changing the play state. */
  releaseAll() {
    this.sampler?.releaseAll();
    this.synth?.releaseAll();
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

  private createInstruments() {
    if (this.synth) return;
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

  /** Classic iOS unlock: start a silent one-sample buffer inside the gesture. */
  private primeOutput() {
    try {
      const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
      const src = raw.createBufferSource();
      src.buffer = raw.createBuffer(1, 1, raw.sampleRate);
      src.connect(raw.destination);
      src.start(0);
    } catch {
      /* not critical */
    }
  }

  /** Report running/not running, and try to resume after an interruption while playing. */
  private watchContext() {
    if (this.watching) return;
    this.watching = true;
    Tone.getContext().on('statechange', () => {
      const running = this.audioRunning;
      if (!running && this.state === 'playing') void Tone.start().catch(() => {});
      this.emit({ type: 'audio', running });
    });
  }

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

  /** Index of the pass that is audible at AudioContext time `now`. */
  private heardIndex(now: number): number {
    let i = this.heardSeg;
    while (i + 1 < this.segments.length && this.segments[i + 1].at <= now) i++;
    return i;
  }

  private segEnd(s: Segment): number {
    return s.at + (this.runEnd - s.from) / this.opts.rate;
  }

  private firstNoteFrom(t: number): number {
    const i = this.notes.findIndex((n) => n.start >= t - TIME_EPS);
    return i < 0 ? this.notes.length : i;
  }

  private run(fromLesson: number) {
    const lastEnd = this.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
    this.runEnd = Math.min(this.opts.to, lastEnd);
    if (this.runEnd <= fromLesson + TIME_EPS) {
      // Nothing to play in this range (empty fragment, or resumed at its very end): end cleanly
      // instead of looping on an empty pass.
      this.halt();
      this.pausedAt = this.opts.from;
      this.setState('stopped');
      this.emit({ type: 'end' });
      return;
    }
    this.segments = [{ at: Tone.now() + START_DELAY, from: fromLesson }];
    this.heardSeg = 0;
    this.nextIdx = this.firstNoteFrom(fromLesson);
    this.setState('playing');
    this.tick();
    if (this.state === 'playing') this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    const { rate, muted, hands, to, loop } = this.opts;
    const horizon = Tone.now() + LOOKAHEAD; // scheduling clock
    const inst = muted ? null : this.instrument();

    // Hand over every attack due before the next ticks; queue the next pass when looping.
    for (;;) {
      const seg = this.segments[this.segments.length - 1];
      while (this.nextIdx < this.notes.length) {
        const n = this.notes[this.nextIdx];
        if (n.start >= Math.min(to, this.runEnd) - TIME_EPS) {
          this.nextIdx = this.notes.length;
          break;
        }
        const at = seg.at + (n.start - seg.from) / rate;
        if (at > horizon) break;
        this.nextIdx++;
        if (!inst || (hands && n.hand && !hands.includes(n.hand))) continue;
        inst.triggerAttackRelease(
          pitchName(n.pitch),
          Math.max(0.05, Math.min(n.duration, to - n.start) / rate),
          Math.max(at, Tone.now()),
          n.velocity ?? 0.8,
        );
      }
      if (!loop || this.nextIdx < this.notes.length) break;
      const nextAt = this.segEnd(seg);
      if (nextAt > horizon) break;
      this.segments.push({ at: nextAt, from: this.opts.from });
      this.nextIdx = this.firstNoteFrom(this.opts.from);
    }

    // Follow what is heard: announce each wrap once, end after the last pass.
    const now = this.audibleNow();
    const heard = this.heardIndex(now);
    while (this.heardSeg < heard) {
      this.heardSeg++;
      this.emit({ type: 'loop' });
    }
    if (this.heardSeg > 0) {
      this.segments.splice(0, this.heardSeg);
      this.heardSeg = 0;
    }
    if (!loop && now >= this.segEnd(this.segments[0])) {
      this.halt();
      this.pausedAt = this.opts.from;
      this.setState('stopped');
      this.emit({ type: 'end' });
    }
  }

  private halt() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.releaseAll();
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
