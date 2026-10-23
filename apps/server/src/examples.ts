import { LessonInput, prepareLesson, type Feedback, type FragmentProgress, type Lesson, type LessonSummary } from '@piano-steps/core';

/**
 * Example bodies for the OpenAPI spec (/api/docs). Small, valid, public-domain ("Twinkle,
 * Twinkle", first bar) — an agent can POST `lessonInput` as-is and get `lesson` back.
 */

const ID = '3f2c8e1a-5b7d-4c9e-8a10-2b6f4d9e7c31';
const AT = '2026-10-23T12:00:00.000Z';

export const lessonInput = {
  slug: 'twinkle-bar-1',
  title: 'Twinkle, Twinkle — bar 1',
  composer: 'Traditional',
  license: 'public-domain',
  source: { kind: 'agent', note: 'Typed by hand from the score' },
  tempo: { bpm: 100, timeSignature: [4, 4] },
  notes: [
    { pitch: 60, start: 0, duration: 0.57, hand: 'R', finger: 1 },
    { pitch: 60, start: 0.6, duration: 0.57, hand: 'R', finger: 1 },
    { pitch: 67, start: 1.2, duration: 0.57, hand: 'R', finger: 4 },
    { pitch: 67, start: 1.8, duration: 0.57, hand: 'R', finger: 4 },
    { pitch: 48, start: 0, duration: 1.14, hand: 'L', velocity: 0.55 },
    { pitch: 52, start: 1.2, duration: 1.14, hand: 'L', velocity: 0.55 },
  ],
} as const;

const prepared = prepareLesson(LessonInput.parse(lessonInput));

export const lesson: Lesson = { ...prepared, id: ID, createdAt: AT, updatedAt: AT };

export const lessonSummary: LessonSummary = {
  id: ID,
  slug: lesson.slug,
  title: lesson.title,
  composer: 'Traditional',
  durationSec: lesson.durationSec,
  noteCount: lesson.notes.length,
  fragmentCount: lesson.fragments.length,
  sourceKind: 'agent',
  updatedAt: AT,
};

export const fragments = {
  fragments: [
    { title: 'Bar 1, first half', start: 0, end: 1.2 },
    { title: 'Bar 1, second half', start: 1.2, end: 2.4 },
  ],
};

export const fragmentNotes = {
  notes: [
    { pitch: 67, start: 1.2, duration: 0.57, hand: 'R' },
    { pitch: 69, start: 1.8, duration: 0.57, hand: 'R' },
  ],
};

export const progressInput = { fragmentPosition: 0, attempt: true, status: 'learning' };

export const progress: { progress: FragmentProgress[] } = {
  progress: [{ fragmentPosition: 0, status: 'learning', attempts: 3, lastPracticedAt: AT }],
};

export const feedbackInput = { fragmentPosition: 0, message: 'The second G sounds lower in the original' };

export const feedback: Feedback = {
  id: '9d3e7b20-1c4a-4f6e-b8d2-7a5c3e1f0b94',
  lessonId: ID,
  lessonSlug: lesson.slug,
  fragmentPosition: 0,
  message: feedbackInput.message,
  status: 'open',
  createdAt: AT,
  updatedAt: AT,
};

export const feedbackPatch = { status: 'resolved', resolution: 'Bar 1: second G4 → A4 (checked against the video at 0:07)' };

export const health = { ok: true, db: 'pglite', auth: false };

export const errors = {
  validation: { error: 'validation', details: ['notes.0.pitch: Too big: expected number to be <=108'] },
  notFound: { error: 'not-found', details: ['Lesson "twinkle-bar-1" not found'] },
  conflict: { error: 'conflict', details: ['Slug "twinkle-bar-1" already exists'], id: ID },
  unauthorized: { error: 'unauthorized', details: ['Send "Authorization: Bearer <API_TOKEN>" on every non-GET request'] },
  invalidMidi: { error: 'invalid-midi', details: ['MIDI file has no (non-drum) notes'] },
  invalidMusicXml: { error: 'invalid-musicxml', details: ['Not valid XML: Expected closing tag \'part\' (line 12)'] },
};
