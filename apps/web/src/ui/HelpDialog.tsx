import type { Guide } from '@piano-steps/core';
import { useEffect, useState } from 'react';
import { getGuide } from '../api.ts';
import type { Lang } from '../settings.ts';

/**
 * The in-app guide ("How to use it"). Its text is a database record per language
 * (GET /api/guide?lang=), written by agents with PUT /api/guide/{lang}; offline, the bundled English
 * example is shown. Each section is a <details>, so the guide stays short on an iPad.
 */
export function HelpDialog({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const [guide, setGuide] = useState<Guide | null>(null);

  useEffect(() => {
    let live = true;
    void getGuide(lang).then((g) => live && setGuide(g));
    return () => {
      live = false;
    };
  }, [lang]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const title = guide?.title ?? (lang === 'uk' ? 'Як користуватися' : 'How to use it');
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet card help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="help-title">{title}</h3>
        <div className="help-body" lang={guide?.lang}>
          {!guide && <p className="muted">…</p>}
          {guide?.sections.map((sec, i) => (
            <details key={sec.id} open={i === 0} data-help={sec.id}>
              <summary>{sec.title}</summary>
              {sec.body.map((p, j) =>
                p.startsWith('• ') ? (
                  <p key={j} className="help-item">
                    {p.slice(2)}
                  </p>
                ) : (
                  <p key={j}>{p}</p>
                ),
              )}
            </details>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose}>
            {lang === 'uk' ? 'Закрити' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
