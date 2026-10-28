import type { GuideSection, LessonNote, LessonSource, Tempo } from '@piano-steps/core';
import { doublePrecision, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

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
 * The in-app guide, one row per language. Seeded from the English example in packages/core on
 * first start; agents replace it with PUT /api/guide/{lang} (and add other languages that way).
 */
export const guides = pgTable('guides', {
  lang: text('lang').primaryKey(),
  title: text('title').notNull(),
  sections: jsonb('sections').$type<GuideSection[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
