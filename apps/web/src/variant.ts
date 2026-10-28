import type { FeedbackKind, FragmentProgress, Lesson, ProgressStatus } from '@piano-steps/core';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { LessonPlayer } from './audio/player.ts';
import type { NoteInput } from './input/noteInput.ts';
import type { Lang, Settings } from './settings.ts';

/**
 * The contract between the app shell and a practice UI ("variant").
 *
 * The shell owns: lesson loading, settings, theme, language, sound unlock, the
 * "sounds wrong" feedback button and the "hear the original" player.
 * A variant owns: everything inside its area — how the lesson is shown and practised.
 *
 * Variants live in src/variants/<id>/ and must not edit shell files; if a variant needs
 * something from the shell, it is added here first (one shared change), then used.
 */
export interface VariantProps {
  lesson: Lesson;
  player: LessonPlayer;
  input: NoteInput;
  settings: Settings;
  lang: Lang;
  progress: FragmentProgress[];
  recordProgress(p: { fragmentPosition: number; status?: ProgressStatus; attempt?: boolean }): void;
  /**
   * Tell the shell which fragment the user is working on (index into lesson.fragments),
   * or null for "whole lesson". Drives the feedback button and "hear the original".
   */
  onFragmentChange(position: number | null): void;
  /**
   * Optional — publish this variant's own state for tests and agents. The latest object shows up
   * as `variantState` in `window.pianoSteps.getState()` (dev builds; see docs/testing-api.md), so a
   * test can assert "the cards view is on step 3, waiting for E4+G4" without reading pixels.
   *
   * Call it whenever that state changes, with plain JSON (no functions, no class instances), e.g.
   * `reportState?.({ step: 3, stepCount: 12, expected: [64, 67], mode: 'wait' })`.
   * The shell only stores the last object (no re-render), so calling it often is cheap; it is
   * forgotten when the variant unmounts or the lesson changes. Variants that never call it are fine.
   */
  reportState?(state: Record<string, unknown>): void;
  /**
   * Optional — report that one note sounds wrong (by its stable `id`). The shell stores it in the
   * feedback queue (POST /api/lessons/{ref}/feedback with `noteId`), where an agent picks it up.
   * Rejects with a readable Error (offline, missing token, …).
   */
  reportNote?(report: { noteId: string; kind?: FeedbackKind; message?: string }): Promise<void>;
}

export interface VariantDef {
  id: string;
  name: { uk: string; en: string };
  blurb: { uk: string; en: string };
  component: LazyExoticComponent<ComponentType<VariantProps>>;
}
