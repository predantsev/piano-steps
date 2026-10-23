// Variant C — "Sheet + keys": real notation in sync with the keyboard.
import {
  groupSteps,
  isBlackKey,
  keyboardRange,
  notesInRange,
  pitchName,
  soundingAt,
  type Hand,
  type LessonNote,
} from '@piano-steps/core';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { PianoKeyboard, type KeyHighlight } from '../../ui/PianoKeyboard.tsx';
import type { VariantProps } from '../../variant.ts';
import { buildScore, measuresForFragment, noteLocations, secToTick } from './quantize.ts';
import { drawFragment, musicFontReady, nearestHead, toLogical, type Drawn } from './render.ts';
import { s } from './strings.ts';
import './sheet.css';

const SPEEDS = [0.25, 0.5, 0.75, 1] as const;
const PREFS_KEY = 'piano-steps-sheet';
const PROBE_MS = 2500;
/** How far ahead of the heard time the cursor moves to the next step, in real seconds. */
const LOOKAHEAD_SEC = 0.02;
/** Narrowest on-screen key (CSS px) before the keyboard shrinks to the fragment's notes. */
const MIN_KEY_PX = 44;

type Mode = 'listen' | 'step';
interface Prefs {
  names: boolean;
  colours: boolean;
  mode: Mode;
  loop: boolean;
  /** The "tap a note / tap a key" hint was dismissed. */
  hintSeen: boolean;
}
/** What the user just pointed at: a note on the staff or a key. */
interface Probe {
  pitch: number;
  /** Set when a staff note was tapped: that exact lesson note. */
  index?: number;
  hand?: Hand;
  at: number;
}

function readPrefs(): Prefs {
  const d: Prefs = { names: true, colours: true, mode: 'listen', loop: false, hintSeen: false };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return d;
  }
}

const handOf = (n: Pick<LessonNote, 'hand' | 'pitch'>): Hand => n.hand ?? (n.pitch < 60 ? 'L' : 'R');
const nearestSpeed = (v: number) => SPEEDS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), 1 as number);

export default function SheetVariant({
  lesson,
  player,
  input,
  settings,
  lang,
  progress,
  recordProgress,
  onFragmentChange,
}: VariantProps) {
  const [frag, setFrag] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [speed, setSpeed] = useState(() => nearestSpeed(settings.speed));
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(player.state === 'playing');
  const [fontReady, setFontReady] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [keyMarks, setKeyMarks] = useState<Map<number, KeyHighlight>>(() => new Map());
  const [probe, setProbe] = useState<Probe | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  /** Listen mode: this fragment was heard to its end at least once → offer "Next fragment". */
  const [heard, setHeard] = useState(false);
  const [fabW, setFabW] = useState<number | null>(null);
  const [chipEdges, setChipEdges] = useState({ l: false, r: false });

  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const drawnRef = useRef<Drawn | null>(null);
  const runRef = useRef<number | null>(null); // fragment index of the current playback run
  // a Step-mode run counts once, and only when it was walked with Next from the first step
  const walkRef = useRef({ walked: true, recorded: false });
  const spaceRef = useRef(false); // our keydown took this Space, so its keyup must not click a button
  const chipsRef = useRef<HTMLDivElement>(null);

  const fragments = lesson.fragments.length ? lesson.fragments : [{ title: '#1', start: 0, end: lesson.durationSec }];
  const f = fragments[Math.min(frag, fragments.length - 1)];

  const score = useMemo(
    () => buildScore(lesson.notes, { tempo: lesson.tempo, fragments: lesson.fragments }),
    [lesson],
  );
  // membership: core's window in seconds — exactly what the player plays; the bars follow it
  const fragNotes = useMemo(() => notesInRange(lesson.notes, f.start, f.end), [lesson, f.start, f.end]);
  const steps = useMemo(() => groupSteps(fragNotes), [fragNotes]);
  const indexOf = useMemo(() => new Map(lesson.notes.map((n, i) => [n, i])), [lesson]);
  const inside = useMemo(() => new Set(fragNotes.map((n) => indexOf.get(n)!)), [fragNotes, indexOf]);
  const locations = useMemo(() => noteLocations(score), [score]);
  const measures = useMemo(
    () => measuresForFragment(score, f.start, f.end, inside, locations),
    [score, f.start, f.end, inside, locations],
  );
  // the whole lesson's range when its keys are wide enough to tap; else just this fragment's notes
  const lessonRange = useMemo(() => keyboardRange(lesson.notes.map((n) => n.pitch)), [lesson]);
  const fragRange = useMemo(() => keyboardRange(fragNotes.map((n) => n.pitch)), [fragNotes]);
  const whiteKeys = ([lo, hi]: [number, number]) => {
    let k = 0;
    for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) k++;
    return k;
  };
  // a wide fragment: trim the C…B padding down to its lowest and highest note (white-key edges)
  const tightRange = useMemo((): [number, number] => {
    const ps = fragNotes.map((n) => n.pitch);
    if (!ps.length) return fragRange;
    const lo = Math.min(...ps);
    const hi = Math.max(...ps);
    return [isBlackKey(lo) ? lo - 1 : lo, isBlackKey(hi) ? hi + 1 : hi];
  }, [fragNotes, fragRange]);
  const fits = (r: [number, number]) => !size || size.w / whiteKeys(r) >= MIN_KEY_PX;
  const range = fits(lessonRange) || !fragNotes.length ? lessonRange : fits(fragRange) ? fragRange : tightRange;
  const isLast = measures.length > 0 && measures[measures.length - 1].index === score.measures.length - 1;

  // ── wiring to the shell ──────────────────────────────────────────────────
  useEffect(() => onFragmentChange(frag), [frag, onFragmentChange]);
  useEffect(() => {
    player.stop();
    setStepIdx(0);
    setHeard(false);
    walkRef.current = { walked: true, recorded: false };
  }, [frag, player]);
  useEffect(() => () => player.stop(), [player]);

  const savePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });
  }, []);

  useEffect(
    () =>
      player.subscribe((e) => {
        if (e.type === 'state') setPlaying(e.state === 'playing');
        if ((e.type === 'end' || e.type === 'loop') && runRef.current !== null)
          recordProgress({ fragmentPosition: runRef.current, attempt: true });
        if (e.type === 'end' && runRef.current !== null) setHeard(true);
        if (e.type === 'end') runRef.current = null;
      }),
    [player, recordProgress],
  );

  // ── drawing (only on fragment / size / toggle changes — never per frame) ──
  useEffect(() => {
    let alive = true;
    void musicFontReady().then(() => alive && setFontReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paintSig = useRef('');
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !fontReady || !size || size.w < 50) return;
    try {
      drawnRef.current = drawFragment(host, score, measures, {
        width: size.w,
        height: Math.max(120, size.h - 8),
        names: prefs.names,
        nameSystem: settings.noteNames,
        inside,
        window: [secToTick(score, f.start), secToTick(score, f.end)],
        isLast,
        idPrefix: `ps-sheet-${frag}`,
      });
      drawnRef.current.svg.setAttribute('aria-label', `${lesson.title} · ${f.title ?? `#${frag + 1}`}`);
      setDrawError(null);
    } catch (err) {
      console.error('[sheet] draw failed', err);
      drawnRef.current = null;
      host.replaceChildren();
      setDrawError(err instanceof Error ? err.message : String(err));
    }
    paintSig.current = ''; // repaint highlights onto the new drawing
  }, [fontReady, size, score, measures, inside, prefs.names, settings.noteNames, isLast, frag, f, lesson.title]);

  // ── live sync: one rAF loop reads the player and paints classes + keys ────
  const live = useRef({ mode: prefs.mode, stepIdx, steps, fragNotes, probe, indexOf, inside, speed });
  live.current = { mode: prefs.mode, stepIdx, steps, fragNotes, probe, indexOf, inside, speed };
  const keySig = useRef('');

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const L = live.current;
      const isPlaying = player.state === 'playing';
      const active = new Set<number>();
      let cursorIdx: number | null = null;
      const marks = new Map<number, KeyHighlight>();

      if (isPlaying) {
        // what sounds now: notes of the step under the cursor are "press now", notes struck in an
        // earlier step and still sounding are "hold"; the step's own keys stay lit through their
        // short release gap — except a key struck again next, which blinks off so the repeat shows
        const t = player.time;
        let cur = -1;
        const ahead = LOOKAHEAD_SEC * L.speed; // real-time look-ahead, in lesson seconds
        for (let i = 0; i < L.steps.length && L.steps[i].time <= t + ahead; i++) cur = i;
        const step = cur >= 0 ? L.steps[cur] : null;
        const again = new Set(L.steps[cur + 1]?.pitches ?? []);
        for (const n of soundingAt(L.fragNotes, t)) {
          active.add(L.indexOf.get(n)!);
          const held = !!step && !step.notes.includes(n) && n.start < step.time;
          if (!marks.has(n.pitch) || !held) marks.set(n.pitch, held ? { mark: 'hold', hand: handOf(n) } : { mark: handOf(n) });
        }
        if (step) {
          for (const n of step.notes) {
            const sounding = n.start + n.duration > t;
            if (!sounding && again.has(n.pitch)) continue;
            active.add(L.indexOf.get(n)!);
            marks.set(n.pitch, { mark: handOf(n) });
          }
          cursorIdx = L.indexOf.get(step.notes[0])!;
        }
        // a lit key that is struck again next carries the "next" ring on top of its fill
        for (const p of again) {
          const m = marks.get(p);
          if (m) marks.set(p, { ...m, hand: m.hand ?? (m.mark === 'L' ? 'L' : 'R'), next: true });
        }
      } else if (L.mode === 'step' && L.stepIdx < L.steps.length) {
        const cur = L.steps[L.stepIdx];
        // keys still held from an earlier step: striped, not "press now"
        for (const n of soundingAt(L.fragNotes, cur.time + 0.001))
          if (!cur.notes.includes(n) && n.start < cur.time) marks.set(n.pitch, { mark: 'hold', hand: handOf(n) });
        for (const n of cur.notes) {
          active.add(L.indexOf.get(n)!);
          marks.set(n.pitch, { mark: handOf(n) });
        }
        // what comes next: a ring by hand; on a key that is lit now (a repeated note) the ring sits on the fill
        const nxt = L.steps[L.stepIdx + 1];
        if (nxt)
          for (const n of nxt.notes) {
            const m = marks.get(n.pitch);
            marks.set(n.pitch, m ? { ...m, hand: m.hand ?? handOf(n), next: true } : { mark: 'next', hand: handOf(n) });
          }
        cursorIdx = L.indexOf.get(cur.notes[0])!;
      } else if (L.mode === 'listen' && L.steps.length) {
        // at rest in Listen: ring where the fragment starts, so there is always something to copy
        for (const n of L.steps[0].notes) marks.set(n.pitch, { mark: 'next', hand: handOf(n) });
      }
      const pr = L.probe;
      if (pr) marks.set(pr.pitch, { mark: pr.hand ?? 'hint' });
      for (const p of input.held) marks.set(p, { mark: 'hint' });

      const d = drawnRef.current;
      if (d) {
        const sig = `${[...active].join(',')}|${cursorIdx}|${pr ? `${pr.pitch}:${pr.index ?? ''}` : ''}|${d.svg.isConnected}`;
        if (sig !== paintSig.current) {
          paintSig.current = sig;
          paint(d, active, cursorIdx, pr, L.inside);
        }
      }
      const ksig = [...marks].map(([p, h]) => `${p}${h.mark}${h.hand ?? ''}${h.next ? '+' : ''}`).join(',');
      if (ksig !== keySig.current) {
        keySig.current = ksig;
        setKeyMarks(marks);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player, input]);

  // a key press (screen or computer keyboard) shows where that key sits on the staff
  useEffect(
    () =>
      input.subscribe((e) => {
        if (e.type === 'on') setProbe({ pitch: e.pitch, at: performance.now() });
      }),
    [input],
  );
  useEffect(() => {
    if (!probe) return;
    const id = setTimeout(() => setProbe((p) => (p === probe ? null : p)), PROBE_MS);
    return () => clearTimeout(id);
  }, [probe]);

  // ── actions ──────────────────────────────────────────────────────────────
  const playFragment = useCallback(
    (loop = prefs.loop) => {
      runRef.current = frag;
      player.play({ from: f.start, to: f.end, rate: speed, loop });
    },
    [player, f.start, f.end, speed, prefs.loop, frag],
  );
  const togglePlay = useCallback(() => {
    if (player.state === 'playing') {
      runRef.current = null;
      player.stop();
    } else playFragment();
  }, [player, playFragment]);

  const soundStep = useCallback(
    (i: number) => {
      const st = steps[i];
      if (!st) return;
      const len = Math.max(...st.notes.map((n) => n.duration)) / speed;
      player.playChord(st.pitches, Math.min(1.6, Math.max(0.35, len)));
    },
    [player, steps, speed],
  );
  const goStep = useCallback(
    (i: number, sound = true) => {
      const k = Math.max(0, Math.min(steps.length, i));
      setStepIdx(k);
      if (k === steps.length) {
        const w = walkRef.current;
        if (steps.length && w.walked && !w.recorded) {
          w.recorded = true;
          recordProgress({ fragmentPosition: frag, attempt: true });
        }
      } else if (sound) soundStep(k);
    },
    [steps.length, soundStep, recordProgress, frag],
  );
  const hasNextFrag = frag < fragments.length - 1;
  const nextFragment = useCallback(() => {
    if (frag < fragments.length - 1) setFrag(frag + 1);
  }, [frag, fragments.length]);
  const again = useCallback(() => {
    if (player.state === 'playing') player.stop();
    walkRef.current = { walked: true, recorded: false };
    goStep(0);
  }, [goStep, player]);
  const next = useCallback(() => {
    if (player.state === 'playing') player.stop();
    // at the end of the fragment Next goes on to the next fragment (Again is the second button)
    if (stepIdx >= steps.length) return hasNextFrag ? nextFragment() : again();
    goStep(stepIdx + 1);
  }, [goStep, stepIdx, steps.length, player, hasNextFrag, nextFragment, again]);
  const back = useCallback(() => goStep(Math.max(0, Math.min(stepIdx, steps.length) - 1)), [goStep, stepIdx, steps.length]);

  const setMode = (mode: Mode) => {
    player.stop();
    runRef.current = null;
    savePrefs({ mode });
    setStepIdx(0);
    walkRef.current = { walked: true, recorded: false };
  };
  const changeSpeed = (v: number) => {
    setSpeed(v);
    if (player.state === 'playing') player.setRate(v);
  };
  const toggleLoop = () => {
    const loop = !prefs.loop;
    savePrefs({ loop });
    if (player.state === 'playing') playFragment(loop);
  };
  const gotIt = () => {
    recordProgress({ fragmentPosition: frag, status: 'mastered' });
    if (frag < fragments.length - 1) setFrag(frag + 1);
  };

  // Space / arrows: Next and Back in step mode, play/stop in listen mode
  useEffect(() => {
    const typing = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    // a focused shell control (variant tabs, ⚙, dialogs) keeps its own Space
    const shellControl = (el: EventTarget | null) =>
      el instanceof HTMLElement && !!el.closest('button, a, select, [role="tab"]') && !el.closest('.sv');
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('.sheet-backdrop')) return;
      if (shellControl(e.target)) return;
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.key === ' ') spaceRef.current = true;
        if (e.repeat) return;
        if (prefs.mode === 'step') (e.key === 'ArrowLeft' ? back : next)();
        else if (e.key === ' ') togglePlay();
      }
    };
    // a focused button of ours must not also "click" on the release of a Space we handled
    const up = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !spaceRef.current) return;
      spaceRef.current = false;
      e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [prefs.mode, next, back, togglePlay]);

  // tap on the staff → the nearest note head: hear it, see its key; in step mode move the cursor there
  const onStaffPointer = (e: PointerEvent<HTMLDivElement>) => {
    const d = drawnRef.current;
    if (!d) return;
    const { x, y } = toLogical(d, e.clientX, e.clientY);
    // ≥ 26 CSS px radius at any zoom (a ≥ 44 px touch target around every note head)
    const h = nearestHead(d, x, y, Math.max(34, 26 / d.zoom));
    if (!h) return;
    const note = lesson.notes[h.index];
    player.playChord([h.pitch], Math.min(1.2, Math.max(0.4, note.duration / speed)));
    setProbe({ pitch: h.pitch, index: h.index, hand: handOf(note), at: performance.now() });
    if (prefs.mode === 'step') {
      const k = steps.findIndex((st) => st.notes.includes(note));
      if (k > stepIdx + 1) walkRef.current.walked = false; // jumped ahead: not a walked run
      if (k >= 0) setStepIdx(k);
    }
  };

  // the shell's floating buttons (⚑ sounds wrong, 🎧 original) sit over the chips row: reserve their real width
  useLayoutEffect(() => {
    const fab = document.querySelector<HTMLElement>('.fab');
    if (!fab) return setFabW(0);
    const measure = () => setFabW(fab.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(fab);
    return () => ro.disconnect();
  }, []);

  // keep the active chip in view and show which edges can still scroll
  const updateChipEdges = useCallback(() => {
    const el = chipsRef.current;
    if (!el) return;
    const l = el.scrollLeft > 1;
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setChipEdges((p) => (p.l === l && p.r === r ? p : { l, r }));
  }, []);
  useLayoutEffect(() => {
    const el = chipsRef.current;
    const chip = el?.children[frag] as HTMLElement | undefined;
    if (el && chip) {
      const box = el.getBoundingClientRect();
      const c = chip.getBoundingClientRect();
      const pad = 24;
      if (c.left < box.left + pad) el.scrollLeft -= box.left + pad - c.left;
      else if (c.right > box.right - pad) el.scrollLeft += c.right - (box.right - pad);
    }
    updateChipEdges();
  }, [frag, fabW, size, updateChipEdges]);

  // ── render ───────────────────────────────────────────────────────────────
  const status = (i: number) => progress.find((p) => p.fragmentPosition === i);
  const probeMissing =
    probe && probe.index === undefined && !fragNotes.some((n) => n.pitch === probe.pitch) ? probe.pitch : null;
  const approx = score.tempoEstimated || score.snapError > 0.12;
  const done = prefs.mode === 'step' && stepIdx >= steps.length && steps.length > 0;

  return (
    <div className={`sv ${prefs.colours ? 'sv-colour' : ''}`}>
      <div className="sv-top" style={fabW !== null ? ({ '--sv-fab': `${Math.ceil(fabW) + 20}px` } as CSSProperties) : undefined}>
        <button
          className="btn sv-arrow"
          aria-label={s(lang, 'prevFragment')}
          disabled={frag === 0}
          onClick={() => setFrag(frag - 1)}
        >
          ‹
        </button>
        <div
          className={`sv-chips ${chipEdges.l ? 'fade-l' : ''} ${chipEdges.r ? 'fade-r' : ''}`}
          role="tablist"
          aria-label={s(lang, 'fragments')}
          ref={chipsRef}
          onScroll={updateChipEdges}
        >
          {fragments.map((fr, i) => {
            const st = status(i);
            return (
              <button
                key={i}
                role="tab"
                aria-selected={i === frag}
                className={`sv-chip ${i === frag ? 'on' : ''} ${st?.status === 'mastered' ? 'mastered' : ''}`}
                onClick={() => setFrag(i)}
                aria-label={`${fr.title ?? `#${i + 1}`}${st?.status === 'mastered' ? ` · ${s(lang, 'mastered')}` : ''}`}
              >
                {st?.status === 'mastered' ? '✓ ' : st && st.attempts > 0 ? '• ' : ''}
                {fr.title ?? `#${i + 1}`}
              </button>
            );
          })}
        </div>
        <button
          className="btn sv-arrow"
          aria-label={s(lang, 'nextFragment')}
          disabled={frag >= fragments.length - 1}
          onClick={() => setFrag(frag + 1)}
        >
          ›
        </button>
        <button className={`btn sv-got ${status(frag)?.status === 'mastered' ? 'on' : ''}`} onClick={gotIt}>
          ✓ {s(lang, 'gotIt')}
        </button>
      </div>

      <div className="sv-stage" ref={stageRef} onPointerDown={onStaffPointer}>
        <div className="sv-host" ref={hostRef} />
        {!fontReady && <p className="muted sv-msg">{s(lang, 'loadingFont')}</p>}
        {drawError && <p className="sv-msg sv-err">{drawError}</p>}
        {fontReady && !fragNotes.length && <p className="muted sv-msg">{s(lang, 'noNotes')}</p>}
        <div className="sv-overlay">
          {probeMissing !== null && (
            <span className="sv-pill">
              {pitchName(probeMissing, settings.noteNames)} — {s(lang, 'notHere')}
            </span>
          )}
          {approx && (
            <span className="sv-pill muted">
              {s(lang, 'approx')}
              {score.tempoEstimated ? ` · ${s(lang, 'estimated')} ≈ ${Math.round(score.bpm)}` : ''}
            </span>
          )}
        </div>
      </div>

      {!prefs.hintSeen && fontReady && fragNotes.length > 0 && (
        <div className="sv-hint">
          {s(lang, 'tapHint')}
          <button className="sv-hint-x" aria-label={s(lang, 'dismiss')} onClick={() => savePrefs({ hintSeen: true })}>
            ✕
          </button>
        </div>
      )}
      <div className="sv-controls">
        <div className="seg" role="radiogroup">
          <button aria-pressed={prefs.mode === 'listen'} onClick={() => setMode('listen')}>
            ♪ {s(lang, 'listen')}
          </button>
          <button aria-pressed={prefs.mode === 'step'} onClick={() => setMode('step')}>
            ⇥ {s(lang, 'step')}
          </button>
        </div>

        {prefs.mode === 'listen' ? (
          <>
            <button className="btn big primary sv-main" onClick={togglePlay}>
              {playing ? `■ ${s(lang, 'stop')}` : `▶ ${s(lang, 'play')}`}
            </button>
            <button className="btn" aria-pressed={prefs.loop} onClick={toggleLoop} data-on={prefs.loop}>
              ⟲ {s(lang, 'loop')}
            </button>
            {heard && !playing && hasNextFrag && (
              <button className="btn big" onClick={nextFragment}>
                {s(lang, 'nextFragment')} ›
              </button>
            )}
          </>
        ) : (
          <>
            <button className="btn big" onClick={back} disabled={stepIdx === 0}>
              ‹ {s(lang, 'back')}
            </button>
            <button className="btn big primary sv-main" onClick={next}>
              {done ? (hasNextFrag ? `${s(lang, 'nextFragment')} ›` : `⟲ ${s(lang, 'again')}`) : `${s(lang, 'next')} ›`}
              <span className="sv-kbd">{s(lang, 'spaceHint')}</span>
            </button>
            {done && hasNextFrag && (
              <button className="btn big" onClick={again}>
                ⟲ {s(lang, 'again')}
              </button>
            )}
            <span className="sv-count mono" aria-label={done ? s(lang, 'done') : `${s(lang, 'stepOf')} ${Math.min(stepIdx + 1, steps.length)} / ${steps.length}`}>
              {done ? `✓ ${s(lang, 'doneShort')}` : `${Math.min(stepIdx + 1, steps.length)} / ${steps.length}`}
            </span>
          </>
        )}

        <div className="seg" role="radiogroup" aria-label={s(lang, 'speed')}>
          {SPEEDS.map((v) => (
            <button key={v} aria-pressed={speed === v} onClick={() => changeSpeed(v)}>
              {v * 100}%
            </button>
          ))}
        </div>

        <span className="spacer" />
        <button
          className="btn"
          aria-pressed={prefs.names}
          data-on={prefs.names}
          title={s(lang, 'namesHint')}
          onClick={() => savePrefs({ names: !prefs.names })}
        >
          {settings.noteNames === 'solfege' ? 'До' : 'C'} {s(lang, 'names')}
        </button>
        <button
          className="btn"
          aria-pressed={prefs.colours}
          data-on={prefs.colours}
          title={s(lang, 'coloursHint')}
          onClick={() => savePrefs({ colours: !prefs.colours })}
        >
          <span className="sv-dot sv-dot-r" />
          <span className="sv-dot sv-dot-l" /> {s(lang, 'colours')}
        </button>
      </div>

      <PianoKeyboard
        range={range}
        highlights={keyMarks}
        labels={settings.keyLabels}
        noteNames={settings.noteNames}
        height="clamp(120px, 24vh, 220px)"
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

/** Toggle highlight classes on the drawn notation (no re-draw). */
function paint(d: Drawn, active: Set<number>, cursorIdx: number | null, probe: Probe | null, inside: ReadonlySet<number>) {
  let cursorHead = null as Drawn['heads'][number] | null;
  for (const h of d.heads) {
    const on = active.has(h.index);
    const pr = !!probe && (probe.index !== undefined ? probe.index === h.index : probe.pitch === h.pitch && inside.has(h.index));
    h.el?.classList.toggle('ps-on', on);
    h.el?.classList.toggle('ps-probe', pr);
    h.label?.classList.toggle('ps-on', on);
    h.label?.classList.toggle('ps-probe', pr);
    if (cursorIdx !== null && h.index === cursorIdx && !h.tied) cursorHead = h;
  }
  const c = d.cursor;
  if (cursorHead) {
    const sys = d.systems[d.events.get(cursorHead.eventId)?.system ?? 0];
    c.setAttribute('x', String(cursorHead.x - 15));
    c.setAttribute('width', '30');
    c.setAttribute('y', String(sys.top));
    c.setAttribute('height', String(sys.bottom - sys.top));
    c.classList.add('on');
  } else c.classList.remove('on');
}
