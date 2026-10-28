import {
  EXAMPLE_GUIDE,
  demoLessons,
  notesInRange,
  prepareLesson,
  validateLessonInput,
  type Feedback,
  type Guide,
  type GuideInput,
  type FeedbackStatus,
  type Fragment,
  type FragmentProgress,
  type Lesson,
  type LessonNote,
  type LessonSummary,
  type PreparedLesson,
  type ProgressStatus,
} from '@piano-steps/core';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { feedback, fragments, guides, lessons, progress } from './db/schema.ts';

type LessonRow = typeof lessons.$inferSelect;
type FragmentRow = typeof fragments.$inferSelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NotFound extends Error {}
/** The request was well-formed but the result would not be a valid lesson (400 `validation`). */
export class Invalid extends Error {
  constructor(readonly details: string[]) {
    super(details.join('; '));
  }
}
export class Conflict extends Error {
  constructor(message: string, readonly id: string) {
    super(message);
  }
}

function toLesson(row: LessonRow, frs: FragmentRow[]): Lesson {
  return {
    id: row.id,
    slug: row.slug,
    schemaVersion: 1,
    title: row.title,
    ...(row.artist ? { artist: row.artist } : {}),
    ...(row.composer ? { composer: row.composer } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.source ? { source: row.source } : {}),
    ...(row.license ? { license: row.license } : {}),
    ...(row.tempo ? { tempo: row.tempo } : {}),
    notes: row.notes,
    durationSec: row.durationSec,
    fragments: [...frs]
      .sort((a, b) => a.position - b.position)
      .map((f) => ({ ...(f.title ? { title: f.title } : {}), start: f.startSec, end: f.endSec })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function lessonValues(p: PreparedLesson) {
  return {
    slug: p.slug,
    title: p.title,
    artist: p.artist ?? null,
    composer: p.composer ?? null,
    description: p.description ?? null,
    source: p.source ?? null,
    license: p.license ?? null,
    tempo: p.tempo ?? null,
    notes: p.notes,
    durationSec: p.durationSec,
  };
}

async function findRow(db: Db, idOrSlug: string): Promise<LessonRow> {
  const where = UUID_RE.test(idOrSlug) ? eq(lessons.id, idOrSlug) : eq(lessons.slug, idOrSlug);
  const [row] = await db.select().from(lessons).where(where).limit(1);
  if (!row) throw new NotFound(`Lesson "${idOrSlug}" not found`);
  return row;
}

export async function listLessons(db: Db): Promise<LessonSummary[]> {
  const rows = await db
    .select({
      id: lessons.id,
      slug: lessons.slug,
      title: lessons.title,
      artist: lessons.artist,
      composer: lessons.composer,
      durationSec: lessons.durationSec,
      source: lessons.source,
      updatedAt: lessons.updatedAt,
      noteCount: sql<number>`jsonb_array_length(${lessons.notes})`,
      // explicit aliases: drizzle renders bare column names inside sql``, which would bind to the subquery table
      fragmentCount: sql<number>`(select count(*) from "fragments" f where f."lesson_id" = "lessons"."id")`,
    })
    .from(lessons)
    .orderBy(asc(lessons.title));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    ...(r.artist ? { artist: r.artist } : {}),
    ...(r.composer ? { composer: r.composer } : {}),
    durationSec: r.durationSec,
    noteCount: Number(r.noteCount),
    fragmentCount: Number(r.fragmentCount),
    ...(r.source?.kind ? { sourceKind: r.source.kind } : {}),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getLesson(db: Db, idOrSlug: string): Promise<Lesson> {
  const row = await findRow(db, idOrSlug);
  const frs = await db.select().from(fragments).where(eq(fragments.lessonId, row.id));
  return toLesson(row, frs);
}

async function writeFragments(db: Db, lessonId: string, list: Fragment[]) {
  await db.delete(fragments).where(eq(fragments.lessonId, lessonId));
  if (list.length)
    await db.insert(fragments).values(
      list.map((f, i) => ({ lessonId, position: i, title: f.title ?? null, startSec: f.start, endSec: f.end })),
    );
}

/** Create a lesson. Existing slug → Conflict, unless `upsert` (then the lesson is replaced). */
export async function createLesson(db: Db, p: PreparedLesson, opts: { upsert?: boolean } = {}): Promise<Lesson> {
  const [existing] = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.slug, p.slug)).limit(1);
  if (existing) {
    if (!opts.upsert) throw new Conflict(`Slug "${p.slug}" already exists`, existing.id);
    return replaceLesson(db, existing.id, p);
  }
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(lessons).values(lessonValues(p)).returning({ id: lessons.id });
    await writeFragments(tx as unknown as Db, row.id, p.fragments);
    return row.id;
  });
  return getLesson(db, id);
}

export async function replaceLesson(db: Db, idOrSlug: string, p: PreparedLesson): Promise<Lesson> {
  const row = await findRow(db, idOrSlug);
  await db.transaction(async (tx) => {
    await tx
      .update(lessons)
      .set({ ...lessonValues(p), updatedAt: new Date() })
      .where(eq(lessons.id, row.id));
    await writeFragments(tx as unknown as Db, row.id, p.fragments);
  });
  return getLesson(db, row.id);
}

export async function deleteLesson(db: Db, idOrSlug: string): Promise<void> {
  const row = await findRow(db, idOrSlug);
  await db.delete(lessons).where(eq(lessons.id, row.id));
}

export async function setFragments(db: Db, idOrSlug: string, list: Fragment[]): Promise<Lesson> {
  const row = await findRow(db, idOrSlug);
  await db.transaction(async (tx) => {
    await writeFragments(tx as unknown as Db, row.id, list);
    await tx.update(lessons).set({ updatedAt: new Date() }).where(eq(lessons.id, row.id));
  });
  return getLesson(db, row.id);
}

/**
 * Replace the notes of one fragment: every note whose onset is inside the fragment is removed
 * and `notes` (lesson-absolute times) are inserted. The fix path for "this fragment sounds wrong".
 */
export async function replaceFragmentNotes(
  db: Db,
  idOrSlug: string,
  position: number,
  notes: LessonNote[],
): Promise<Lesson> {
  const lesson = await getLesson(db, idOrSlug);
  const fr = lesson.fragments[position];
  if (!fr) throw new NotFound(`Fragment ${position} not found in "${idOrSlug}"`);
  // The same membership rule as the player and the views (notesInRange, TIME_EPS).
  const inside = new Set(notesInRange(lesson.notes, fr.start, fr.end));
  const kept = lesson.notes.filter((n) => !inside.has(n));
  const v = validateLessonInput({ ...lesson, slug: lesson.slug, notes: [...kept, ...notes] });
  if (!v.ok) throw new Invalid(v.errors);
  return replaceLesson(db, lesson.id, prepareLesson(v.value));
}

// ── progress ────────────────────────────────────────────────────────────────

export async function getProgress(db: Db, idOrSlug: string): Promise<FragmentProgress[]> {
  const row = await findRow(db, idOrSlug);
  const rows = await db
    .select()
    .from(progress)
    .where(eq(progress.lessonId, row.id))
    .orderBy(asc(progress.fragmentPosition));
  return rows.map((r) => ({
    fragmentPosition: r.fragmentPosition,
    status: r.status,
    attempts: r.attempts,
    ...(r.lastPracticedAt ? { lastPracticedAt: r.lastPracticedAt.toISOString() } : {}),
  }));
}

export async function recordProgress(
  db: Db,
  idOrSlug: string,
  input: { fragmentPosition: number; status?: ProgressStatus; attempt?: boolean },
): Promise<FragmentProgress[]> {
  const row = await findRow(db, idOrSlug);
  const now = new Date();
  await db
    .insert(progress)
    .values({
      lessonId: row.id,
      fragmentPosition: input.fragmentPosition,
      status: input.status ?? 'learning',
      attempts: input.attempt ? 1 : 0,
      lastPracticedAt: now,
    })
    .onConflictDoUpdate({
      target: [progress.lessonId, progress.fragmentPosition],
      set: {
        ...(input.status ? { status: input.status } : {}),
        attempts: input.attempt ? sql`${progress.attempts} + 1` : progress.attempts,
        lastPracticedAt: now,
      },
    });
  return getProgress(db, row.id);
}

// ── feedback ────────────────────────────────────────────────────────────────

type FeedbackRow = typeof feedback.$inferSelect;

function toFeedback(r: FeedbackRow, slug?: string): Feedback {
  return {
    id: r.id,
    lessonId: r.lessonId,
    ...(slug ? { lessonSlug: slug } : {}),
    ...(r.fragmentPosition !== null ? { fragmentPosition: r.fragmentPosition } : {}),
    message: r.message,
    status: r.status,
    ...(r.resolution ? { resolution: r.resolution } : {}),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function addFeedback(
  db: Db,
  idOrSlug: string,
  input: { fragmentPosition?: number; message: string },
): Promise<Feedback> {
  const row = await findRow(db, idOrSlug);
  const [f] = await db
    .insert(feedback)
    .values({ lessonId: row.id, fragmentPosition: input.fragmentPosition ?? null, message: input.message })
    .returning();
  return toFeedback(f, row.slug);
}

export async function listFeedback(
  db: Db,
  filter: { status?: FeedbackStatus; lesson?: string } = {},
): Promise<Feedback[]> {
  const conds = [];
  if (filter.status) conds.push(eq(feedback.status, filter.status));
  if (filter.lesson) conds.push(eq(feedback.lessonId, (await findRow(db, filter.lesson)).id));
  const rows = await db
    .select({ f: feedback, slug: lessons.slug })
    .from(feedback)
    .innerJoin(lessons, eq(lessons.id, feedback.lessonId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(feedback.createdAt));
  return rows.map((r) => toFeedback(r.f, r.slug));
}

export async function updateFeedback(
  db: Db,
  id: string,
  input: { status?: FeedbackStatus; resolution?: string },
): Promise<Feedback> {
  if (!UUID_RE.test(id)) throw new NotFound(`Feedback "${id}" not found`);
  const [f] = await db
    .update(feedback)
    .set({
      ...(input.status ? { status: input.status } : {}),
      ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
      updatedAt: new Date(),
    })
    .where(eq(feedback.id, id))
    .returning();
  if (!f) throw new NotFound(`Feedback "${id}" not found`);
  return toFeedback(f);
}

// ── guide ───────────────────────────────────────────────────────────────────

type GuideRow = typeof guides.$inferSelect;

function toGuide(r: GuideRow): Guide {
  return { lang: r.lang, title: r.title, sections: r.sections, updatedAt: r.updatedAt.toISOString() };
}

/** The guide in `lang`, else in English, else NotFound. */
export async function getGuide(db: Db, lang: string): Promise<Guide> {
  for (const l of lang === 'en' ? ['en'] : [lang, 'en']) {
    const [r] = await db.select().from(guides).where(eq(guides.lang, l));
    if (r) return toGuide(r);
  }
  throw new NotFound(`No guide in "${lang}" or "en"`);
}

export async function listGuides(db: Db): Promise<{ lang: string; title: string; updatedAt: string }[]> {
  const rows = await db.select().from(guides).orderBy(asc(guides.lang));
  return rows.map((r) => ({ lang: r.lang, title: r.title, updatedAt: r.updatedAt.toISOString() }));
}

/** Create or replace the guide in one language. */
export async function putGuide(db: Db, lang: string, input: GuideInput): Promise<Guide> {
  const values = { lang, title: input.title, sections: input.sections, updatedAt: new Date() };
  const [r] = await db
    .insert(guides)
    .values(values)
    .onConflictDoUpdate({ target: guides.lang, set: { title: values.title, sections: values.sections, updatedAt: values.updatedAt } })
    .returning();
  return toGuide(r);
}

/** Insert the English example guide when the DB has no guide at all. */
export async function seedGuide(db: Db): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(guides);
  if (Number(n) > 0) return false;
  await putGuide(db, 'en', EXAMPLE_GUIDE);
  return true;
}

// ── seed ────────────────────────────────────────────────────────────────────

/** Insert the public-domain demo lessons when the DB has no lessons at all. */
export async function seedDemoLessons(db: Db): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(lessons);
  if (Number(n) > 0) return 0;
  let count = 0;
  for (const d of demoLessons()) {
    const v = validateLessonInput(d);
    if (!v.ok) throw new Error(`Demo lesson invalid: ${v.errors.join('; ')}`);
    await createLesson(db, prepareLesson(v.value));
    count++;
  }
  return count;
}
