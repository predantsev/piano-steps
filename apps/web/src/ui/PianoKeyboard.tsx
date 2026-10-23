import { isBlackKey, pitchName, type NoteNameSystem } from '@piano-steps/core';
import { useMemo, useRef, type CSSProperties } from 'react';
import './PianoKeyboard.css';

/**
 * Touch-first piano keyboard. Multi-touch (chords with several fingers), glissando by
 * sliding, mouse too. Purely presentational: highlights come in, presses go out.
 */

export type KeyMark =
  | 'R' // right hand should press / is sounding
  | 'L' // left hand
  | 'next' // coming up next (outline)
  | 'ok' // pressed correctly
  | 'bad' // pressed but wrong
  | 'hint';

export interface KeyHighlight {
  mark: KeyMark;
  /** Small text on the key (e.g. a finger number or "1", "2" for order). */
  label?: string;
}

export interface PianoKeyboardProps {
  range: [number, number];
  highlights?: Map<number, KeyHighlight> | Record<number, KeyHighlight>;
  /** Show note names: on every key, only on C keys, or nowhere. */
  labels?: 'all' | 'c' | 'none';
  noteNames?: NoteNameSystem;
  onNoteOn?: (pitch: number) => void;
  onNoteOff?: (pitch: number) => void;
  /** CSS height of the keyboard, e.g. "30vh" or 180. */
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function PianoKeyboard({
  range,
  highlights,
  labels = 'c',
  noteNames = 'letter',
  onNoteOn,
  onNoteOff,
  height = '28vh',
  className,
  style,
}: PianoKeyboardProps) {
  const [lo, hi] = range;
  const pointers = useRef(new Map<number, number>()); // pointerId → pitch
  const hl = useMemo(
    () => (highlights instanceof Map ? highlights : new Map(Object.entries(highlights ?? {}).map(([k, v]) => [Number(k), v]))),
    [highlights],
  );

  const whites: number[] = [];
  for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) whites.push(p);
  const whiteW = 100 / whites.length;

  const pitchAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const v = el?.closest<HTMLElement>('[data-pitch]')?.dataset.pitch;
    return v === undefined ? null : Number(v);
  };

  const press = (id: number, pitch: number | null) => {
    const prev = pointers.current.get(id);
    if (prev === pitch) return;
    if (prev !== undefined) {
      pointers.current.delete(id);
      if (![...pointers.current.values()].includes(prev)) onNoteOff?.(prev);
    }
    if (pitch !== null) {
      const already = [...pointers.current.values()].includes(pitch);
      pointers.current.set(id, pitch);
      if (!already) onNoteOn?.(pitch);
    }
  };

  const keyLabel = (p: number) => {
    if (labels === 'none') return null;
    if (labels === 'c' && p % 12 !== 0) return null;
    return pitchName(p, noteNames, { withOctave: labels === 'c' || p % 12 === 0 });
  };

  return (
    <div
      className={`pk ${className ?? ''}`}
      style={{ height, ...style }}
      role="group"
      aria-label="Piano keyboard"
      onPointerDown={(e) => {
        (e.target as Element).releasePointerCapture?.(e.pointerId); // allow sliding across keys
        press(e.pointerId, pitchAt(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => {
        if (pointers.current.has(e.pointerId)) press(e.pointerId, pitchAt(e.clientX, e.clientY));
      }}
      onPointerUp={(e) => press(e.pointerId, null)}
      onPointerCancel={(e) => press(e.pointerId, null)}
      onPointerLeave={(e) => press(e.pointerId, null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {whites.map((p, i) => {
        const h = hl.get(p);
        return (
          <div
            key={p}
            data-pitch={p}
            className={`pk-key pk-white ${h ? `pk-${h.mark}` : ''}`}
            style={{ left: `${i * whiteW}%`, width: `${whiteW}%` }}
            aria-label={pitchName(p)}
          >
            {h?.label && <span className="pk-badge">{h.label}</span>}
            <span className="pk-name">{keyLabel(p)}</span>
          </div>
        );
      })}
      {Array.from({ length: hi - lo + 1 }, (_, k) => lo + k)
        .filter((p) => isBlackKey(p))
        .map((p) => {
          const leftWhite = whites.indexOf(p - 1);
          const h = hl.get(p);
          return (
            <div
              key={p}
              data-pitch={p}
              className={`pk-key pk-black ${h ? `pk-${h.mark}` : ''}`}
              style={{ left: `${(leftWhite + 1) * whiteW - whiteW * 0.3}%`, width: `${whiteW * 0.6}%` }}
              aria-label={pitchName(p)}
            >
              {h?.label && <span className="pk-badge">{h.label}</span>}
              {labels === 'all' && <span className="pk-name">{pitchName(p, noteNames, { withOctave: false })}</span>}
            </div>
          );
        })}
    </div>
  );
}
