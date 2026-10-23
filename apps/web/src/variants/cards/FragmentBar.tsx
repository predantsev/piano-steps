import type { Fragment, FragmentProgress } from '@piano-steps/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Lang } from '../../settings.ts';
import { fragmentStatus, masteredCount } from './model.ts';
import { tr } from './strings.ts';

/**
 * Overview of all fragments with their progress (new / learning / learned) and big
 * previous / next fragment buttons. Leaves room on the right for the shell's floating buttons.
 */
export function FragmentBar({
  fragments,
  current,
  progress,
  lang,
  onSelect,
}: {
  fragments: Fragment[];
  current: number;
  progress: FragmentProgress[];
  lang: Lang;
  onSelect(index: number): void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = useState<number | null>(null);

  // The shell's .fab (Original / Sounds wrong) floats over the stage's top-right corner.
  useLayoutEffect(() => {
    const fab = rootRef.current?.closest('.stage')?.querySelector<HTMLElement>('.fab');
    if (!fab) {
      setReserve(12);
      return;
    }
    const measure = () => setReserve(fab.offsetWidth + 24);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(fab);
    return () => ro.disconnect();
  }, []);

  // Keep the current chip visible (manual scrollLeft: scrollIntoView would also scroll the stage).
  useEffect(() => {
    const box = chipsRef.current;
    const chip = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!box || !chip) return;
    if (chip.offsetLeft < box.scrollLeft) box.scrollLeft = chip.offsetLeft - 8;
    else if (chip.offsetLeft + chip.offsetWidth > box.scrollLeft + box.clientWidth)
      box.scrollLeft = chip.offsetLeft + chip.offsetWidth - box.clientWidth + 8;
  }, [current]);

  const done = masteredCount(progress, fragments.length);
  const last = fragments.length - 1;

  return (
    <div className="cv-fragbar" ref={rootRef} style={{ paddingRight: reserve ?? undefined }}>
      <button
        type="button"
        className="btn big cv-fragnav"
        disabled={current <= 0}
        onClick={() => onSelect(current - 1)}
        aria-label={tr(lang, 'prevFragmentHint')}
        title={tr(lang, 'prevFragmentHint')}
      >
        ‹ <span className="cv-wide">{tr(lang, 'prevFragment')}</span>
      </button>
      <div className="cv-fragchips" ref={chipsRef} role="tablist" aria-label={tr(lang, 'fragments')}>
        {fragments.map((f, i) => {
          const st = fragmentStatus(progress, i);
          const label = st === 'mastered' ? 'statusMastered' : st === 'learning' ? 'statusLearning' : 'statusNew';
          return (
            <button
              key={i}
              type="button"
              role="tab"
              className={`cv-fragchip st-${st}`}
              aria-current={i === current ? 'true' : undefined}
              aria-selected={i === current}
              aria-label={`${tr(lang, 'fragment')} ${f.title ?? `#${i + 1}`} — ${tr(lang, label)}`}
              title={tr(lang, label)}
              onClick={() => onSelect(i)}
            >
              <span className="cv-dot" aria-hidden="true">
                {st === 'mastered' ? '✓' : ''}
              </span>
              {f.title ?? `#${i + 1}`}
            </button>
          );
        })}
      </div>
      <span
        className="cv-learned"
        role="img"
        aria-label={`${done} / ${fragments.length} ${tr(lang, 'learned')}`}
        title={`${done} / ${fragments.length} ${tr(lang, 'learned')}`}
      >
        <span className="cv-learned-bar" aria-hidden="true">
          <span style={{ width: `${(100 * done) / Math.max(1, fragments.length)}%` }} />
        </span>
        <span className="cv-learned-num" aria-hidden="true">
          ✓ {done}/{fragments.length}
        </span>
      </span>
      <button
        type="button"
        className="btn big cv-fragnav"
        disabled={current >= last}
        onClick={() => onSelect(current + 1)}
        aria-label={tr(lang, 'nextFragmentHint')}
        title={tr(lang, 'nextFragmentHint')}
      >
        <span className="cv-wide">{tr(lang, 'nextFragment')}</span> ›
      </button>
    </div>
  );
}
