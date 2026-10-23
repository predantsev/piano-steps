import type { Fragment, LessonNote, Tempo } from './lesson.ts';

/**
 * A "step" = everything that starts together: one key, or a chord pressed at once.
 * This is the unit the user repeats ("press C4, then E4+G4 together").
 */
export interface Step {
  index: number;
  time: number; // seconds — onset of the earliest note in the step
  notes: LessonNote[];
  pitches: number[]; // sorted ascending, unique
}

/** Group notes whose onsets are within `toleranceSec` into steps (chords). */
export function groupSteps(notes: readonly LessonNote[], toleranceSec = 0.045): Step[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const steps: Step[] = [];
  for (const n of sorted) {
    const last = steps[steps.length - 1];
    if (last && n.start - last.time <= toleranceSec) {
      last.notes.push(n);
      if (!last.pitches.includes(n.pitch)) last.pitches.push(n.pitch);
    } else {
      steps.push({ index: steps.length, time: n.start, notes: [n], pitches: [n.pitch] });
    }
  }
  for (const s of steps) s.pitches.sort((a, b) => a - b);
  return steps;
}

/** Notes whose onset falls inside [start, end). */
export function notesInRange(notes: readonly LessonNote[], start: number, end: number): LessonNote[] {
  return notes.filter((n) => n.start >= start - 1e-6 && n.start < end - 1e-6);
}

/** Notes sounding at time t (start <= t < start + duration). */
export function soundingAt(notes: readonly LessonNote[], t: number): LessonNote[] {
  return notes.filter((n) => n.start <= t && t < n.start + n.duration);
}

export function barSeconds(tempo: Tempo): number {
  const [num, den] = tempo.timeSignature ?? [4, 4];
  return num * (4 / den) * (60 / tempo.bpm);
}

/**
 * Split a lesson into practice fragments.
 * - With a tempo: chunks of whole bars, about `targetSec` long (at least one bar).
 * - Without: cut at the widest gap between steps near every `targetSec`.
 */
export function autoFragments(
  notes: readonly LessonNote[],
  opts: { tempo?: Tempo; targetSec?: number } = {},
): Fragment[] {
  const target = opts.targetSec ?? 6;
  const steps = groupSteps(notes);
  if (steps.length === 0) return [];
  const end = Math.max(...notes.map((n) => n.start + n.duration));

  if (opts.tempo) {
    const bar = barSeconds(opts.tempo);
    const barsPer = Math.max(1, Math.round(target / bar));
    const len = bar * barsPer;
    const out: Fragment[] = [];
    for (let s = 0, i = 1; s < end - 1e-6; s += len, i++) {
      const e = Math.min(s + len, end);
      if (notesInRange(notes, s, e + (e >= end ? 1e-3 : 0)).length) out.push(round({ start: s, end: e }));
    }
    return withTitles(out);
  }

  const cuts: number[] = [];
  let fragStart = steps[0].time;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].time - fragStart < target * 0.6) continue;
    // candidate window: steps between 0.6·target and 1.4·target from fragStart; cut at widest gap
    let best = -1;
    let bestGap = -1;
    for (let j = i; j < steps.length && steps[j].time - fragStart <= target * 1.4; j++) {
      const gap = steps[j].time - steps[j - 1].time;
      if (gap > bestGap) {
        bestGap = gap;
        best = j;
      }
    }
    if (best < 0) best = i;
    cuts.push(steps[best].time);
    fragStart = steps[best].time;
    i = best;
  }
  const bounds = [Math.min(steps[0].time, 0), ...cuts, end];
  const out: Fragment[] = [];
  for (let k = 0; k < bounds.length - 1; k++) out.push(round({ start: bounds[k], end: bounds[k + 1] }));
  return withTitles(out);
}

function round(f: Fragment): Fragment {
  return { ...f, start: Math.round(f.start * 1000) / 1000, end: Math.round(f.end * 1000) / 1000 };
}

function withTitles(fs: Fragment[]): Fragment[] {
  return fs.map((f, i) => ({ title: f.title ?? `#${i + 1}`, ...f }));
}

/** Seconds → "0:07.5" for compact timestamps. */
export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
