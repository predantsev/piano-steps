import { MAX_PIANO_PITCH, MIN_PIANO_PITCH, parsePitch, pitchName } from '@piano-steps/core';
import { getContext } from 'tone';
import type { NoteEvent } from '../input/noteInput.ts';
import type { DevShell } from './shell.ts';
import type { DevKey, DevState, PianoStepsDevApi, PitchArg } from './types.ts';
import { callWebMcpTool, registeredToolNames } from './webmcp.ts';

const MARKS = ['R', 'L', 'next', 'ok', 'bad', 'hint'];
const LOG_SIZE = 30;

export interface DevApiHandle {
  api: PianoStepsDevApi;
  dispose(): void;
}

/** Build `window.pianoSteps` over the shell. Every method reads the shell's live state. */
export function createDevApi(getShell: () => DevShell): DevApiHandle {
  const log: NoteEvent[] = [];
  const unsubscribe = getShell().input.subscribe((e) => {
    log.push(e);
    if (log.length > LOG_SIZE) log.shift();
  });
  // Animation frames stop in a background tab (also in a hidden browser pane): views that redraw on
  // requestAnimationFrame then show stale keys. Track it so getState() can say so.
  let lastFrame = performance.now();
  let raf = 0;
  const tick = () => {
    lastFrame = performance.now();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const shell = () => {
    const s = getShell();
    if (!s) throw new Error('piano-steps shell is not mounted');
    return s;
  };

  const getState = (): DevState => {
    const s = shell();
    const l = s.lesson;
    const frag = l && s.fragmentPos !== null ? l.fragments[s.fragmentPos] : undefined;
    const p = s.player;
    const now = performance.now();
    return {
      ready: !!l && !document.querySelector('[data-loading]'),
      lesson: l
        ? {
            id: l.id,
            slug: l.slug,
            title: l.title,
            noteCount: l.notes.length,
            durationSec: l.durationSec,
            fragmentCount: l.fragments.length,
          }
        : null,
      lessonCount: s.lessons.length,
      variant: s.variantId,
      variants: s.variantIds,
      fragment:
        frag && s.fragmentPos !== null
          ? { position: s.fragmentPos, ...(frag.title ? { title: frag.title } : {}), start: frag.start, end: frag.end }
          : null,
      player: {
        state: p.state,
        time: round(p.time),
        rate: p.rate,
        from: p.options.from ?? 0,
        to: Number.isFinite(p.options.to ?? Infinity) ? (p.options.to as number) : null,
        loop: !!p.options.loop,
        audioUnlocked: p.isUnlocked,
        audioContext: audioState(),
        samplesLoaded: p.samplesLoaded,
      },
      heldKeys: [...s.input.held].sort((a, b) => a - b),
      litKeys: litKeys(),
      recentInput: log.map((e) => ({
        type: e.type,
        pitch: e.pitch,
        name: pitchName(e.pitch),
        source: e.source,
        msAgo: Math.round(now - e.at),
      })),
      variantState: s.variantState(),
      dialog: s.dialog,
      error: s.error,
      offline: s.offline,
      settings: {
        lang: s.settings.lang,
        noteNames: s.settings.noteNames,
        keyLabels: s.settings.keyLabels,
        speed: s.settings.speed,
      },
      webmcp: { available: 'modelContext' in document, tools: registeredToolNames() },
      display: { framesRunning: now - lastFrame < 250 },
    };
  };

  const api: PianoStepsDevApi = {
    version: 1,

    help: () => ({
      getState: 'getState() → { ready, lesson, variant, fragment, player, heldKeys, litKeys, recentInput, variantState, … }',
      listLessons: 'listLessons() → Promise<LessonSummary[]> (fresh from the API)',
      selectLesson: 'selectLesson(slugOrId) → Promise<state> once the lesson is on screen',
      setVariant: `setVariant(id) → Promise<state> once rendered; ids: ${shell().variantIds.join(', ')}`,
      press: 'press(pitches, holdMs?) → Promise<state>; pitches: 60 | "C4" | [60, "E4", "G4"]; source "sim"',
      release: 'release(pitches?) → Promise<state>; no argument = release everything',
      play: 'play(from?, to?) seconds → Promise<state>; default = current fragment; warns while audio is locked',
      stop: 'stop() → Promise<state>',
      callTool: 'callTool(name, args) → result of the WebMCP tool, through document.modelContext',
    }),

    getState,

    listLessons: async () => shell().refreshLessons(),

    async selectLesson(ref) {
      if (typeof ref !== 'string' || !ref) throw new Error('selectLesson(ref): ref must be a lesson slug or id');
      let list = shell().lessons;
      let match = list.find((l) => l.slug === ref || l.id === ref);
      if (!match) {
        list = await shell().refreshLessons();
        match = list.find((l) => l.slug === ref || l.id === ref);
      }
      if (!match) throw new Error(`No lesson "${ref}". Available: ${list.map((l) => l.slug).join(', ')}`);
      const slug = match.slug;
      shell().selectLesson(slug);
      await waitUntil(() => shell().lesson?.slug === slug && getState().ready, 8000, `lesson "${slug}" to load`);
      await settle();
      return getState();
    },

    async setVariant(id) {
      const ids = shell().variantIds;
      if (!ids.includes(id)) throw new Error(`No variant "${id}". Available: ${ids.join(', ')}`);
      shell().setVariant(id);
      await waitUntil(() => shell().variantId === id && getState().ready, 8000, `variant "${id}" to render`);
      await settle();
      return getState();
    },

    async press(pitches, holdMs) {
      const list = toPitches(pitches);
      if (!list.length) throw new Error('press(pitches): give at least one pitch, e.g. 60, "C4" or [60, 64, 67]');
      const { input, player } = shell();
      for (const p of list) {
        input.emit('on', p, 'sim');
        player.noteOn(p); // no sound until audio is unlocked — harmless
      }
      await settle();
      const state = getState();
      if (holdMs !== undefined) {
        if (!(holdMs >= 0)) throw new Error('press(pitches, holdMs): holdMs must be a number of milliseconds ≥ 0');
        await sleep(holdMs);
        releaseAll(list);
        await settle();
      }
      return state;
    },

    async release(pitches) {
      const list = pitches === undefined ? [...shell().input.held] : toPitches(pitches);
      releaseAll(list);
      await settle();
      return getState();
    },

    async play(from, to) {
      const s = shell();
      if (!s.lesson) throw new Error('No lesson loaded yet — wait for getState().ready');
      for (const [n, v] of [['from', from], ['to', to]] as const)
        if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))
          throw new Error(`play(from, to): ${n} must be seconds ≥ 0`);
      const frag = s.fragmentPos !== null ? s.lesson.fragments[s.fragmentPos] : undefined;
      const start = from ?? frag?.start ?? 0;
      const end = to ?? (from === undefined ? frag?.end : undefined);
      if (end !== undefined && end <= start) throw new Error(`play(from, to): to (${end}) must be after from (${start})`);
      s.player.play({ from: start, ...(end !== undefined ? { to: end } : {}), rate: s.settings.speed });
      await sleep(80);
      const state = getState();
      if (audioState() !== 'running')
        return {
          ...state,
          warning:
            'Audio is locked: the browser needs one real tap/click on the page first (iOS / autoplay rule). ' +
            'Until then the player clock does not advance. In Playwright, click the page before play().',
        };
      if (!s.player.isUnlocked)
        return {
          ...state,
          warning:
            'Playing silently: the clock runs, but the piano sound is created on the first real tap/click ' +
            'on the page (the shell unlocks audio on pointerdown).',
        };
      return state;
    },

    async stop() {
      shell().player.stop();
      await settle();
      return getState();
    },

    callTool: (name, args = {}) => callWebMcpTool(name, args),
  };

  function releaseAll(list: number[]) {
    const { input, player } = shell();
    for (const p of list) {
      input.emit('off', p, 'sim');
      player.noteOff(p);
    }
  }

  return {
    api,
    dispose: () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    },
  };
}

function toPitches(arg: PitchArg | PitchArg[]): number[] {
  const list = Array.isArray(arg) ? arg : [arg];
  return list.map((x) => {
    const p = typeof x === 'number' ? x : parsePitch(String(x));
    if (!Number.isInteger(p) || p < MIN_PIANO_PITCH || p > MAX_PIANO_PITCH)
      throw new Error(`Pitch ${JSON.stringify(x)} is not a piano key (MIDI 21…108, or a name like "C4")`);
    return p;
  });
}

/** Keys the on-screen keyboard shows highlighted (PianoKeyboard renders `.pk-<mark>` on `[data-pitch]`). */
function litKeys(): DevKey[] {
  const out = new Map<number, DevKey>();
  for (const el of document.querySelectorAll<HTMLElement>('.pk [data-pitch]')) {
    const mark = MARKS.find((m) => el.classList.contains(`pk-${m}`));
    const pitch = Number(el.dataset.pitch);
    if (mark && !out.has(pitch)) out.set(pitch, { pitch, name: pitchName(pitch), mark });
  }
  return [...out.values()].sort((a, b) => a.pitch - b.pitch);
}

function audioState(): string {
  try {
    return getContext().state;
  } catch {
    return 'unavailable';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Let React commit and the variant draw: two animation frames, or 120 ms if frames are paused (hidden tab). */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 120);
  });
}

async function waitUntil(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(25);
  }
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
