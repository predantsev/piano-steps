// Variant B — "Fragment cards": step by step, "press this, then these two together".
import { keyboardRange, soundingAt, TIME_EPS, type Fragment, type LessonNote } from '@piano-steps/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PianoKeyboard, type KeyHighlight } from '../../ui/PianoKeyboard.tsx';
import type { VariantProps } from '../../variant.ts';
import { FragmentBar } from './FragmentBar.tsx';
import { NoteName, StepStrip } from './StepStrip.tsx';
import {
  buildSteps,
  countInFrom,
  handOf,
  heldOver,
  isAccent,
  isStepPlayed,
  lessonHasLeft,
  metronome,
  SPEEDS,
  stepAt,
  stepKind,
  tickIndex,
  type CardStep,
} from './model.ts';
import { tr } from './strings.ts';
import './cards.css';

const POS_KEY = (slug: string) => `piano-steps-cards:${slug}`;

function readPos(slug: string, count: number): number {
  try {
    const v = Number(localStorage.getItem(POS_KEY(slug)));
    return Number.isInteger(v) && v >= 0 && v < count ? v : 0;
  } catch {
    return 0;
  }
}

const fingerLabel = (n: LessonNote) => (n.finger !== undefined ? String(n.finger) : undefined);

export default function CardsVariant({
  lesson,
  player,
  input,
  settings,
  lang,
  progress,
  recordProgress,
  onFragmentChange,
}: VariantProps) {
  const fragments = lesson.fragments;
  const lastFrag = fragments.length - 1;
  const [frag, setFrag] = useState(() => readPos(lesson.slug, fragments.length));
  const [step, setStep] = useState(0); // 0…steps.length; steps.length = fragment done
  const [finished, setFinished] = useState(false); // "Got it" on the last fragment
  const [speed, setSpeed] = useState(settings.speed);
  const [loop, setLoop] = useState(false);
  const [along, setAlong] = useState(false); // play along: silent run + metronome + count-in
  const [playerState, setPlayerState] = useState(player.state);
  const [mode, setMode] = useState<'fragment' | null>(null); // what this variant asked the player to play
  const [play, setPlay] = useState<{ step: number; sounding: LessonNote[] }>({ step: -1, sounding: [] });
  const [, bump] = useState(0);
  const marks = useRef(new Map<number, 'ok' | 'bad'>()); // held keys judged against the current step
  const pressed = useRef(new Set<number>()); // keys of the current step pressed so far

  const f = fragments[frag];
  const steps = useMemo(() => (f ? buildSteps(lesson.notes, f) : []), [lesson.notes, f]);
  const fragNotes = useMemo(() => steps.flatMap((s) => s.notes), [steps]);
  const hasLeft = useMemo(() => lessonHasLeft(fragNotes), [fragNotes]);
  // Sized to the current fragment, so the keys are wide enough to tap (≥ 44 px on an iPad when it can).
  const range = useMemo(
    () => keyboardRange(fragNotes.length > 0 ? fragNotes.map((x) => x.pitch) : lesson.notes.map((x) => x.pitch)),
    [fragNotes, lesson.notes],
  );
  const metro = useMemo(() => metronome(lesson.tempo), [lesson.tempo]);
  const n = steps.length;
  const done = step >= n;
  const playingFragment = playerState === 'playing' && mode === 'fragment';
  const shown = playingFragment ? Math.max(0, play.step) : step; // the card the eye should be on
  const countingIn = playingFragment && along && play.step < 0;

  // Latest values for listeners registered once (player, note input, keyboard).
  const ctx = useRef({ f, steps, step, speed, loop, along, mode, playing: playingFragment, done });
  ctx.current = { f, steps, step, speed, loop, along, mode, playing: playingFragment, done };

  /** ▶ the fragment; in play-along mode silently, after a one-bar count-in. */
  const startFragment = (fr: Fragment, rate: number, silent: boolean, loop: boolean) => {
    const from = silent ? countInFrom(fr.start, metro, rate) : fr.start;
    player.play({ from, to: fr.end, rate, muted: silent, loop });
  };
  const startRef = useRef(startFragment);
  startRef.current = startFragment;

  // ── shell sync ──────────────────────────────────────────────────────────
  useEffect(() => onFragmentChange(frag), [frag, onFragmentChange]);
  useEffect(() => {
    try {
      localStorage.setItem(POS_KEY(lesson.slug), String(frag));
    } catch {
      /* storage blocked */
    }
  }, [frag, lesson.slug]);

  // ── player ──────────────────────────────────────────────────────────────
  useEffect(
    () =>
      player.subscribe((e) => {
        if (e.type === 'state') setPlayerState(e.state);
        const c = ctx.current;
        // Loop ON at the start → the player loops seamlessly; Loop turned OFF mid-play stops at the wrap.
        if (e.type === 'loop' && c.mode === 'fragment' && !c.loop) {
          queueMicrotask(() => player.stop()); // not from inside the player's own tick
          setMode(null);
        }
        if (e.type === 'end') {
          // Loop turned ON mid-play takes effect at the end. Never for an empty pass (the player ends
          // those at once), and never re-entering play() from inside the player's own event.
          if (c.mode === 'fragment' && c.loop && c.f && c.steps.length > 0) {
            const { f: fr, speed: rate, along: silent } = c;
            queueMicrotask(() => {
              if (ctx.current.mode === 'fragment' && ctx.current.f === fr) startRef.current(fr, rate, silent, true);
            });
          } else setMode(null);
        }
      }),
    [player],
  );
  useEffect(() => () => player.stop(), [player]);

  // While the fragment plays, follow the clock: which step, which keys sound (re-render on change only).
  useEffect(() => {
    if (!playingFragment) return;
    let raf = 0;
    let last = '';
    let lastTick: number | null = null;
    const tick = () => {
      const t = player.time;
      const c = ctx.current;
      if (c.along && metro && c.f && t < c.f.end - TIME_EPS) {
        const k = tickIndex(t, metro.tickSec);
        if (k !== lastTick) {
          lastTick = k;
          const accent = isAccent(k, metro.perBar, tickIndex(c.f.start, metro.tickSec));
          player.playChord([accent ? 96 : 91], 0.05, accent ? 0.55 : 0.3); // high, short: a tick
        }
      }
      const st = stepAt(steps, t);
      const snd = soundingAt(fragNotes, t);
      const sig = `${st}|${snd.map((x) => x.pitch).join(',')}`;
      if (sig !== last) {
        last = sig;
        setPlay({ step: st, sounding: snd });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playingFragment, player, steps, fragNotes, metro]);

  const stopPlayback = () => {
    if (player.state !== 'stopped') player.stop();
    setMode(null);
  };

  const playStepSound = (s: CardStep | undefined) => {
    if (!s) return;
    const longest = Math.max(...s.notes.map((x) => x.duration));
    player.playChord(s.pitches, Math.min(3, Math.max(0.35, longest / speed)));
  };

  const toggleFragment = () => {
    if (playingFragment) return stopPlayback();
    if (!f || n === 0) return;
    setPlay({ step: -1, sounding: [] });
    setMode('fragment');
    startFragment(f, speed, along, loop);
  };

  const changeSpeed = (v: number) => {
    setSpeed(v);
    if (player.state === 'playing') player.setRate(v);
  };

  // ── navigation ──────────────────────────────────────────────────────────
  const goStep = (i: number) => {
    stopPlayback();
    setStep(Math.max(0, Math.min(n, i)));
  };
  // Functional updates, so two taps landing before a re-render still move two steps.
  const next = () => {
    const c = ctx.current;
    if (c.done) return;
    stopPlayback();
    if (c.playing) setStep(Math.min(n, shown + 1));
    else setStep((s) => Math.min(n, s + 1));
  };
  const back = () => {
    const c = ctx.current;
    stopPlayback();
    if (c.playing) setStep(Math.max(0, shown - 1));
    else setStep((s) => Math.max(0, s - 1));
  };
  const tapCard = (i: number) => {
    stopPlayback();
    setStep(i);
    playStepSound(steps[i]);
  };
  const selectFragment = (i: number) => {
    if (i < 0 || i > lastFrag) return;
    stopPlayback();
    setFrag(i);
    setStep(0);
    setFinished(false);
  };
  const again = () => {
    if (!finished) recordProgress({ fragmentPosition: frag, attempt: true });
    setFinished(false);
    goStep(0);
  };
  const gotIt = () => {
    recordProgress({ fragmentPosition: frag, attempt: true, status: 'mastered' });
    if (frag < lastFrag) selectFragment(frag + 1);
    else setFinished(true);
  };

  const actions = useRef({ next, back });
  actions.current = { next, back };

  // Space / → = Next, ← = Back (keys a…l etc. belong to the shell's computer-keyboard piano).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable))
        return;
      // A shell dialog is open (soft coupling to the shell's class name; see the fix report).
      if (document.querySelector('.sheet-backdrop')) return;
      // Space activates whatever button has focus; it means "Next" only with nothing focused, or on
      // the step strip.
      if (e.key === ' ' && !spaceIsNext(el, rootRef.current)) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault(); // Space must not also "click" the focused button
        actions.current.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        actions.current.back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Optional check: on-screen / computer-keyboard presses that complete the step advance it.
  useEffect(() => {
    pressed.current.clear();
  }, [frag, step]);
  useEffect(
    () =>
      input.subscribe((e) => {
        if (e.type === 'off') {
          marks.current.delete(e.pitch);
          bump((x) => x + 1);
          return;
        }
        const c = ctx.current;
        const s = c.steps[c.step];
        if (c.playing || c.done || !s) {
          bump((x) => x + 1);
          return;
        }
        if (s.pitches.includes(e.pitch)) {
          marks.current.set(e.pitch, 'ok');
          pressed.current.add(e.pitch);
        } else marks.current.set(e.pitch, 'bad');
        if (isStepPlayed(pressed.current, s)) {
          const to = c.step + 1;
          pressed.current.clear();
          c.step = to; // guard against a second event before re-render (c is ctx.current)
          setStep(to);
        }
        bump((x) => x + 1);
      }),
    [input],
  );

  // ── keyboard highlights ─────────────────────────────────────────────────
  // Press now = filled in the hand's colour; still held from an earlier step = striped ("hold");
  // coming up next = a ring in that note's hand colour, on top of the fill for a repeated note.
  const highlights = new Map<number, KeyHighlight>();
  const press = (x: LessonNote) => highlights.set(x.pitch, { mark: handOf(x), hand: handOf(x), label: fingerLabel(x) });
  const hold = (x: LessonNote) => highlights.set(x.pitch, { mark: 'hold', hand: handOf(x) });
  if (playingFragment) {
    const onset = steps[play.step]?.time ?? -Infinity;
    for (const x of play.sounding) (x.start < onset - TIME_EPS ? hold : press)(x);
  } else if (!done) {
    for (const x of heldOver(steps, step)) hold(x);
    for (const x of steps[step].notes) press(x);
  }
  const upcoming = done ? undefined : steps[(playingFragment ? play.step : step) + 1];
  if (upcoming)
    for (const x of upcoming.notes) {
      const h = highlights.get(x.pitch);
      highlights.set(x.pitch, h ? { ...h, next: true } : { mark: 'next', hand: handOf(x) });
    }
  for (const p of input.held) highlights.set(p, { mark: marks.current.get(p) ?? 'hint' });

  if (!f) {
    return <p className="muted" style={{ padding: 16 }}>{tr(lang, 'noFragments')}</p>;
  }

  const overlay = done ? (
    <div className="cv-done">
      <div className="cv-done-card card" role="group" aria-label={tr(lang, finished ? 'allDoneTitle' : 'doneTitle')}>
        <h3>{tr(lang, finished ? 'allDoneTitle' : 'doneTitle')}</h3>
        <p className="muted">{n === 0 ? tr(lang, 'emptyFragment') : tr(lang, finished ? 'allDoneText' : 'doneAsk')}</p>
        <div className="cv-done-actions">
          <button type="button" className="btn big" onClick={again}>
            ⟲ {tr(lang, 'again')}
          </button>
          {finished ? (
            <button type="button" className="btn big primary" onClick={() => selectFragment(0)}>
              {tr(lang, 'fromStart')}
            </button>
          ) : (
            <button type="button" className="btn big primary" onClick={gotIt}>
              ✓ {tr(lang, frag < lastFrag ? 'gotIt' : 'gotItLast')}
            </button>
          )}
          {!finished && frag < lastFrag && (
            <button type="button" className="btn big" onClick={() => selectFragment(frag + 1)}>
              {tr(lang, 'nextFragmentHint')} ›
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="cv-root" ref={rootRef}>
      <FragmentBar fragments={fragments} current={frag} progress={progress} lang={lang} onSelect={selectFragment} />

      <StepStrip
        steps={steps}
        current={done ? n : shown}
        hasLeft={hasLeft}
        noteNames={settings.noteNames}
        lang={lang}
        onTap={tapCard}
        onSwipe={(dir) => (dir > 0 ? next() : back())}
        overlay={overlay}
      />

      <div className="cv-caption" aria-live="polite">
        {countingIn ? (
          <span className="cv-say">{tr(lang, 'countIn')}</span>
        ) : done ? null : (
          <>
            <span className="cv-stepno">
              {tr(lang, 'step')} {shown + 1} {tr(lang, 'of')} {n}
            </span>
            <Caption steps={steps} index={shown} lang={lang} system={settings.noteNames} />
          </>
        )}
        <span className="cv-navhint muted">{tr(lang, 'navHint')}</span>
      </div>

      <div className="cv-controls">
        <button type="button" className="btn big cv-step-nav" onClick={back} disabled={done ? n === 0 : shown <= 0}>
          ‹ {tr(lang, 'back')}
        </button>
        <div className="cv-listen">
          <button
            type="button"
            className="btn big"
            onClick={() => {
              stopPlayback();
              playStepSound(steps[step]);
            }}
            disabled={done}
            title={tr(lang, 'playStepHint')}
          >
            ▶ {tr(lang, 'playStep')}
          </button>
          <button
            type="button"
            className="btn big"
            aria-pressed={playingFragment}
            onClick={toggleFragment}
            disabled={n === 0}
            title={tr(lang, 'playFragmentHint')}
          >
            <span className="cv-swap">
              <span aria-hidden={playingFragment}>▶ {tr(lang, 'playFragment')}</span>
              <span aria-hidden={!playingFragment}>■ {tr(lang, 'stop')}</span>
            </span>
          </button>
          <button
            type="button"
            className="btn big"
            aria-pressed={loop}
            onClick={() => setLoop((v) => !v)}
            title={tr(lang, 'loopHint')}
          >
            ⟳ {tr(lang, 'loop')}
          </button>
          <button
            type="button"
            className="btn big"
            aria-pressed={along}
            onClick={() => setAlong((v) => !v)}
            title={tr(lang, 'playAlongHint')}
          >
            ♩ {tr(lang, 'playAlong')}
          </button>
          <div className="seg cv-speed" role="group" aria-label={tr(lang, 'speed')}>
            {SPEEDS.map((v) => (
              <button key={v} type="button" aria-pressed={Math.abs(speed - v) < 0.01} onClick={() => changeSpeed(v)}>
                {Math.round(v * 100)}%
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn big primary cv-step-nav" onClick={next} disabled={done}>
          {tr(lang, 'next')} ›
        </button>
      </div>

      <PianoKeyboard
        range={range}
        highlights={highlights}
        labels={settings.keyLabels}
        noteNames={settings.noteNames}
        height="26vh"
        className="cv-keys"
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

/** Space means "Next" with nothing focused, or with focus on the step strip — never on another button. */
function spaceIsNext(el: HTMLElement | null, root: HTMLElement | null): boolean {
  if (!el || el === document.body || el === document.documentElement) return true;
  if (!root?.contains(el)) return false;
  if (el.closest('.cv-viewport')) return true; // a step card: Space moves on, as before the tap
  return !el.closest('button, a[href], [role="button"], [role="tab"]');
}

/** "Press E4" · "Press together C4 + E4" · "Together: right E4 · left C3" (+ "keep holding C3"). */
function Caption({
  steps,
  index,
  lang,
  system,
}: {
  steps: CardStep[];
  index: number;
  lang: VariantProps['lang'];
  system: VariantProps['settings']['noteNames'];
}) {
  const s = steps[index];
  if (!s) return null;
  const kind = stepKind(s);
  const held = heldOver(steps, index);
  const names = (ps: number[], hand: 'R' | 'L') =>
    ps.map((p, i) => (
      <span key={p}>
        {i > 0 && ' + '}
        <NoteName pitch={p} system={system} className={`cv-hand-${hand}`} />
      </span>
    ));
  const lane = (h: 'R' | 'L') => s.lanes[h]!;
  return (
    <span className="cv-say">
      {kind === 'hands' ? (
        <>
          {tr(lang, 'bothTogether')}: {tr(lang, 'right')} {names(lane('R').pitches, 'R')} · {tr(lang, 'left')}{' '}
          {names(lane('L').pitches, 'L')}
        </>
      ) : (
        <>
          {tr(lang, kind === 'chord' ? 'pressTogether' : 'press')}{' '}
          {names(s.pitches, s.lanes.R ? 'R' : 'L')}
        </>
      )}
      {held.length > 0 && (
        <span className="cv-held">
          {' · '}
          {tr(lang, 'keepHolding')}{' '}
          {held.map((x, i) => (
            <span key={`${x.pitch}${i}`}>
              {i > 0 && ', '}
              <NoteName pitch={x.pitch} system={system} className={`cv-hand-${handOf(x)}`} />
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
