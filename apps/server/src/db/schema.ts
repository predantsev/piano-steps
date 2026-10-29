import type { GuideSection, LessonNote, LessonSource, Tempo } from '@piano-steps/core';
import { boolean, doublePrecision, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * Lessons live here, never in git (the repo is public; transcriptions of songs are not ours
 * to publish). Notes are stored as one JSONB array — they are always read and written as a
 * whole, never queried individually. Fragments are rows so they can be edited and tracked.
 */
export const lessons = pgTable('lessons', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  artist: text('artist'),
  composer: text('composer'),
  description: text('description'),
  source: jsonb('source').$type<LessonSource>(),
  license: text('license'),
  tempo: jsonb('tempo').$type<Tempo>(),
  notes: jsonb('notes').$type<LessonNote[]>().notNull(),
  durationSec: doublePrecision('duration_sec').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const fragments = pgTable(
  'fragments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    title: text('title'),
    startSec: doublePrecision('start_sec').notNull(),
    endSec: doublePrecision('end_sec').notNull(),
  },
  (t) => [unique('fragments_lesson_position').on(t.lessonId, t.position)],
);

/** User feedback on a lesson/fragment ("sounds wrong here"); agents resolve it through the API. */
export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  lessonId: uuid('lesson_id')
    .notNull()
    .references(() => lessons.id, { onDelete: 'cascade' }),
  fragmentPosition: integer('fragment_position'),
  /** The one note reported (its stable id) and a copy of it as it was then. */
  noteId: text('note_id'),
  note: jsonb('note').$type<LessonNote>(),
  kind: text('kind').$type<'higher' | 'lower' | 'extra' | 'missing' | 'timing' | 'other'>(),
  message: text('message').notNull(),
  status: text('status').$type<'open' | 'in-progress' | 'resolved' | 'wont-fix'>().notNull().default('open'),
  resolution: text('resolution'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Practice progress per fragment (keyed by position: fragments are replaced as a set). */
export const progress = pgTable(
  'progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    fragmentPosition: integer('fragment_position').notNull(),
    status: text('status').$type<'new' | 'learning' | 'mastered'>().notNull().default('new'),
    attempts: integer('attempts').notNull().default(0),
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }),
  },
  (t) => [unique('progress_lesson_fragment').on(t.lessonId, t.fragmentPosition)],
);

/**
 * TEMPORARY overrides of the in-app guide, one row per language (PUT /api/guide/{lang}). The guide
 * itself lives in the repo (packages/core/src/guide/guide.<lang>.json); an override is shown instead
 * until someone moves it into that file and deletes it (DELETE /api/guide/{lang}).
 */
export const guideOverrides = pgTable('guide_overrides', {
  lang: text('lang').primaryKey(),
  title: text('title').notNull(),
  sections: jsonb('sections').$type<GuideSection[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** The user's notes on fragments (keyed by position, like progress): text, "come back later", wishes for re-splitting. */
export const fragmentNotes = pgTable(
  'fragment_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    fragmentPosition: integer('fragment_position').notNull(),
    text: text('text').notNull().default(''),
    later: boolean('later').notNull().default(false),
    tags: jsonb('tags').$type<('split' | 'merge-next' | 'boundary')[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('fragment_notes_lesson_fragment').on(t.lessonId, t.fragmentPosition)],
);
