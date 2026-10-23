import {
  groupSteps,
  notesInRange,
  TIME_EPS,
  type Fragment,
  type FragmentProgress,
  type Hand,
  type LessonNote,
  type ProgressStatus,
  type Tempo,
} from '@piano-steps/core';

/**
 * Pure logic of the "cards" variant: steps of a fragment split into hand lanes, the
 * time-proportional strip layout, and the small rules (what to say, when a step is "played").
 * No React, no DOM — unit-tested in model.test.ts.
 */

/** Notes without a hand are shown (and coloured) as right hand. */
export const handOf = (n: LessonNote): Hand => n.hand ?? 'R';

export interface LaneChip {
  hand: Hand;
  /** Sorted ascending, unique. Rendered top = highest, like on a staff. */
  pitches: number[];
  notes: LessonNote[];
  /** Longest note of this hand in the step, seconds — drives the "hold" bar. */
  holdSec: number;
  /** pitch → finger number, when the lesson has fingering. */
  fingers: Map<number, number>;
}

export interface CardStep {
  index: number;
  time: number;
  /** Seconds until the next step (or the fragment end) — drives the card width. */
  slotSec: number;
  pitches: number[];
  notes: LessonNote[];
  lanes: Partial<Record<Hand, LaneChip>>;
}

export function buildSteps(notes: readonly LessonNote[], fragment: Fragment): CardStep[] {
  // Bounds are snapped to note onsets in core (prepareLesson), so the plain window is exact.
  const steps = groupSteps(notesInRange(notes, fragment.start, fragment.end));
  return steps.map((s, i) => {
    const next = steps[i + 1];
    const end = next ? next.time : Math.max(fragment.end, s.time + 0.05);
    const lanes: Partial<Record<Hand, LaneChip>> = {};
    for (const n of s.notes) {
      const h = handOf(n);
      const lane: LaneChip = (lanes[h] ??= {
        hand: h,
        pitches: [] as number[],
        notes: [] as LessonNote[],
        holdSec: 0,
        fingers: new Map<number, number>(),
      });
      lane.notes.push(n);
      if (!lane.pitches.includes(n.pitch)) lane.pitches.push(n.pitch);
      lane.holdSec = Math.max(lane.holdSec, n.duration);
      if (n.finger !== undefined) lane.fingers.set(n.pitch, n.finger);
    }
    for (const l of Object.values(lanes)) l.pitches.sort((a, b) => a - b);
    return { index: i, time: s.time, slotSec: Math.max(0.05, end - s.time), pitches: s.pitches, notes: s.notes, lanes };
  });
}

/** Does the lesson use the left hand at all? (Decides whether the strip shows a second lane.) */
export function lessonHasLeft(notes: readonly LessonNote[]): boolean {
  return notes.some((n) => n.hand === 'L');
}

/** Largest chord per hand in these steps (≥ 1), to size the lanes. */
export function maxChord(steps: readonly CardStep[]): Record<Hand, number> {
  const m: Record<Hand, number> = { R: 1, L: 1 };
  for (const s of steps) for (const h of ['R', 'L'] as const) m[h] = Math.max(m[h], s.lanes[h]?.pitches.length ?? 0);
  return m;
}

// ── strip layout ───────────────────────────────────────────────────────────

export interface StripLayout {
  xs: number[];
  ws: number[];
  total: number;
  /** Lesson time → x on the track (piecewise linear through the cards, clamped to the track). */
  xAt(t: number): number;
}

/**
 * Width of each card ∝ time to the next step, clamped to [minW, maxW], scaled so the whole
 * fragment fits `width` when it can. When even minW-wide cards overflow, the scale makes a
 * typical step minW wide and the track is wider than the viewport (the strip then slides).
 */
export function layoutStrip(
  steps: readonly Pick<CardStep, 'time' | 'slotSec'>[],
  width: number,
  opts: { minW?: number; maxW?: number } = {},
): StripLayout {
  const minW = opts.minW ?? 72;
  const maxW = opts.maxW ?? 320;
  const n = steps.length;
  const dts = steps.map((s) => s.slotSec);
  const wFor = (k: number) => dts.map((d) => Math.min(maxW, Math.max(minW, d * k)));
  const sum = (ws: number[]) => ws.reduce((a, b) => a + b, 0);

  let k: number;
  if (n === 0) k = 0;
  else if (n * minW >= width) {
    const sorted = [...dts].sort((a, b) => a - b);
    k = minW / sorted[Math.floor(n / 2)];
  } else {
    let lo = 0;
    let hi = 1;
    while (sum(wFor(hi)) < width && hi < 1e7) hi *= 2;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (sum(wFor(mid)) <= width) lo = mid;
      else hi = mid;
    }
    k = lo;
  }
  const ws = wFor(k);
  const xs: number[] = [];
  let x = 0;
  for (const w of ws) {
    xs.push(x);
    x += w;
  }
  const total = x;
  const xAt = (t: number): number => {
    if (n === 0) return 0;
    if (t <= steps[0].time) return 0;
    for (let i = 0; i < n; i++) {
      const s = steps[i];
      if (t < s.time + s.slotSec || i === n - 1) {
        const frac = (t - s.time) / s.slotSec;
        return Math.min(total, xs[i] + frac * ws[i]);
      }
    }
    return total;
  };
  return { xs, ws, total, xAt };
}

/** Horizontal offset of the track so the card `index` sits ~1/3 from the left; 0 when it all fits. */
export function trackOffset(layout: StripLayout, viewport: number, index: number): number {
  if (layout.total <= viewport) return Math.max(0, (viewport - layout.total) / 2);
  const i = Math.min(index, layout.xs.length - 1);
  const center = i < 0 ? 0 : layout.xs[i] + layout.ws[i] / 2;
  return Math.min(0, Math.max(viewport - layout.total, viewport * 0.35 - center));
}

// ── step semantics ─────────────────────────────────────────────────────────

/** Index of the step sounding at time t (last onset ≤ t), or -1 before the first one. */
export function stepAt(steps: readonly Pick<CardStep, 'time'>[], t: number): number {
  let idx = -1;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].time <= t + TIME_EPS) idx = i;
    else break;
  }
  return idx;
}

/**
 * A note must outlast the next onset by more than this to count as "keep holding": transcribed
 * legato often overlaps the next note by a few ms, which the player should not be told to hold.
 */
export const HOLD_MIN_SEC = 0.02;

/** Notes started in an earlier step of the fragment that still sound when `step` starts ("keep holding"). */
export function heldOver(steps: readonly CardStep[], index: number): LessonNote[] {
  const s = steps[index];
  if (!s) return [];
  const out: LessonNote[] = [];
  for (let i = 0; i < index; i++)
    for (const n of steps[i].notes)
      if (n.start + n.duration > s.time + HOLD_MIN_SEC && !s.pitches.includes(n.pitch)) out.push(n);
  return out;
}

export type StepKind = 'single' | 'chord' | 'hands';

/** What the caption says: one key, a one-hand chord, or both hands together. */
export function stepKind(step: CardStep): StepKind {
  if (step.lanes.R && step.lanes.L) return 'hands';
  return step.pitches.length > 1 ? 'chord' : 'single';
}

/**
 * Optional on-screen / computer-keyboard check: the step counts as played once every one of its
 * keys has been pressed since the step became current (order inside a chord does not matter —
 * forgiving on purpose, a mouse can press only one key at a time).
 */
export function isStepPlayed(pressed: ReadonlySet<number>, step: Pick<CardStep, 'pitches'>): boolean {
  return step.pitches.length > 0 && step.pitches.every((p) => pressed.has(p));
}

export function fragmentStatus(progress: readonly FragmentProgress[], position: number): ProgressStatus {
  return progress.find((p) => p.fragmentPosition === position)?.status ?? 'new';
}

export function masteredCount(progress: readonly FragmentProgress[], fragmentCount: number): number {
  return progress.filter((p) => p.status === 'mastered' && p.fragmentPosition < fragmentCount).length;
}

export const SPEEDS = [0.25, 0.5, 0.75, 1] as const;

/** Metronome grid for "play along": one tick per time-signature unit (♩ in 4/4, ♪ in 3/8). */
export function metronome(tempo: Tempo | undefined): { tickSec: number; perBar: number } | null {
  if (!tempo) return null;
  const [num, den] = tempo.timeSignature ?? [4, 4];
  return { tickSec: (60 / tempo.bpm) * (4 / den), perBar: num };
}

type Metronome = { tickSec: number; perBar: number };

/** Tick index on the lesson's beat grid: bars counted from t = 0, as core `autoFragments` assumes. */
export function tickIndex(t: number, tickSec: number): number {
  return Math.floor(t / tickSec + 1e-3);
}

/**
 * Bar accent. Ticks sit on the lesson grid; the bar phase comes from the fragment's own start tick
 * (`barTick`), because a fragment is cut on a bar line while the lesson may begin with a pickup
 * (Für Elise: 3/8 with a one-eighth upbeat). The format has no pickup field, so a fragment that
 * itself starts on a pickup (Für Elise "Motif") is still accented one tick early.
 */
export function isAccent(k: number, perBar: number, barTick = 0): boolean {
  const d = k - barTick;
  return ((d % perBar) + perBar) % perBar === 0;
}

/**
 * Lesson time where a play-along run starts: one bar before the grid tick at (or just before) the
 * fragment start, so the first tick heard is a bar downbeat. Without a tempo there is no grid:
 * 1.5 s of wall-clock get-ready time, whatever the speed.
 */
export function countInFrom(fragmentStart: number, metro: Metronome | null, rate: number): number {
  if (!metro) return fragmentStart - 1.5 * rate;
  return (tickIndex(fragmentStart, metro.tickSec) - metro.perBar) * metro.tickSec;
}
