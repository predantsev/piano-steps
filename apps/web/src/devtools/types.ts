import type { LessonSummary } from '@piano-steps/core';

/**
 * Public types of the dev automation API (`window.pianoSteps`). Kept free of app internals so
 * e2e tests (Playwright) can import them too. Docs: docs/testing-api.md.
 */

/** A pitch as a MIDI number (60) or a name ("C4", "F#3", "Bb2", "До4"). */
export type PitchArg = number | string;

export interface DevKey {
  pitch: number;
  name: string;
  /** How the on-screen keyboard shows it: R / L (hand), next, ok, bad, hint. */
  mark: string;
}

export interface DevInputEvent {
  type: 'on' | 'off';
  pitch: number;
  name: string;
  /** screen = on-screen keyboard, keyboard = computer keys, sim = this API. */
  source: string;
  msAgo: number;
}

export interface DevState {
  /** A lesson is loaded and the practice view has rendered (no loading placeholder on screen). */
  ready: boolean;
  lesson: {
    id: string;
    slug: string;
    title: string;
    noteCount: number;
    durationSec: number;
    fragmentCount: number;
  } | null;
  lessonCount: number;
  /** The practice UI on screen (`?ui=`), and the ones available. */
  variant: string;
  variants: string[];
  /** The fragment the variant says the user is on (null = whole lesson). */
  fragment: { position: number; title?: string; start: number; end: number } | null;
  player: {
    state: 'stopped' | 'playing' | 'paused';
    /** Lesson time in seconds. */
    time: number;
    rate: number;
    from: number;
    to: number | null;
    loop: boolean;
    /** The shell's audio unlock ran (first pointerdown/keydown on the page). */
    audioUnlocked: boolean;
    /** Web Audio state; the player clock only advances while this is "running". */
    audioContext: string;
    samplesLoaded: boolean;
  };
  /** Keys currently held down (any source), sorted. */
  heldKeys: number[];
  /** Keys the on-screen keyboard(s) currently show highlighted, read from the DOM. */
  litKeys: DevKey[];
  /** The last input events, newest last (a tap is over before you can look — check here). */
  recentInput: DevInputEvent[];
  /** Whatever the current variant published through `VariantProps.reportState` (null if nothing). */
  variantState: Record<string, unknown> | null;
  dialog: string | null;
  error: string | null;
  offline: boolean;
  settings: { lang: string; noteNames: string; keyLabels: string; speed: number };
  webmcp: { available: boolean; tools: string[] };
}

export interface PianoStepsDevApi {
  readonly version: 1;
  /** Method → one-line description. */
  help(): Record<string, string>;
  getState(): DevState;
  /** Fresh list from the API (also refreshes the lesson picker). */
  listLessons(): Promise<LessonSummary[]>;
  /** Open a lesson by slug or id; resolves once it is on screen. */
  selectLesson(ref: string): Promise<DevState>;
  /** Switch the practice UI (same as tapping its tab); resolves once it has rendered. */
  setVariant(id: string): Promise<DevState>;
  /**
   * Press keys like a finger on the on-screen keyboard (source "sim"). Without `holdMs` they stay
   * down until `release()`; with it they are released after `holdMs` and the returned state is the
   * one captured while they were held.
   */
  press(pitches: PitchArg | PitchArg[], holdMs?: number): Promise<DevState>;
  /** Release the given keys, or every held key. */
  release(pitches?: PitchArg | PitchArg[]): Promise<DevState>;
  /**
   * Play the lesson from `from` to `to` seconds (default: the current fragment, else the whole
   * lesson). Adds `warning` when audio is still locked (the clock will not move until a real tap).
   */
  play(from?: number, to?: number): Promise<DevState & { warning?: string }>;
  stop(): Promise<DevState>;
  /** Call one of the WebMCP tools through `document.modelContext` (the real browser pipe). */
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

declare global {
  interface Window {
    pianoSteps?: PianoStepsDevApi;
  }
}
