import type { Lesson, LessonSummary } from '@piano-steps/core';
import type { LessonPlayer } from '../audio/player.ts';
import type { NoteInput } from '../input/noteInput.ts';
import type { Settings } from '../settings.ts';

/**
 * What the app shell hands to the dev automation API: a fresh snapshot of its state on every
 * render (App.tsx keeps it in a ref) plus the same actions the UI itself uses. Only `import type`
 * of this file appears in App.tsx, so nothing here reaches a production bundle.
 */
export interface DevShell {
  lessons: LessonSummary[];
  lesson: Lesson | null;
  lessonRef: string | undefined;
  variantId: string;
  variantIds: string[];
  fragmentPos: number | null;
  dialog: string | null;
  error: string | null;
  offline: boolean;
  settings: Settings;
  player: LessonPlayer;
  input: NoteInput;
  /** State the mounted variant published via `VariantProps.reportState` (null if none yet). */
  variantState(): Record<string, unknown> | null;
  /** Same as picking a lesson in the top bar. */
  selectLesson(ref: string): void;
  /** Same as tapping a variant tab (stops playback, switches). */
  setVariant(id: string): void;
  /** Re-fetch the lesson list (updates the top-bar picker). */
  refreshLessons(): Promise<LessonSummary[]>;
}
