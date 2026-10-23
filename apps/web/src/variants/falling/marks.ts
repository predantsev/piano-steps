import type { KeyHighlight, KeyMark } from '../../ui/PianoKeyboard.tsx';
import type { Phase } from './engine.ts';
import { nextOnsetBars, soundingBars, type Bar } from './timeline.ts';

export interface MarkInput {
  phase: Phase;
  bars: readonly Bar[];
  now: number;
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
 * Keyboard highlights for a frame: keys of the practised hand(s) light up while their notes sound
 * (finger number as a badge when the lesson has one), the next step gets the `next` outline, and in
 * wait mode the user's presses show as `ok` / `bad`. Other keys being held show as `hint`.
 */
export function keyMarks(m: MarkInput): Marks {
  const keys = new Map<number, KeyHighlight>();
  const resting = m.phase === 'idle' || m.phase === 'done';
  if (!resting)
    for (const b of soundingBars(m.bars, m.now))
      keys.set(b.note.pitch, { mark: handMark(b), label: b.note.finger ? String(b.note.finger) : undefined });
  const upcoming = nextOnsetBars(m.bars, resting ? m.now - 1e-3 : m.now);
  for (const b of upcoming) if (!keys.has(b.note.pitch)) keys.set(b.note.pitch, { mark: 'next' });
  for (const p of m.pressed) keys.set(p, { mark: 'ok' });
  if (m.wrong !== null) keys.set(m.wrong, { mark: 'bad' });
  for (const p of m.held) if (!keys.has(p)) keys.set(p, { mark: 'hint' });
  return { keys, focusTime: m.phase === 'waiting' ? m.now : upcoming[0]?.start };
}

function handMark(b: Bar): KeyMark {
  return b.note.hand === 'L' ? 'L' : 'R';
}

/** Cheap identity for a highlight map, so React only re-renders the keyboard when it changes. */
export function marksSignature(keys: ReadonlyMap<number, KeyHighlight>): string {
  let s = '';
  for (const [p, h] of keys) s += `${p}:${h.mark}:${h.label ?? ''},`;
  return s;
}
