import { octaveOf, pitchName, type Hand, type NoteNameSystem } from '@piano-steps/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Lang } from '../../settings.ts';
import { layoutStrip, maxChord, trackOffset, type CardStep, type LaneChip } from './model.ts';
import { tr } from './strings.ts';

/**
 * The step strip: one card per step, laid out left → right in time (card width ∝ time to the
 * next step), right hand in the top lane, left hand in the bottom lane, a thin bar under each
 * chip showing how long the key is held. Tap a card = jump to it; swipe = Next / Back.
 */

const NUM_ROW = 26; // px — the step-number row above the lanes
const PAD = 6;
const LANE_GAP = 8;
const BAR_H = 5;

export function NoteName({ pitch, system, className }: { pitch: number; system: NoteNameSystem; className?: string }) {
  return (
    <span className={`cv-name ${className ?? ''}`}>
      {pitchName(pitch, system, { withOctave: false })}
      <small>{octaveOf(pitch)}</small>
    </span>
  );
}

export interface StepStripProps {
  steps: CardStep[];
  /** Highlighted card; `steps.length` = past the end (fragment done). */
  current: number;
  hasLeft: boolean;
  noteNames: NoteNameSystem;
  lang: Lang;
  onTap(index: number): void;
  onSwipe(dir: 1 | -1): void;
  /** Rendered over the strip (the end-of-fragment panel). */
  overlay?: ReactNode;
}

/** `--hc` = the card's hand colour (the "next" frame); neutral when both hands play. */
function handColour(s: CardStep): CSSProperties {
  const c = s.lanes.R && s.lanes.L ? 'var(--mut)' : s.lanes.L ? 'var(--hand-l)' : 'var(--hand-r)';
  return { '--hc': c } as CSSProperties;
}

export function StepStrip({ steps, current, hasLeft, noteNames, lang, onTap, onSwipe, overlay }: StepStripProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const minW = noteNames === 'solfege' ? 92 : 72;
  const layout = useMemo(() => layoutStrip(steps, size.w - 2 * PAD, { minW, maxW: 340 }), [steps, size.w, minW]);
  const chord = useMemo(() => maxChord(steps), [steps]);

  // Lane geometry (px), shared by the cards, the hold bars and the lane labels.
  const avail = Math.max(120, size.h - NUM_ROW - 2 * PAD - (hasLeft ? LANE_GAP : 0));
  const hR = hasLeft ? Math.round((avail * chord.R) / (chord.R + chord.L)) : avail;
  const hL = hasLeft ? avail - hR : 0;
  const laneTop: Record<Hand, number> = { R: PAD + NUM_ROW, L: PAD + NUM_ROW + hR + LANE_GAP };
  const laneH: Record<Hand, number> = { R: hR, L: hL };

  const offset = trackOffset(layout, size.w - 2 * PAD, Math.min(current, steps.length - 1));
  // Slide only when moving between steps of the same fragment at the same size — not on the
  // first measurement, a resize or a fragment change (those would animate a jump from nowhere).
  const prev = useRef({ steps, w: size.w });
  const animate = prev.current.steps === steps && prev.current.w === size.w && size.w > 0;
  useEffect(() => {
    prev.current = { steps, w: size.w };
  });
  const hands: Hand[] = hasLeft ? ['R', 'L'] : ['R'];

  // swipe: horizontal drag ≥ 40 px that is clearly more horizontal than vertical
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);

  return (
    <div className="cv-strip">
      <div className="cv-lane-labels" aria-hidden="true">
        {hasLeft && (
          <>
            <span className="cv-lane-label cv-hand-R" style={{ top: laneTop.R, height: hR }}>
              {tr(lang, 'laneRight')}
            </span>
            <span className="cv-lane-label cv-hand-L" style={{ top: laneTop.L, height: hL }}>
              {tr(lang, 'laneLeft')}
            </span>
          </>
        )}
      </div>
      <div
        ref={viewRef}
        className="cv-viewport"
        role="list"
        aria-label={tr(lang, 'stepsStrip')}
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          swiped.current = false;
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) >= 40 && Math.abs(dx) > 1.4 * Math.abs(dy)) {
            swiped.current = true;
            onSwipe(dx < 0 ? 1 : -1);
          }
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
        onClickCapture={(e) => {
          if (swiped.current) {
            swiped.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <div
          className="cv-track"
          style={{
            width: layout.total,
            transform: `translateX(${PAD + offset}px)`,
            transition: animate ? undefined : 'none',
          }}
        >
          {steps.map((s, i) => {
            const state = i === current ? 'is-current' : i === current + 1 ? 'is-next' : i < current ? 'is-past' : '';
            const names = s.pitches.map((p) => pitchName(p, noteNames)).join(' + ');
            return (
              <button
                key={i}
                type="button"
                role="listitem"
                className={`cv-card ${state}`}
                style={{ left: layout.xs[i], width: layout.ws[i], ...handColour(s) }}
                aria-current={i === current ? 'step' : undefined}
                aria-label={`${tr(lang, 'step')} ${i + 1}: ${names}`}
                onClick={() => onTap(i)}
              >
                <span className="cv-num">{i + 1}</span>
                {hands.map((h) => {
                  const lane = s.lanes[h];
                  return (
                    <span
                      key={h}
                      className="cv-lane"
                      style={{ top: laneTop[h] - PAD, height: laneH[h] }}
                    >
                      {lane && <Chip lane={lane} width={layout.ws[i]} height={laneH[h]} system={noteNames} />}
                    </span>
                  );
                })}
              </button>
            );
          })}
          {/* hold bars: drawn above the cards so a long note stays visible across later cards */}
          {steps.flatMap((s, i) =>
            hands.map((h) => {
              const lane = s.lanes[h];
              if (!lane) return null;
              const x0 = layout.xAt(s.time) + 8;
              const x1 = layout.xAt(s.time + lane.holdSec) - 6;
              // bright while the key is down at the current step (its own step, or held over)
              const cur = steps[current];
              const active = !!cur && i <= current && cur.time < s.time + lane.holdSec - 0.02;
              return (
                <span
                  key={`${i}${h}`}
                  className={`cv-hold cv-hand-${h} ${active ? 'is-current' : ''}`}
                  style={{ left: x0, width: Math.max(10, x1 - x0), top: laneTop[h] - PAD + laneH[h] - BAR_H - 7 }}
                />
              );
            }),
          )}
        </div>
        {overlay}
      </div>
    </div>
  );
}

function Chip({ lane, width, height, system }: { lane: LaneChip; width: number; height: number; system: NoteNameSystem }) {
  const c = lane.pitches.length;
  // width in "em": the name, the small octave digit, and a finger badge when there is one
  const longest =
    Math.max(...lane.pitches.map((p) => pitchName(p, system, { withOctave: false }).length)) +
    0.7 +
    (lane.fingers.size > 0 ? 1.1 : 0);
  const fs = Math.max(14, Math.min(46, ((height - 18) * 0.8) / (c * 1.08), (width - 22) / (0.64 * longest)));
  const top = [...lane.pitches].reverse(); // highest note on top, like on a staff
  return (
    <span className={`cv-chip cv-hand-${lane.hand}`} style={{ fontSize: fs }}>
      {top.map((p) => (
        <span key={p} className="cv-chip-row">
          <NoteName pitch={p} system={system} />
          {lane.fingers.has(p) && <span className="cv-finger">{lane.fingers.get(p)}</span>}
        </span>
      ))}
    </span>
  );
}
