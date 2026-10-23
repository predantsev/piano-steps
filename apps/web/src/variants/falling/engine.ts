import type { LessonNote, Step } from '@piano-steps/core';
import type { PlayerEvent, PlayOptions } from '../../audio/player.ts';
import {
  covers,
  period,
  playerHands,
  stepAtOrAfter,
  waitSteps,
  windowNotes,
  type Hands,
  type Span,
} from './timeline.ts';

/** The part of `LessonPlayer` the practice engine uses (a fake one in the tests). */
export interface PlayerLike {
  readonly state: 'stopped' | 'playing' | 'paused';
  readonly time: number;
  play(options?: PlayOptions): void;
  stop(): void;
  /** Silence every sounding note (wait mode's `playChord` steps too) without changing the state. */
  releaseAll(): void;
  setRate(rate: number): void;
  playChord(pitches: number[], durationSec?: number, velocity?: number): void;
  subscribe(fn: (e: PlayerEvent) => void): () => void;
}

/**
 * - idle     — at the fragment start, nothing moving
 * - preroll  — the short lead-in before a run: bars fall in, no sound yet
 * - playing  — continuous mode, the player is running the fragment
 * - paused   — continuous mode, frozen mid-fragment
 * - waiting  — wait mode, a step sits on the now-line until Next / the right keys
 * - falling  — wait mode, moving from one step to the next
 * - done     — a run finished and looping is off
 */
export type Phase = 'idle' | 'preroll' | 'playing' | 'paused' | 'waiting' | 'falling' | 'done';

export interface PracticeOptions {
  /** Speed, 1 = original tempo. */
  rate: number;
  hands: Hands;
  loop: boolean;
  wait: boolean;
  /** Sound on (off = watch only). */
  sound: boolean;
}

export interface EngineHooks {
  /** A full pass over the fragment finished (loop wrap or end). */
  onAttempt(): void;
  /** Phase / step / feedback changed — re-render the controls. */
  onChange(): void;
  /** Wall clock in ms (performance.now by default). */
  now?(): number;
  /**
   * Seconds from asking the audio graph for a sound to hearing it (Tone's look-ahead + output
   * latency). `player.time` already follows what is heard, so this is never subtracted from it; it
   * only says how early to *ask*: a wait-mode step is sounded this much before it lands, and a run
   * is started this much before the lead-in reaches the fragment start.
   */
  audioLead?(): number;
}

const EPS = 1e-3;
/** Real seconds of lead-in before a run that starts at the fragment start. */
export const PREROLL_SEC = 1.5;
const WRONG_FLASH_MS = 650;
/** `LessonPlayer` schedules a run's first note this long after `play()` (player.ts START_DELAY). */
const PLAYER_START_DELAY = 0.05;
/** …and a `playChord` this long after the call (player.ts `Tone.now() + 0.01`). */
const CHORD_DELAY = 0.01;
/** The bridge stops this far short of the run start, so the first chord is not lit before it sounds. */
const BRIDGE_GAP = 1e-3;

/**
 * Practice state machine for the falling-notes screen.
 *
 * Continuous mode is driven by `LessonPlayer` (its scheduler plays the fragment, optionally looped).
 * Wait mode runs its own clock: it moves from step to step at the chosen speed and sounds each step
 * with `playChord()` when it reaches the now-line, so held notes ring for their written length
 * instead of being cut by the player's stop/start between steps.
 */
export class PracticeEngine {
  phase: Phase = 'idle';
  span: Span = { start: 0, end: 0 };
  /** The window's notes, clipped at its end. */
  notes: LessonNote[] = [];
  /** Steps of the practised hand(s) — wait-mode stops. */
  steps: Step[] = [];
  /** Wait mode: the step on the now-line (or being fallen to). */
  stepIdx = 0;
  /** Correct keys pressed since the current step arrived. */
  readonly pressed = new Set<number>();
  /** A wrong key, flashed briefly. */
  wrong: { pitch: number; until: number } | null = null;
  opts: PracticeOptions;

  private cursor = 0;
  private runFrom = 0;
  private lastVisual = 0;
  private fall: { from: number; to: number; t0: number; target: number; wraps: boolean; sounded: boolean } | null = null;
  private preroll: { from: number; t0: number } | null = null;
  /**
   * Drives the drawing while a run is starting: `player.time` sits on the run start until its first
   * note is heard, so the lane keeps moving on the engine clock from `from` up to just short of `to`
   * (the run start, unwrapped) and hands over once the player's clock moves.
   */
  private bridge: { from: number; to: number; t0: number } | null = null;
  private unsub: (() => void) | null = null;
  private readonly lessonEnd: number;

  constructor(
    private readonly player: PlayerLike,
    private readonly lessonNotes: readonly LessonNote[],
    opts: PracticeOptions,
    private readonly hooks: EngineHooks,
  ) {
    this.opts = { ...opts };
    this.lessonEnd = lessonNotes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  }

  /** Start listening to the player. Returns the detach function (also stops the sound). */
  attach(): () => void {
    this.unsub?.();
    this.unsub = this.player.subscribe((e) => this.onPlayerEvent(e));
    return () => {
      this.unsub?.();
      this.unsub = null;
      this.halt();
    };
  }

  // ── setup ────────────────────────────────────────────────────────────────

  setSpan(span: Span) {
    this.halt();
    // Fragment bounds come snapped to onsets from core (#8). A fragment past the last note, or with
    // end <= start, is an empty span: no notes, no steps, and Play stays off.
    this.span = { start: span.start, end: Math.max(span.start, Math.min(span.end, this.lessonEnd)) };
    this.notes = windowNotes(this.lessonNotes, this.span);
    this.steps = waitSteps(this.notes, this.opts.hands);
    this.cursor = this.span.start;
    if (this.opts.wait) this.waitAt(0);
    else this.setPhase('idle');
  }

  setOptions(patch: Partial<PracticeOptions>) {
    const prev = this.opts;
    const next = { ...prev, ...patch };
    const changed = (k: keyof PracticeOptions) => next[k] !== prev[k];
    const v = this.visualTime();
    this.opts = next;

    if (changed('hands')) this.steps = waitSteps(this.notes, next.hands);

    if (changed('wait')) {
      // at rest, or already past the end (wait mode's fall into the next pass): start from the top
      const wasFresh = this.phase === 'idle' || this.phase === 'done' || v >= this.span.end - EPS;
      this.halt();
      if (next.wait) this.waitAt(wasFresh ? 0 : stepAtOrAfter(this.steps, this.clampToSpan(v)));
      else {
        this.cursor = wasFresh ? this.span.start : this.clampToSpan(v);
        this.setPhase(this.cursor <= this.span.start + EPS ? 'idle' : 'paused');
      }
      return;
    }

    switch (this.phase) {
      case 'playing':
        if (changed('hands') || changed('sound') || changed('loop')) this.startRun(v);
        else if (changed('rate')) this.player.setRate(next.rate);
        break;
      case 'falling':
        if (changed('hands')) {
          this.halt();
          this.waitAt(stepAtOrAfter(this.steps, this.clampToSpan(v)));
        } else if (changed('rate') && this.fall) {
          this.fall.from = v;
          this.fall.t0 = this.now();
        }
        break;
      case 'waiting':
        if (changed('hands')) this.waitAt(stepAtOrAfter(this.steps, this.cursor));
        break;
      case 'preroll':
        if (changed('rate') && this.preroll) {
          // keep the remaining lead-in proportional to the new speed
          this.preroll = { from: v, t0: this.now() };
        }
        break;
    }
    this.hooks.onChange();
  }

  // ── time ─────────────────────────────────────────────────────────────────

  /** Lesson time to draw at (may run past `span.end` while falling into the next loop pass). */
  visualTime(): number {
    const { rate } = this.opts;
    switch (this.phase) {
      case 'playing':
        if (this.player.state !== 'playing') return this.cursor;
        if (this.bridge && this.player.time <= this.runFrom + EPS)
          return Math.min(this.bridge.to - BRIDGE_GAP, this.bridge.from + this.elapsed(this.bridge.t0) * rate);
        return this.player.time;
      case 'falling':
        if (!this.fall) return this.cursor;
        return Math.min(this.fall.to, this.fall.from + this.elapsed(this.fall.t0) * rate);
      case 'preroll':
        if (!this.preroll) return this.cursor;
        return Math.min(this.span.start, this.preroll.from + this.elapsed(this.preroll.t0) * rate);
      default:
        return this.cursor;
    }
  }

  /** Advance the engine's own clocks. Call once per animation frame. */
  tick() {
    const v = this.visualTime();
    this.lastVisual = v;
    if (this.phase === 'falling' && this.fall) {
      const f = this.fall;
      if (!f.sounded && (f.to - v) / this.opts.rate <= this.audioLead() + CHORD_DELAY) {
        f.sounded = true;
        this.soundStep(f.target);
      }
      if (v >= f.to - 1e-9) this.arrive();
    } else if (this.phase === 'preroll' && v >= this.span.start - (this.audioLead() + PLAYER_START_DELAY) * this.opts.rate - 1e-9) {
      // start the player early by its start-up delay, so the first note is heard as the lane reaches it
      this.startRun(this.span.start, { from: v, to: this.span.start });
    } else if (this.phase === 'playing' && this.bridge && this.player.state === 'playing' && this.player.time > this.runFrom + EPS) {
      this.bridge = null; // the player's clock has taken over
    }
    if (this.wrong && this.now() > this.wrong.until) {
      this.wrong = null;
      this.hooks.onChange();
    }
  }

  // ── actions ──────────────────────────────────────────────────────────────

  /** The big button / Space: play ⇄ pause, or Next in wait mode. */
  primary() {
    if (this.opts.wait) return this.next();
    switch (this.phase) {
      case 'playing':
      case 'preroll':
        return this.pause();
      case 'paused':
        return this.startRun(this.cursor);
      default:
        return this.start();
    }
  }

  /** Play the fragment from its start (continuous mode), with a short lead-in. */
  start() {
    if (!this.notes.length) return;
    this.halt();
    this.cursor = this.span.start;
    this.preroll = { from: this.span.start - PREROLL_SEC * this.opts.rate, t0: this.now() };
    this.setPhase('preroll');
  }

  pause() {
    if (this.phase === 'preroll') {
      this.halt();
      this.cursor = this.span.start;
      return this.setPhase('idle');
    }
    if (this.phase !== 'playing') return;
    const v = this.visualTime();
    this.halt();
    this.cursor = this.clampToSpan(v);
    this.setPhase('paused');
  }

  /** Back to the fragment start (keeps playing if it was playing). */
  restart() {
    const wasRunning = this.phase === 'playing' || this.phase === 'preroll';
    this.halt();
    this.cursor = this.span.start;
    if (this.opts.wait) this.waitAt(0);
    else if (wasRunning) this.start();
    else this.setPhase('idle');
  }

  /** Wait mode: "I played it — go on". */
  next() {
    switch (this.phase) {
      case 'waiting':
        return this.startFall(this.stepIdx);
      case 'falling':
        return this.arrive();
      case 'done':
        return this.waitAt(0);
      default:
        return this.waitAt(stepAtOrAfter(this.steps, this.cursor));
    }
  }

  /** Replay the step on the now-line (wait mode), even with the sound toggle off. */
  hearStep() {
    if (this.phase === 'waiting') this.soundStep(this.stepIdx, true);
  }

  /** A key pressed on the on-screen / computer keyboard. In wait mode, the right keys advance. */
  noteOn(pitch: number) {
    if (!this.opts.wait || this.phase !== 'waiting') return;
    const step = this.steps[this.stepIdx];
    if (!step) return;
    if (step.pitches.includes(pitch)) {
      this.pressed.add(pitch);
      if (covers(step.pitches, this.pressed)) return this.startFall(this.stepIdx);
    } else {
      this.wrong = { pitch, until: this.now() + WRONG_FLASH_MS };
    }
    this.hooks.onChange();
  }

  /** The step waiting on the line (wait mode) and the one after it. */
  get waitingStep(): Step | null {
    return this.phase === 'waiting' ? (this.steps[this.stepIdx] ?? null) : null;
  }
  /** Wait mode: the step after the waiting one (the first again when looping) — the keyboard's `next` ring. */
  get upcomingStep(): Step | null {
    if (this.phase !== 'waiting') return null;
    return this.steps[this.stepIdx + 1] ?? (this.opts.loop ? (this.steps[0] ?? null) : null);
  }
  get targetStep(): Step | null {
    if (this.phase === 'falling' && this.fall) return this.steps[this.fall.target] ?? null;
    return null;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private startRun(from: number, bridge: { from: number; to: number } = { from, to: from }) {
    this.fall = null;
    this.preroll = null;
    this.runFrom = from;
    if (!this.notes.length) {
      this.bridge = null;
      this.cursor = this.span.start;
      return this.setPhase('idle');
    }
    const fromStart = Math.abs(from - this.span.start) < EPS;
    this.bridge = { ...bridge, t0: this.now() };
    // 'playing' before play(): the player emits 'end' synchronously when there is nothing to play
    this.setPhase('playing');
    this.player.play({
      from,
      to: this.span.end,
      loop: this.opts.loop && fromStart,
      rate: this.opts.rate,
      hands: playerHands(this.opts.hands),
      muted: !this.opts.sound,
    });
  }

  private startFall(i: number) {
    const n = this.steps.length;
    if (!n) return;
    const last = i >= n - 1;
    const from = this.steps[i].time;
    const to = last ? (this.opts.loop ? this.steps[0].time + period(this.span) : this.span.end) : this.steps[i + 1].time;
    this.pressed.clear();
    this.fall = { from, to, t0: this.now(), target: last ? 0 : i + 1, wraps: last, sounded: last && !this.opts.loop };
    this.setPhase('falling');
  }

  private arrive() {
    const f = this.fall;
    if (!f) return;
    this.fall = null;
    if (!f.sounded) this.soundStep(f.target);
    if (f.wraps) {
      this.hooks.onAttempt();
      if (!this.opts.loop) {
        this.cursor = this.span.start; // show the fragment ready to go again
        return this.setPhase('done');
      }
    }
    this.waitAt(f.target);
  }

  private waitAt(i: number) {
    this.fall = null;
    this.preroll = null;
    this.pressed.clear();
    this.wrong = null;
    this.stepIdx = Math.max(0, Math.min(i, this.steps.length - 1));
    this.cursor = this.steps[this.stepIdx]?.time ?? this.span.start;
    this.setPhase('waiting');
  }

  private soundStep(i: number, force = false) {
    if (!this.opts.sound && !force) return;
    const step = this.steps[i];
    if (!step) return;
    for (const n of step.notes) this.player.playChord([n.pitch], Math.max(0.15, n.duration / this.opts.rate), n.velocity ?? 0.8);
  }

  /** Stop whatever runs and silence it — wait-mode steps too (they ring on with the player stopped). */
  private halt() {
    this.fall = null;
    this.preroll = null;
    this.bridge = null;
    if (this.player.state !== 'stopped') this.player.stop();
    else this.player.releaseAll();
  }

  private onPlayerEvent(e: PlayerEvent) {
    if (this.phase === 'playing') {
      if (e.type === 'loop') this.hooks.onAttempt();
      else if (e.type === 'end') {
        this.hooks.onAttempt();
        // A run resumed mid-fragment ends at the fragment end; with loop on, go on from the top (the
        // lane keeps falling into the next pass meanwhile). A run from the start loops inside the
        // player, so an 'end' there means it had nothing to play — never restart that (no recursion).
        if (this.opts.loop && this.runFrom > this.span.start + EPS)
          this.startRun(this.span.start, { from: this.span.end, to: this.span.end });
        else {
          this.cursor = this.span.start; // show the fragment ready to go again
          this.setPhase('done');
        }
        return;
      } else if (e.type === 'state' && e.state !== 'playing') {
        // Stopped from outside (e.g. the shell): 'end' would follow synchronously if it were ours.
        queueMicrotask(() => {
          if (this.phase === 'playing' && this.player.state !== 'playing') {
            this.cursor = this.clampToSpan(this.lastVisual);
            this.setPhase('paused');
          }
        });
      }
    }
    this.hooks.onChange();
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.hooks.onChange();
  }

  private clampToSpan(t: number): number {
    return Math.min(this.span.end, Math.max(this.span.start, t));
  }

  private now(): number {
    return this.hooks.now ? this.hooks.now() : performance.now();
  }

  private elapsed(t0: number): number {
    return Math.max(0, (this.now() - t0) / 1000);
  }

  private audioLead(): number {
    return this.hooks.audioLead ? this.hooks.audioLead() : 0;
  }
}
