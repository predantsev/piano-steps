import { keyboardRange, soundingAt } from '@piano-steps/core';
import { useEffect, useMemo, useState } from 'react';
import { PianoKeyboard, type KeyHighlight } from '../ui/PianoKeyboard.tsx';
import type { VariantProps } from '../variant.ts';

/**
 * Minimal working practice screen used as the starting point of every variant:
 * pick a fragment, play it (optionally slower), watch the keys light up.
 * Each variant replaces this with its own design.
 */
export default function Placeholder({ lesson, player, input, settings, lang, onFragmentChange }: VariantProps) {
  const [frag, setFrag] = useState(0);
  const [, setTick] = useState(0);
  const range = useMemo(() => keyboardRange(lesson.notes.map((n) => n.pitch)), [lesson]);
  const f = lesson.fragments[frag];

  useEffect(() => onFragmentChange(frag), [frag, onFragmentChange]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setTick((x) => x + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const highlights = new Map<number, KeyHighlight>();
  if (player.state === 'playing')
    for (const n of soundingAt(lesson.notes, player.time)) highlights.set(n.pitch, { mark: n.hand ?? 'R' });
  for (const p of input.held) highlights.set(p, { mark: 'hint' });

  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr auto', height: '100%', gap: 12 }}>
      <div style={{ padding: 16, overflow: 'auto' }}>
        <p className="muted">{lang === 'uk' ? 'Базовий екран — варіант ще будується.' : 'Basic screen — this variant is being built.'}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
          {lesson.fragments.map((fr, i) => (
            <button key={i} className={`btn ${i === frag ? 'primary' : ''}`} onClick={() => setFrag(i)}>
              {fr.title ?? `#${i + 1}`}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn big primary"
            onClick={() =>
              player.state === 'playing'
                ? player.stop()
                : player.play({ from: f.start, to: f.end, rate: settings.speed })
            }
          >
            {player.state === 'playing' ? '■' : '▶'} {lang === 'uk' ? 'Фрагмент' : 'Fragment'}
          </button>
          <button className="btn big" onClick={() => player.play({ from: 0, rate: settings.speed })}>
            ▶ {lang === 'uk' ? 'Увесь урок' : 'Whole lesson'}
          </button>
        </div>
      </div>
      <PianoKeyboard
        range={range}
        highlights={highlights}
        labels={settings.keyLabels}
        noteNames={settings.noteNames}
        onNoteOn={(p) => {
          player.noteOn(p);
          input.emit('on', p, 'screen');
        }}
        onNoteOff={(p) => {
          player.noteOff(p);
          input.emit('off', p, 'screen');
        }}
      />
    </div>
  );
}
