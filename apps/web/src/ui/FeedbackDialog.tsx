import { useState } from 'react';
import { sendFeedback } from '../api.ts';
import { t } from '../i18n.ts';
import type { Lang } from '../settings.ts';

/** "This fragment sounds wrong" → POST /api/lessons/{ref}/feedback; an agent picks it up. */
export function FeedbackDialog({ lessonRef, fragmentPosition, fragmentTitle, lang, onClose }: {
  lessonRef: string;
  fragmentPosition: number | null;
  fragmentTitle: string;
  lang: Lang;
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
      <div className="sheet card" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  );
}
