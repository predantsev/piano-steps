import type { FragmentProgress, Lesson, ProgressStatus } from '@piano-steps/core';
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
}

export interface VariantDef {
  id: string;
  name: { uk: string; en: string };
  blurb: { uk: string; en: string };
  component: LazyExoticComponent<ComponentType<VariantProps>>;
}
