import { groupSteps, type LessonNote, type Step } from '@piano-steps/core';

/** Which hand(s) the user is practising. The other hand is dimmed (bars) and muted (sound). */
export type Hands = 'both' | 'R' | 'L';

/** A time window of the lesson: a fragment, or the whole lesson. Seconds, end exclusive. */
export interface Span {
  start: number;
  end: number;
}

/** A note placed on the (possibly looping) timeline of the lane. */
export interface Bar {
  note: LessonNote;
  /** Onset / release in "unwrapped" time: iteration k of a loop is shifted by k · period. */
  start: number;
  end: number;
  iteration: number;
  active: boolean;
}

const EPS = 1e-6;

/**
 * Does a note belong to the practised hand(s)? A note without a hand always does — the same rule
 * the player uses for `hands` (`hands && n.hand && !hands.includes(n.hand)` is the muted case).
 */
export function isActive(n: LessonNote, hands: Hands): boolean {
  return hands === 'both' || !n.hand || n.hand === hands;
}

/** The player's `hands` option for a selection (undefined = every hand sounds). */
export function playerHands(hands: Hands): ('L' | 'R')[] | undefined {
  return hands === 'both' ? undefined : [hands];
}

/**
 * Notes whose onset is inside the window, sorted, with their length clipped at the window end —
 * the player also cuts a note's sound at `to`, so the bar ends where the sound does.
 */
export function windowNotes(notes: readonly LessonNote[], span: Span): LessonNote[] {
  return notes
    .filter((n) => n.start >= span.start - EPS && n.start < span.end - EPS)
    .map((n) => (n.start + n.duration > span.end ? { ...n, duration: span.end - n.start } : n))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/**
 * Snap the window bounds to onsets lying within `tol` seconds of them. Fragment bounds are often
 * rounded to the millisecond while onsets are not (demo Für Elise: "Bars 2–3" starts at 1.667, its
 * first chord at 1.6667), and without this the boundary chord falls out of the fragment that starts
 * there — neither drawn nor played (the player skips onsets before `from − 0.1 ms`) — and leaks into
 * the fragment that ends there as an invisible 0.3 ms sliver.
 */
export function snapSpan(notes: readonly LessonNote[], span: Span, tol = 0.01): Span {
  let { start, end } = span;
  for (const n of notes) {
    if (Math.abs(n.start - span.start) <= tol) start = Math.min(start, n.start);
    if (Math.abs(n.start - span.end) <= tol) end = Math.min(end, n.start);
  }
  return end > start ? { start, end } : span;
}

export function period(span: Span): number {
  return span.end - span.start;
}

/**
 * Bars to draw at time `now`: everything still sounding or starting within `lookAhead` seconds.
 * When looping, the window repeats every `period(span)` seconds, so the start of the next pass is
 * already visible while the current one ends (and `now` may run past `span.end`).
 */
export function visibleBars(
  notes: readonly LessonNote[],
  span: Span,
  now: number,
  lookAhead: number,
  loop: boolean,
  hands: Hands,
): Bar[] {
  const p = period(span);
  const looping = loop && p > EPS;
  const kLo = looping ? Math.max(0, Math.floor((now - span.end) / p)) : 0;
  const kHi = looping ? Math.max(0, Math.ceil((now + lookAhead - span.start) / p)) : 0;
  const out: Bar[] = [];
  for (let k = kLo; k <= kHi; k++) {
    const shift = k * p;
    for (const n of notes) {
      const start = n.start + shift;
      const end = start + n.duration;
      if (end > now && start < now + lookAhead) out.push({ note: n, start, end, iteration: k, active: isActive(n, hands) });
    }
  }
  return out;
}

/** Active bars sounding at `now` (start ≤ now < end). */
export function soundingBars(bars: readonly Bar[], now: number): Bar[] {
  return bars.filter((b) => b.active && b.start <= now + EPS && now < b.end - EPS);
}

/** The next chord/key to press: active bars with the earliest onset after `after`, within `tol` of it. */
export function nextOnsetBars(bars: readonly Bar[], after: number, tol = 0.045): Bar[] {
  let first = Infinity;
  for (const b of bars) if (b.active && b.start > after + EPS && b.start < first) first = b.start;
  if (!Number.isFinite(first)) return [];
  return bars.filter((b) => b.active && b.start >= first - EPS && b.start - first <= tol);
}

/** Wait-mode stops: the steps (single keys or chords) of the practised hand(s) inside the window. */
export function waitSteps(windowed: readonly LessonNote[], hands: Hands): Step[] {
  return groupSteps(windowed.filter((n) => isActive(n, hands)));
}

/** Index of the first step at or after `t`; wraps to 0 when there is none. */
export function stepAtOrAfter(steps: readonly Step[], t: number, eps = 1e-3): number {
  const i = steps.findIndex((s) => s.time >= t - eps);
  return i < 0 ? 0 : i;
}

/** True when every required pitch has been pressed. */
export function covers(required: readonly number[], pressed: ReadonlySet<number>): boolean {
  return required.length > 0 && required.every((p) => pressed.has(p));
}
