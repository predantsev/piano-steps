import type { FragmentNote, FragmentNoteInput, FragmentNoteTag } from '@piano-steps/core';
import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../../settings.ts';
import { s, type StringKey } from './strings.ts';

const TAGS: [FragmentNoteTag, StringKey][] = [
  ['split', 'tagSplit'],
  ['merge-next', 'tagMerge'],
  ['boundary', 'tagBoundary'],
];

/**
 * The note on one fragment, opened from the Note button or by holding (right-clicking) a fragment
 * number: free text, "come back later", and quick wishes for re-cutting fragments. Sits under the
 * number, kept inside the window; a tap outside or Escape closes it without saving.
 */
export function FragmentNoteMenu({ title, note, at, lang, onSave, onClose }: {
  title: string;
  note: FragmentNote | undefined;
  at: { x: number; y: number };
  lang: Lang;
  onSave(n: FragmentNoteInput): Promise<void>;
  onClose(): void;
}) {
  const [text, setText] = useState(note?.text ?? '');
  const [later, setLater] = useState(note?.later ?? false);
  const [tags, setTags] = useState<FragmentNoteTag[]>(note?.tags ?? []);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(at.x, window.innerWidth - r.width - pad)),
      top: Math.max(pad, Math.min(at.y + 8, window.innerHeight - r.height - pad)),
    });
  }, [at.x, at.y]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const save = async (n: FragmentNoteInput) => {
    setState('saving');
    try {
      await onSave(n);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  };
  const toggle = (t: FragmentNoteTag) => setTags((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));

  return (
    <div className="fl-menu-backdrop" onPointerDown={onClose}>
      <div
        ref={ref}
        className="fl-notemenu fl-fragmenu card"
        role="dialog"
        aria-label={title}
        style={{ left: pos.left, top: pos.top }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="fl-nm-head">
          <b>{title}</b>
          <button className="btn ghost fl-nm-x" aria-label={s(lang, 'close')} onClick={onClose}>
            ✕
          </button>
        </div>
        <label className="fl-nm-label" htmlFor="fl-fragnote-text">
          {s(lang, 'fragNote')}
        </label>
        <textarea
          id="fl-fragnote-text"
          rows={3}
          value={text}
          placeholder={s(lang, 'fragNotePlaceholder')}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn fl-later" aria-pressed={later} onClick={() => setLater(!later)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={later ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <path d="M6 3h12v18l-6-4-6 4z" />
          </svg>
          {s(lang, 'fragLater')}
        </button>
        <div className="fl-nm-label">{s(lang, 'fragTagsLabel')}</div>
        <div className="fl-nm-kinds fl-nm-tags">
          {TAGS.map(([t, label]) => (
            <button key={t} className="btn" aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>
              {s(lang, label)}
            </button>
          ))}
        </div>
        {state === 'error' && <p className="fl-nm-err">{err}</p>}
        <div className="fl-nm-actions">
          {note && (
            <button className="btn fl-nm-del" disabled={state === 'saving'} onClick={() => void save({ text: '', later: false, tags: [] })}>
              {s(lang, 'remove')}
            </button>
          )}
          <span className="fl-nm-spacer" />
          <button className="btn" onClick={onClose}>
            {s(lang, 'cancel')}
          </button>
          <button className="btn primary" disabled={state === 'saving'} onClick={() => void save({ text: text.trim(), later, tags })}>
            {s(lang, 'save')}
          </button>
        </div>
      </div>
    </div>
  );
}
