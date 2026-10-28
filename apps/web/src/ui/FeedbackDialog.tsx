import { pitchName, type Feedback } from '@piano-steps/core';
import { useEffect, useState } from 'react';
import { listFeedback, sendFeedback } from '../api.ts';
import { t, type StringKey } from '../i18n.ts';
import type { Lang, Settings } from '../settings.ts';

const STATUS: Record<Feedback['status'], StringKey> = {
  open: 'stOpen',
  'in-progress': 'stInProgress',
  resolved: 'stResolved',
  'wont-fix': 'stWontFix',
};
const KIND: Record<NonNullable<Feedback['kind']>, StringKey> = {
  higher: 'kHigher',
  lower: 'kLower',
  extra: 'kExtra',
  missing: 'kMissing',
  timing: 'kTiming',
  other: 'kOther',
};

/** Earlier reports on this lesson (from the dialog and from tapped notes), with what became of them. */
function MyReports({ lessonRef, lang, noteNames }: { lessonRef: string; lang: Lang; noteNames: Settings['noteNames'] }) {
  const [items, setItems] = useState<Feedback[] | null>(null);
  useEffect(() => {
    let live = true;
    listFeedback(lessonRef).then(
      (f) => live && setItems(f),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, [lessonRef]);
  if (!items) return null;
  return (
    <div className="reports">
      <h4>{t(lang, 'myReports')}</h4>
      {items.length === 0 && <p className="muted">{t(lang, 'noReports')}</p>}
      {items.map((f) => (
        <div key={f.id} className="report" data-status={f.status}>
          <div>
            <span className={`report-st st-${f.status}`}>{t(lang, STATUS[f.status])}</span>{' '}
            {f.fragmentPosition !== undefined && (
              <span className="muted">
                {t(lang, 'fragmentShort')} #{f.fragmentPosition + 1}
              </span>
            )}
            {f.note && <b> · {pitchName(f.note.pitch, noteNames)}</b>}
            {f.kind && <span> · {t(lang, KIND[f.kind])}</span>}
          </div>
          {f.message && <div>{f.message}</div>}
          {f.resolution && <div className="muted">↳ {f.resolution}</div>}
        </div>
      ))}
    </div>
  );
}

/** "This fragment sounds wrong" → POST /api/lessons/{ref}/feedback; an agent picks it up. */
export function FeedbackDialog({ lessonRef, fragmentPosition, fragmentTitle, lang, noteNames, onClose }: {
  lessonRef: string;
  fragmentPosition: number | null;
  fragmentTitle: string;
  lang: Lang;
  noteNames: Settings['noteNames'];
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');

  const submit = async () => {
    setState('sending');
    try {
      await sendFeedback(lessonRef, {
        message: text.trim(),
        ...(fragmentPosition !== null ? { fragmentPosition } : {}),
      });
      setState('sent');
      setTimeout(onClose, 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet card feedback" onClick={(e) => e.stopPropagation()}>
        <h3>{t(lang, 'feedbackTitle')}</h3>
        <p className="muted" style={{ margin: '4px 0 12px' }}>{fragmentTitle}</p>
        {state === 'sent' ? (
          <p style={{ color: 'var(--ok)', fontWeight: 600 }}>✓ {t(lang, 'sent')}</p>
        ) : (
          <>
            <textarea
              autoFocus
              rows={4}
              value={text}
              placeholder={t(lang, 'feedbackPlaceholder')}
              onChange={(e) => setText(e.target.value)}
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--bd)', background: 'var(--bg)' }}
            />
            {state === 'error' && <p style={{ color: 'var(--bad)' }}>{t(lang, 'error')}: {err}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={onClose}>{t(lang, 'cancel')}</button>
              <button className="btn primary" disabled={!text.trim() || state === 'sending'} onClick={submit}>
                {t(lang, 'send')}
              </button>
            </div>
          </>
        )}
        <MyReports lessonRef={lessonRef} lang={lang} noteNames={noteNames} />
      </div>
    </div>
  );
}
