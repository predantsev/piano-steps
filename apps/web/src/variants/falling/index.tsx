// Variant A — "Falling notes" (Synthesia-style): coloured bars fall onto the keys; loop, slow-down,
// hands, and a wait mode that stops at every step until the user has played it on the real piano.
import { notesInRange, pitchName, type Fragment, type FragmentProgress, type LessonNote } from '@piano-steps/core';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import * as Tone from 'tone';
import { PianoKeyboard, type KeyHighlight } from '../../ui/PianoKeyboard.tsx';
import type { VariantProps } from '../../variant.ts';
import { PracticeEngine, type PracticeOptions } from './engine.ts';
import { fitRange, keyGeometry } from './geometry.ts';
import { barRect, drawLane, readColors, type LaneColors } from './lane.ts';
import { keyMarks, marksSignature } from './marks.ts';
import { FragmentNoteMenu } from './FragmentNoteMenu.tsx';
import { NoteMenu } from './NoteMenu.tsx';
import { s } from './strings.ts';
import { visibleBars, type Bar, type Hands } from './timeline.ts';
import './falling.css';

const SPEEDS = [0.25, 0.5, 0.75, 1] as const;
const LOOK_AHEADS = [2, 3, 5] as const;
/** ← / → move this many seconds of lesson time back / forward (#46). */
const SEEK_SEC = 3;
/** A lane swipe needs this much sideways travel; a tap moves at most TAP_SLOP_PX. */
const SWIPE_MIN_PX = 40;
const TAP_SLOP_PX = 10;
const PREFS_KEY = 'piano-steps-falling';

interface Prefs {
  rate: number;
  hands: Hands;
  loop: boolean;
  wait: boolean;
  sound: boolean;
  lookAhead: number;
}

/** Saved per browser: everything but the speed, which starts from the shell's `settings.speed`. */
function readPrefs(speed: number): Prefs {
  const rate = SPEEDS.reduce((best, x) => (Math.abs(x - speed) < Math.abs(best - speed) ? x : best), 1 as number);
  const base: Prefs = { rate, hands: 'both', loop: true, wait: false, sound: true, lookAhead: 3 };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      ...base,
      hands: saved.hands === 'R' || saved.hands === 'L' ? saved.hands : 'both',
      loop: typeof saved.loop === 'boolean' ? saved.loop : base.loop,
      wait: typeof saved.wait === 'boolean' ? saved.wait : base.wait,
      sound: typeof saved.sound === 'boolean' ? saved.sound : base.sound,
      lookAhead: LOOK_AHEADS.includes(saved.lookAhead as (typeof LOOK_AHEADS)[number]) ? saved.lookAhead! : base.lookAhead,
    };
  } catch {
    return base;
  }
}

function nextLookAhead(x: number): number {
  const i = LOOK_AHEADS.findIndex((v) => v === x);
  return LOOK_AHEADS[(i + 1) % LOOK_AHEADS.length];
}

function savePrefs(p: Prefs) {
  try {
    const { rate: _rate, ...rest } = p;
    localStorage.setItem(PREFS_KEY, JSON.stringify(rest));
  } catch {
    /* storage blocked */
  }
}

/**
 * Seconds from asking for a sound to hearing it: Tone's look-ahead + the device output latency.
 * The engine never subtracts it from `player.time` (that is already audible time, #10); it only
 * uses it to ask early — see `EngineHooks.audioLead`.
 */
function audioLead(): number {
  try {
    const ctx = Tone.getContext();
    const raw = ctx.rawContext as AudioContext;
    const out = raw.outputLatency || raw.baseLatency || 0;
    return ctx.lookAhead + (Number.isFinite(out) ? out : 0);
  } catch {
    return 0.1;
  }
}

function engineOptions(p: Prefs): PracticeOptions {
  return { rate: p.rate, hands: p.hands, loop: p.loop, wait: p.wait, sound: p.sound };
}

export default function FallingNotes({
  lesson,
  player,
  input,
  settings,
  lang,
  progress,
  recordProgress,
  onFragmentChange,
  reportNote,
  fragmentNotes = [],
  saveFragmentNote,
}: VariantProps) {
  const [fragIdx, setFragIdx] = useState<number | null>(lesson.fragments.length ? 0 : null);
  const playAfterSwitch = useRef(false);
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(settings.speed));
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [highlights, setHighlights] = useState<Map<number, KeyHighlight>>(() => new Map());

  // Keys sized to the fragment's notes (white keys ≥ 44 px on an iPad for the demo lessons).
  const range = useMemo(() => {
    const f = fragIdx === null ? undefined : lesson.fragments[fragIdx];
    const inFrag = f ? notesInRange(lesson.notes, f.start, f.end) : lesson.notes;
    return fitRange((inFrag.length ? inFrag : lesson.notes).map((n) => n.pitch));
  }, [lesson, fragIdx]);
  // A mouse/trackpad (and so, likely, a keyboard): only then is the Space hint worth showing.
  const [finePointer] = useState(() => {
    try {
      return matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
      return false;
    }
  });
  const keys = useMemo(() => keyGeometry(range), [range]);
  const lessonEnd = useMemo(() => lesson.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0), [lesson]);

  // Latest callbacks for the engine (it lives across renders).
  const paintRef = useRef<() => void>(() => {});
  const attemptRef = useRef<() => void>(() => {});
  attemptRef.current = () => {
    if (fragIdx !== null) recordProgress({ fragmentPosition: fragIdx, attempt: true });
  };

  const engine = useMemo(
    () =>
      new PracticeEngine(player, lesson.notes, engineOptions(prefs), {
        onAttempt: () => attemptRef.current(),
        onChange: () => {
          rerender();
          queueMicrotask(() => paintRef.current()); // keys follow presses at once, even if frames are throttled
        },
        audioLead,
      }),
    // prefs are pushed with setOptions below; the engine is per lesson + player
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player, lesson],
  );

  useEffect(() => engine.attach(), [engine]);

  useEffect(() => {
    const f: Fragment | undefined = fragIdx === null ? undefined : lesson.fragments[fragIdx];
    engine.setSpan(f ? { start: f.start, end: f.end } : { start: 0, end: lessonEnd });
    onFragmentChange(fragIdx);
    // "Go and play" (the small ▶ half of ‹ › or Shift + arrow): start the new fragment right away.
    // In wait mode it is already waiting on its first step, which is the same thing.
    if (playAfterSwitch.current) {
      playAfterSwitch.current = false;
      if (engine.phase === 'idle') engine.start();
    }
  }, [engine, fragIdx, lesson, lessonEnd, onFragmentChange]);

  useEffect(() => {
    engine.setOptions(engineOptions(prefs));
    savePrefs(prefs);
  }, [engine, prefs]);

  // On-screen / computer keyboard → wait-mode matching. The shell does not sound computer-keyboard
  // notes, so this variant does (the on-screen keys sound through onNoteOn below).
  useEffect(
    () =>
      input.subscribe((e) => {
        if (e.source === 'keyboard') {
          if (e.type === 'on') player.noteOn(e.pitch);
          else player.noteOff(e.pitch);
        }
        if (e.type === 'on') engine.noteOn(e.pitch);
        else rerender();
      }),
    [input, player, engine],
  );

  // Space = the big button (play / pause; the next step in wait mode); Shift+Space = back to the start;
  // ← / → = 3 s back / forward; Shift + ← / → = previous / next fragment; ⌥ + ← / → = switch and play.
  const fragCount = lesson.fragments.length;
  const mainActionRef = useRef<() => void>(() => {});
  const restartRef = useRef<() => void>(() => {});
  useEffect(() => {
    const typing = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const down = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || typing(ev) || document.querySelector('.sheet-backdrop, .fl-menu-backdrop')) return;
      const arrow = ev.key === 'ArrowRight' || ev.key === 'ArrowLeft';
      if (ev.altKey && !arrow) return;
      if (ev.code === 'Space' || ev.key === ' ') {
        ev.preventDefault();
        if (!ev.repeat) {
          void player.unlock();
          (ev.shiftKey ? restartRef : mainActionRef).current();
        }
      } else if (arrow) {
        ev.preventDefault();
        const dir = ev.key === 'ArrowRight' ? 1 : -1;
        if (!ev.shiftKey && !ev.altKey) {
          // plain arrow = 3 s back / forward inside the fragment
          void player.unlock();
          engine.seek(dir * SEEK_SEC);
          return;
        }
        const andPlay = ev.altKey; // ⌥ + arrow = switch and play; Shift + arrow = just switch
        if (andPlay) void player.unlock();
        setFragIdx((i) => {
          // fragments, then "whole lesson" (null); stops at both ends, like the ‹ › buttons
          const cur = i === null ? fragCount : i;
          const nxt = Math.max(0, Math.min(fragCount, cur + dir));
          if (andPlay && nxt !== cur) playAfterSwitch.current = true;
          return nxt === fragCount ? null : nxt;
        });
      }
    };
    const up = (ev: KeyboardEvent) => {
      if ((ev.code === 'Space' || ev.key === ' ') && !typing(ev)) ev.preventDefault(); // no click on a focused button
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [engine, player, fragCount]);

  // Fragment chips stay on one line (#50); when they overflow, ‹ › at the ends scroll the row and the
  // current chip is scrolled into view.
  const fragsRef = useRef<HTMLDivElement>(null);
  const [fragsScroll, setFragsScroll] = useState({ over: false, left: false, right: false });
  const measureFrags = useCallback(() => {
    const el = fragsRef.current;
    if (!el) return;
    const over = el.scrollWidth > el.clientWidth + 1;
    const next = { over, left: over && el.scrollLeft > 1, right: over && el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
    setFragsScroll((p) => (p.over === next.over && p.left === next.left && p.right === next.right ? p : next));
  }, []);
  useEffect(() => {
    const el = fragsRef.current;
    if (!el) return;
    measureFrags();
    const ro = new ResizeObserver(measureFrags);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  }, [measureFrags, lesson]);
  useEffect(() => {
    const el = fragsRef.current;
    const cur = el?.querySelector<HTMLElement>(`[data-fragment="${fragIdx ?? 'all'}"]`);
    if (!el || !cur) return;
    const l = cur.offsetLeft - el.offsetLeft;
    if (l < el.scrollLeft || l + cur.offsetWidth > el.scrollLeft + el.clientWidth)
      el.scrollTo({ left: l - (el.clientWidth - cur.offsetWidth) / 2, behavior: 'smooth' });
  }, [fragIdx, fragsScroll.over]);
  const scrollFrags = (dir: number) => {
    const el = fragsRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  // Keep the top row clear of the shell's floating buttons (🎧 / ⚑ at the stage's top-right).
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const top = topRef.current;
    const fab = top?.closest('.stage')?.querySelector<HTMLElement>(':scope > .fab');
    if (!top || !fab) return;
    const fit = () => top.style.setProperty('--fl-fab-clear', `${Math.ceil(fab.getBoundingClientRect().width) + 16}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(fab);
    return () => ro.disconnect();
  }, []);

  // ── the lane: canvas sized to its box × devicePixelRatio, painted every animation frame ──
  const laneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const colorsRef = useRef<LaneColors | null>(null);
  const frameRef = useRef<{ bars: Bar[]; now: number }>({ bars: [], now: 0 });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const noteNamesRef = useRef(settings.noteNames);
  noteNamesRef.current = settings.noteNames;
  const sigRef = useRef('');

  useEffect(() => {
    const box = laneRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const resize = () => {
      const r = box.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      sizeRef.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      paintRef.current(); // resizing clears the canvas; repaint now rather than on the next frame
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    // devicePixelRatio changes (browser zoom, moving to another screen) do not resize the box
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', resize);
    // theme: System (no attribute, OS preference) · Light · Dark (data-theme on <html>)
    const recolor = () => {
      colorsRef.current = readColors(canvas);
      paintRef.current();
    };
    recolor();
    const mo = new MutationObserver(recolor);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', recolor);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', resize);
      mo.disconnect();
      scheme.removeEventListener('change', recolor);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const paint = () => {
      const now = engine.visualTime();
      const { lookAhead } = prefsRef.current;
      const bars = visibleBars(engine.notes, engine.span, now, lookAhead, engine.opts.loop, engine.opts.hands);
      frameRef.current = { bars, now };
      const marks = keyMarks({
        phase: engine.phase,
        bars,
        now,
        waiting: engine.waitingStep ? { step: engine.waitingStep, next: engine.upcomingStep } : null,
        pressed: engine.pressed,
        wrong: engine.wrong?.pitch ?? null,
        held: input.held,
      });
      const { w, h, dpr } = sizeRef.current;
      if (w > 0 && h > 0 && colorsRef.current)
        drawLane(ctx, {
          width: w,
          height: h,
          dpr,
          keys,
          bars,
          now,
          lookAhead,
          span: engine.span,
          loop: engine.opts.loop,
          colors: colorsRef.current,
          noteNames: noteNamesRef.current,
          focusTime: marks.focusTime,
        });
      const sig = marksSignature(marks.keys);
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setHighlights(marks.keys);
      }
    };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      engine.tick();
      paint();
    };
    paintRef.current = paint;
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      paintRef.current = () => {};
    };
  }, [engine, keys, input]);

  // Tap a falling bar: it pauses, sounds, and opens the note menu (hear / report / fix later).
  const [menu, setMenu] = useState<{ note: LessonNote; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // A horizontal swipe on the lane seeks (right = 3 s forward, left = back, #48); a tap — decided on
  // release, so a swipe that starts on a bar does not open its menu — hits a bar.
  const swipeRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const onLanePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button > 0) return;
    swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
  };
  const onLanePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      void player.unlock();
      engine.seek(Math.sign(dx) * SEEK_SEC);
      return;
    }
    if (Math.hypot(dx, dy) <= TAP_SLOP_PX) tapLane(e.currentTarget, start.x, start.y);
  };
  const tapLane = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const box = canvas.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    const { bars, now } = frameRef.current;
    const geo = { width: box.width, height: box.height, keys, now, lookAhead: prefs.lookAhead };
    let hit: Bar | null = null;
    for (const b of bars) {
      const r = barRect(b, geo);
      if (!r || x < r.x || x > r.x + r.w || y < r.top || y > r.bottom) continue;
      if (!hit || r.black) hit = b; // black keys are drawn on top
    }
    if (hit) {
      void player.unlock();
      if (engine.phase === 'playing' || engine.phase === 'preroll') engine.pause();
      player.playChord([hit.note.pitch], Math.min(2, Math.max(0.3, hit.note.duration / prefs.rate)), hit.note.velocity ?? 0.8);
      setMenu({ note: hit.note, x: clientX, y: clientY });
    }
  };

  // ── controls ──
  const set = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const progressOf = (i: number): FragmentProgress | undefined => progress.find((p) => p.fragmentPosition === i);
  const mastered = fragIdx !== null && progressOf(fragIdx)?.status === 'mastered';
  const phase = engine.phase;
  const waitingStep = engine.waitingStep;
  const noSteps = engine.steps.length === 0;
  const empty = engine.notes.length === 0;
  const canPlay = prefs.wait ? !noSteps : !empty;

  // Fragments in order, then the whole lesson: ‹ Previous / Next › walk this list (no wrap-around).
  const order: (number | null)[] = [...lesson.fragments.map((_, i) => i), null];
  const at = order.indexOf(fragIdx);
  const prevFrag = at > 0 ? order[at - 1] : undefined;
  const nextFrag = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;
  const fragName = (i: number | null | undefined) =>
    i === undefined ? '' : i === null ? s(lang, 'wholeLesson') : (lesson.fragments[i].title ?? `#${i + 1}`);
  /** ‹ › halves: switch to a fragment; `play` = start it at once ("go and play"). */
  const goTo = (target: number | null | undefined, play: boolean) => {
    if (target === undefined) return;
    if (play) {
      void player.unlock();
      playAfterSwitch.current = true;
    }
    setFragIdx(target);
  };
  const done = phase === 'done';
  // The big button is always the same thing: play / pause (Space); in wait mode it is the next step.
  mainActionRef.current = () => engine.primary();
  restartRef.current = () => engine.restart();

  let primaryLabel: string;
  let primaryIcon: string;
  if (prefs.wait && !done) {
    primaryIcon = '›';
    primaryLabel = s(lang, 'next');
  } else if (phase === 'playing' || phase === 'preroll') {
    primaryIcon = '❚❚';
    primaryLabel = s(lang, 'pause');
  } else {
    primaryIcon = '▶';
    primaryLabel = s(lang, 'play');
  }

  // Fragment notes: the Note button (current fragment) or holding / right-clicking a fragment number.
  const [fragMenu, setFragMenu] = useState<{ position: number; x: number; y: number } | null>(null);
  const closeFragMenu = useCallback(() => setFragMenu(null), []);
  const holdRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const noteOf = (i: number) => fragmentNotes.find((n) => n.fragmentPosition === i);
  const openFragMenu = (i: number, el: Element) => {
    if (!saveFragmentNote) return;
    const r = el.getBoundingClientRect();
    setFragMenu({ position: i, x: r.left, y: r.bottom });
  };
  const fragTitle = (i: number) => `${s(lang, 'fragNoteTitle')} ${lesson.fragments[i]?.title ?? `#${i + 1}`}`;

  const chip = (label: string, i: number | null) => {
    const pr = i === null ? undefined : progressOf(i);
    const isDone = pr?.status === 'mastered';
    const note = i === null ? undefined : noteOf(i);
    const hasText = !!note && (note.text.trim() !== '' || note.tags.length > 0);
    const hold = holdRef.current;
    const stopHold = () => {
      if (hold.timer) clearTimeout(hold.timer);
      hold.timer = null;
    };
    return (
      <button
        key={i ?? 'all'}
        className={`btn fl-chip ${i === fragIdx ? 'primary' : ''} ${isDone ? 'fl-mastered' : ''}`}
        aria-pressed={i === fragIdx}
        aria-label={note ? `${label}, ${s(lang, 'hasNote')}` : undefined}
        data-fragment={i ?? 'all'}
        onPointerDown={(e) => {
          hold.fired = false;
          stopHold();
          if (i === null || !saveFragmentNote) return;
          const el = e.currentTarget;
          hold.timer = setTimeout(() => {
            hold.fired = true;
            openFragMenu(i, el);
          }, 500);
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onContextMenu={(e) => {
          if (i === null || !saveFragmentNote) return;
          e.preventDefault();
          stopHold();
          hold.fired = true;
          openFragMenu(i, e.currentTarget);
        }}
        onClick={() => {
          if (hold.fired) {
            hold.fired = false;
            return;
          }
          setFragIdx(i);
        }}
      >
        {isDone && <span aria-hidden>✓</span>}
        <span>{label}</span>
        {pr && pr.attempts > 0 && (
          <span className="fl-count" title={`${pr.attempts} ${s(lang, 'runs')}`}>
            ×{pr.attempts}
          </span>
        )}
        {hasText && (
          <svg className="fl-mark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 20h4L19 9l-4-4L4 16z" />
          </svg>
        )}
        {note?.later && (
          <svg className="fl-mark fl-mark-later" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M6 3h12v18l-6-4-6 4z" />
          </svg>
        )}
      </button>
    );
  };

  // What the bottom bar says: the step to play (wait mode), the lead-in, the end of the fragment.
  let status: ReactNode = null;
  if (done) status = <span className="fl-done">✓ {s(lang, 'fragmentDone')}</span>;
  else if (phase === 'preroll') status = <span>{s(lang, 'getReady')}</span>;
  else if (prefs.wait && waitingStep)
    status = (
      <>
        <button className="btn fl-hear" onClick={() => engine.hearStep()} title={s(lang, 'hearStep')}>
          🔊 <span className="fl-hear-label">{s(lang, 'hearStep')}</span>
        </button>
        <span className="fl-step" aria-live="polite">
          {s(lang, 'playThese')}{' '}
          <b>{waitingStep.pitches.map((p) => pitchName(p, settings.noteNames)).join(' + ')}</b>
          {finePointer && <span className="muted fl-kbd"> {s(lang, 'spaceHint')}</span>}
        </span>
      </>
    );

  return (
    <div className="fl">
      <div className="fl-top" ref={topRef}>
        <div className={`fl-fragsbox ${fragsScroll.over ? 'fl-over' : ''}`}>
          {fragsScroll.over && (
            <button
              className="btn fl-fragsarrow fl-fragsarrow-l"
              disabled={!fragsScroll.left}
              onClick={() => scrollFrags(-1)}
              aria-label={s(lang, 'fragsEarlier')}
              title={s(lang, 'fragsEarlier')}
            >
              ‹
            </button>
          )}
          <div className="fl-frags" ref={fragsRef} onScroll={measureFrags} role="toolbar" aria-label={s(lang, 'fragments')}>
            {lesson.fragments.map((f, i) => chip(f.title ?? `#${i + 1}`, i))}
            {chip(s(lang, 'wholeLesson'), null)}
          </div>
          {fragsScroll.over && (
            <button
              className="btn fl-fragsarrow fl-fragsarrow-r"
              disabled={!fragsScroll.right}
              onClick={() => scrollFrags(1)}
              aria-label={s(lang, 'fragsLater')}
              title={s(lang, 'fragsLater')}
            >
              ›
            </button>
          )}
        </div>
        {fragIdx !== null && (
          <button
            className="btn fl-toggle fl-gotit"
            aria-pressed={mastered}
            onClick={() => recordProgress({ fragmentPosition: fragIdx, status: mastered ? 'learning' : 'mastered' })}
          >
            ✓ {s(lang, mastered ? 'mastered' : 'gotIt')}
          </button>
        )}
        {fragIdx !== null && saveFragmentNote && (
          <button
            className="btn fl-notebtn"
            title={s(lang, 'fragNoteHint')}
            aria-pressed={!!noteOf(fragIdx)}
            onClick={(e) => openFragMenu(fragIdx, e.currentTarget)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
            {s(lang, 'fragNote')}
          </button>
        )}
        {fragMenu && saveFragmentNote && (
          <FragmentNoteMenu
            key={fragMenu.position}
            title={fragTitle(fragMenu.position)}
            note={noteOf(fragMenu.position)}
            at={fragMenu}
            lang={lang}
            onSave={(n) => saveFragmentNote(fragMenu.position, n)}
            onClose={closeFragMenu}
          />
        )}
      </div>

      <div className="fl-controls">
        <button className="btn fl-toggle" aria-pressed={prefs.loop} onClick={() => set({ loop: !prefs.loop })}>
          🔁 {s(lang, 'loop')}
        </button>
        <button className="btn fl-toggle" aria-pressed={prefs.wait} onClick={() => set({ wait: !prefs.wait })}>
          ⏸ {s(lang, 'wait')}
        </button>
        <button
          className="btn fl-toggle"
          aria-pressed={prefs.sound}
          onClick={() => set({ sound: !prefs.sound })}
          aria-label={s(lang, 'sound')}
          title={s(lang, 'sound')}
        >
          {prefs.sound ? '🔊' : '🔇'}
        </button>

        <div className="seg" role="group" aria-label={s(lang, 'speed')} title={s(lang, 'speed')}>
          {SPEEDS.map((x) => (
            <button key={x} aria-pressed={prefs.rate === x} onClick={() => set({ rate: x })}>
              {Math.round(x * 100)}%
            </button>
          ))}
        </div>

        <div className="seg" role="group" aria-label={s(lang, 'hands')} title={s(lang, 'hands')}>
          {/* left before right, as on the keyboard */}
          {(['both', 'L', 'R'] as const).map((h) => (
            <button key={h} aria-pressed={prefs.hands === h} onClick={() => set({ hands: h })}>
              {h !== 'R' && <span className="fl-dot fl-dot-l" aria-hidden />}
              {h !== 'L' && <span className="fl-dot fl-dot-r" aria-hidden />}
              {s(lang, h === 'both' ? 'both' : h === 'R' ? 'right' : 'left')}
            </button>
          ))}
        </div>

        <button
          className="btn"
          onClick={() => set({ lookAhead: nextLookAhead(prefs.lookAhead) })}
          title={s(lang, 'lookAhead')}
          aria-label={`${s(lang, 'lookAhead')}: ${prefs.lookAhead}s`}
        >
          👁 {s(lang, 'ahead')} {prefs.lookAhead} {s(lang, 'sec')}
        </button>
      </div>

      <div className="fl-stage">
        <div className="fl-lane" ref={laneRef}>
          <canvas
            ref={canvasRef}
            onPointerDown={onLanePointerDown}
            onPointerUp={onLanePointerUp}
            onPointerCancel={() => (swipeRef.current = null)}
            aria-label={s(lang, 'tapBar')}
            role="img"
          />
          {menu && (
            <NoteMenu
              note={menu.note}
              at={menu}
              lang={lang}
              noteNames={settings.noteNames}
              onHear={() => {
                const n = menu.note;
                player.playChord([n.pitch], Math.min(2, Math.max(0.3, n.duration / prefs.rate)), n.velocity ?? 0.8);
              }}
              onReport={
                reportNote && menu.note.id ? (r) => reportNote({ noteId: menu.note.id!, ...r }) : undefined
              }
              onClose={closeMenu}
            />
          )}
          {empty ? (
            <div className="fl-pill">{s(lang, 'emptyFragment')}</div>
          ) : (
            prefs.wait && noSteps && <div className="fl-pill">{s(lang, 'noNotes')}</div>
          )}
        </div>

        <PianoKeyboard
          range={range}
          highlights={highlights}
          labels={settings.keyLabels}
          noteNames={settings.noteNames}
          height="24vh"
          className="fl-keys"
          onNoteOn={(p) => {
            player.noteOn(p);
            input.emit('on', p, 'screen');
          }}
          onNoteOff={(p) => {
            player.noteOff(p);
            input.emit('off', p, 'screen');
          }}
        />

        {/* The bar at the bottom edge, nearest the hands: ‹ previous · what to play now · ⏮ + the big button · next ›. */}
        <div className="fl-bar">
          <div className="fl-nav fl-nav-prev">
            <button
              className="btn fl-goplay"
              disabled={prevFrag === undefined}
              onClick={() => goTo(prevFrag, true)}
              aria-keyshortcuts="Alt+ArrowLeft"
              aria-label={`${s(lang, 'prevFragment')} ${s(lang, 'andPlay')}: ${fragName(prevFrag)}`}
              title={`${s(lang, 'prevFragment')} ${s(lang, 'andPlay')} (⌥ + ←)`}
            >
              ‹▶
            </button>
            <button
              className="btn fl-prev"
              disabled={prevFrag === undefined}
              onClick={() => goTo(prevFrag, false)}
              aria-keyshortcuts="Shift+ArrowLeft"
              title={`${s(lang, 'prevFragment')} (Shift + ←)`}
              aria-label={`${s(lang, 'prevFragment')}: ${fragName(prevFrag)}`}
            >
              <span className="fl-nav-main">‹ {s(lang, 'prevFragment')}</span>
              <span className="fl-nav-sub">{fragName(prevFrag) || '—'}</span>
            </button>
          </div>
          <div className="fl-status">{status}</div>
          <div className="fl-play">
            <button
              className="btn primary fl-restart"
              onClick={() => engine.restart()}
              disabled={!canPlay}
              aria-label={s(lang, 'restart')}
              title={`${s(lang, 'restart')} (Shift + ${s(lang, 'space')})`}
              aria-keyshortcuts="Shift+Space"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M6 5h2v14H6zM9.5 12 19 5v14z" />
              </svg>
            </button>
            <button
              className="btn big primary fl-primary"
              onClick={() => mainActionRef.current()}
              disabled={!canPlay}
              aria-keyshortcuts="Space"
            >
              {primaryIcon === '›' ? (
                <>
                  {primaryLabel} <span aria-hidden>›</span>
                </>
              ) : (
                <>
                  <span aria-hidden>{primaryIcon}</span> {primaryLabel}
                </>
              )}
            </button>
          </div>
          <div className="fl-nav fl-nav-next">
            <button
              className="btn fl-next"
              disabled={nextFrag === undefined}
              onClick={() => goTo(nextFrag, false)}
              aria-keyshortcuts="Shift+ArrowRight"
              title={`${s(lang, 'nextFragment')} (Shift + →)`}
              aria-label={`${s(lang, 'nextFragment')}: ${fragName(nextFrag)}`}
            >
              <span className="fl-nav-main">{s(lang, 'nextFragment')} ›</span>
              <span className="fl-nav-sub">{fragName(nextFrag) || '—'}</span>
            </button>
            <button
              className="btn fl-goplay"
              disabled={nextFrag === undefined}
              onClick={() => goTo(nextFrag, true)}
              aria-keyshortcuts="Alt+ArrowRight"
              aria-label={`${s(lang, 'nextFragment')} ${s(lang, 'andPlay')}: ${fragName(nextFrag)}`}
              title={`${s(lang, 'nextFragment')} ${s(lang, 'andPlay')} (⌥ + →)`}
            >
              ›▶
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
