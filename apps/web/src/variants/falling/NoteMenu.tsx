import { pitchName, type FeedbackKind, type LessonNote } from '@piano-steps/core';
import { useEffect, useRef, useState } from 'react';
import type { Lang, Settings } from '../../settings.ts';
import { s, type StringKey } from './strings.ts';

const KINDS: [FeedbackKind, StringKey][] = [
  ['higher', 'kindHigher'],
  ['lower', 'kindLower'],
  ['extra', 'kindExtra'],
  ['missing', 'kindMissing'],
  ['timing', 'kindTiming'],
  ['other', 'kindOther'],
];

/**
 * The small menu over a tapped falling note: hear it, report it ("sounds wrong" with a quick kind and an
 * optional comment — saved with the note's stable id), and a placeholder for fixing it yourself later.
 * Positioned at the tap, kept inside the window; a tap outside or Escape closes it.
 */
export function NoteMenu({ note, at, lang, noteNames, onHear, onReport, onClose }: {
  note: LessonNote;
  at: { x: number; y: number };
  lang: Lang;
  noteNames: Settings['noteNames'];
  onHear(): void;
  onReport?: (r: { kind?: FeedbackKind; message?: string }) => Promise<void>;
  onClose(): void;
}) {
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });

  // Keep the menu inside the window (it opens at the tap, which may be near an edge).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(at.x - r.width / 2, window.innerWidth - r.width - pad)),
      top: Math.max(pad, Math.min(at.y + 12, window.innerHeight - r.height - pad)),
    });
  }, [at.x, at.y, state]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const send = async () => {
    if (!onReport) return;
    setState('sending');
    try {
      await onReport({ ...(kind ? { kind } : {}), message: text.trim() });
      setState('sent');
      setTimeout(onClose, 1400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  };

  const hand = note.hand === 'R' ? s(lang, 'handR') : note.hand === 'L' ? s(lang, 'handL') : null;
  return (
    <div className="fl-menu-backdrop" onPointerDown={onClose}>
      <div
        ref={ref}
        className="fl-notemenu card"
        role="dialog"
        aria-label={pitchName(note.pitch, noteNames)}
        style={{ left: pos.left, top: pos.top }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="fl-nm-head">
          <b>{pitchName(note.pitch, noteNames)}</b>
          <span className="muted">
            {hand && `${hand} · `}
            {note.start.toFixed(2)} {s(lang, 'sec')}
          </span>
          <button className="btn ghost fl-nm-x" aria-label={s(lang, 'close')} onClick={onClose}>
            ✕
          </button>
        </div>
        <button className="btn" onClick={onHear}>
          🔊 {s(lang, 'noteHear')}
        </button>
        {state === 'sent' ? (
          <p className="fl-nm-ok">✓ {s(lang, 'noteSent')}</p>
        ) : (
          onReport && (
            <>
              <div className="fl-nm-label">⚑ {s(lang, 'noteWrong')}</div>
              <div className="fl-nm-kinds">
                {KINDS.map(([k, label]) => (
                  <button key={k} className="btn" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                    {s(lang, label)}
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                value={text}
                placeholder={s(lang, 'noteComment')}
                onChange={(e) => setText(e.target.value)}
              />
              {state === 'error' && <p className="fl-nm-err">{err}</p>}
              <button
                className="btn primary"
                disabled={(!kind && !text.trim()) || state === 'sending'}
                onClick={() => void send()}
              >
                {s(lang, 'noteSend')}
              </button>
            </>
          )
        )}
        <button className="btn" disabled title={s(lang, 'noteFixSelf')}>
          ✎ {s(lang, 'noteFixSelf')}
        </button>
      </div>
    </div>
  );
}
