import type { LessonNote, Step } from '@piano-steps/core';
import type { KeyHighlight, KeyMark } from '../../ui/PianoKeyboard.tsx';
import type { Phase } from './engine.ts';
import { nextOnsetBars, soundingBars, type Bar } from './timeline.ts';

const EPS = 1e-6;

export interface MarkInput {
  phase: Phase;
  bars: readonly Bar[];
  now: number;
  /** Wait mode: the step on the now-line and the one after it (the engine's grouping, 45 ms). */
  waiting?: { step: Step; next: Step | null } | null;
  /** Wait mode: right keys pressed since the step arrived. */
  pressed: ReadonlySet<number>;
  /** Wait mode: a wrong key being flashed. */
  wrong: number | null;
  /** Keys currently held on the on-screen / computer keyboard. */
  held: Iterable<number>;
}

export interface Marks {
  keys: Map<number, KeyHighlight>;
  /** Onset of the step to look at on the lane (outlined): the one on the line while waiting, else the next one. */
  focusTime?: number;
}

/**
 * Keyboard highlights for a frame: keys of the practised hand(s) light up in their hand colour while
 * their notes sound (finger number as a badge when the lesson has one), the next step gets a ring in
 * its hand's colour (on top of the fill when the same key repeats), and in wait mode keys still held
 * from an earlier step are striped (`hold`) while the user's presses show as `ok` / `bad`. Other keys
 * being held show as `hint`.
 *
 * While waiting, the step and the next one come from the engine's steps rather than from the bars at
 * `now`, so a slightly rolled chord (onsets a few ms apart) is one step on the keys as in the pill.
 */
export function keyMarks(m: MarkInput): Marks {
  const keys = new Map<number, KeyHighlight>();
  let focusTime: number | undefined;

  if (m.phase === 'waiting' && m.waiting) {
    const { step, next } = m.waiting;
    for (const b of m.bars)
      if (b.active && b.start < step.time - EPS && b.end > m.now + EPS) keys.set(b.note.pitch, { mark: 'hold', ...hand(b.note) });
    for (const n of step.notes) keys.set(n.pitch, fill(n));
    if (next) for (const n of next.notes) ring(keys, n);
    focusTime = m.now;
  } else {
    const resting = m.phase === 'idle' || m.phase === 'done';
    if (!resting) for (const b of soundingBars(m.bars, m.now)) keys.set(b.note.pitch, fill(b.note));
    const upcoming = nextOnsetBars(m.bars, resting ? m.now - 1e-3 : m.now);
    for (const b of upcoming) ring(keys, b.note);
    focusTime = m.phase === 'waiting' ? m.now : upcoming[0]?.start;
  }

  for (const p of m.pressed) keys.set(p, { mark: 'ok' });
  if (m.wrong !== null) keys.set(m.wrong, { mark: 'bad' });
  for (const p of m.held) if (!keys.has(p)) keys.set(p, { mark: 'hint' });
  return { keys, focusTime };
}

function handMark(n: LessonNote): KeyMark {
  return n.hand === 'L' ? 'L' : 'R';
}

function hand(n: LessonNote): Pick<KeyHighlight, 'hand'> {
  return n.hand ? { hand: n.hand } : {};
}

function fill(n: LessonNote): KeyHighlight {
  return { mark: handMark(n), ...hand(n), ...(n.finger ? { label: String(n.finger) } : {}) };
}

/** The next-step ring: on its own, or on top of a key that is lit now (the same key again). */
function ring(keys: Map<number, KeyHighlight>, n: LessonNote) {
  const cur = keys.get(n.pitch);
  if (!cur) keys.set(n.pitch, { mark: 'next', ...hand(n) });
  else if (cur.mark === 'hold') keys.set(n.pitch, { ...cur, next: true });
  else keys.set(n.pitch, { ...cur, ...hand(n), next: true });
}

/** Cheap identity for a highlight map, so React only re-renders the keyboard when it changes. */
export function marksSignature(keys: ReadonlyMap<number, KeyHighlight>): string {
  let s = '';
  for (const [p, h] of keys) s += `${p}:${h.mark}:${h.hand ?? ''}:${h.next ? 1 : 0}:${h.label ?? ''},`;
  return s;
}
