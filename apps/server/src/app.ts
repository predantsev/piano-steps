import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  FeedbackInput,
  FeedbackStatus,
  Fragment,
  LessonInput,
  LessonNote,
  ProgressStatus,
  midiToLesson,
  prepareLesson,
  validateLessonInput,
} from '@piano-steps/core';
import { Scalar } from '@scalar/hono-api-reference';
import type { Context } from 'hono';
import type { Db } from './db/client.ts';
import * as repo from './repo.ts';

/**
 * The HTTP API. It is the ONLY way lessons get in or out — the web app, the agent, the
 * transcriber module and tests all use it. Live docs: /api/docs · spec: /api/openapi.json.
 */

const Ref = z.string().min(1).openapi({ description: 'Lesson id (uuid) or slug', example: 'fur-elise-opening' });

const LessonOut = LessonInput.omit({ fragments: true, slug: true })
  .extend({
    id: z.string(),
    slug: z.string(),
    durationSec: z.number(),
    fragments: z.array(Fragment),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Lesson');

const LessonSummaryOut = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    artist: z.string().optional(),
    composer: z.string().optional(),
    durationSec: z.number(),
    noteCount: z.number(),
    fragmentCount: z.number(),
    sourceKind: z.string().optional(),
    updatedAt: z.string(),
  })
  .openapi('LessonSummary');

const ProgressOut = z
  .object({
    fragmentPosition: z.number(),
    status: ProgressStatus,
    attempts: z.number(),
    lastPracticedAt: z.string().optional(),
  })
  .openapi('FragmentProgress');

const FeedbackOut = z
  .object({
    id: z.string(),
    lessonId: z.string(),
    lessonSlug: z.string().optional(),
    fragmentPosition: z.number().optional(),
    message: z.string(),
    status: FeedbackStatus,
    resolution: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Feedback');

const ErrorOut = z
  .object({ error: z.string(), details: z.array(z.string()).optional(), id: z.string().optional() })
  .openapi('Error');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
const errors = {
  400: json(ErrorOut, 'Invalid input'),
  404: json(ErrorOut, 'Not found'),
};

export interface AppOptions {
  db: Db;
  dbKind: string;
  /** When set, every non-GET /api request needs `Authorization: Bearer <token>`. */
  apiToken?: string;
}

export function createApp({ db, dbKind, apiToken }: AppOptions) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: 'validation',
            details: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
          },
          400,
        );
      }
    },
  });

  app.onError((err, c) => {
    if (err instanceof repo.NotFound) return c.json({ error: err.message }, 404);
    if (err instanceof repo.Conflict) return c.json({ error: err.message, id: err.id }, 409);
    console.error(err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  });

  if (apiToken) {
    app.use('/api/*', async (c, next) => {
      if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
      if (c.req.header('authorization') !== `Bearer ${apiToken}`) return c.json({ error: 'unauthorized' }, 401);
      return next();
    });
  }

  // ── health & schema ──────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/health',
      tags: ['meta'],
      summary: 'Liveness + which database is in use',
      responses: { 200: json(z.object({ ok: z.boolean(), db: z.string(), auth: z.boolean() }), 'OK') },
    }),
    (c) => c.json({ ok: true, db: dbKind, auth: Boolean(apiToken) }, 200),
  );

  app.get('/api/schema/lesson.json', (c) => c.json(z.toJSONSchema(LessonInput, { io: 'input' })));

  // ── lessons ──────────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lessons',
      tags: ['lessons'],
      summary: 'List lessons',
      responses: { 200: json(z.object({ lessons: z.array(LessonSummaryOut) }), 'Lessons') },
    }),
    async (c) => c.json({ lessons: await repo.listLessons(db) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/lessons',
      tags: ['lessons'],
      summary: 'Create a lesson from JSON (the lesson format)',
      description:
        'Body = lesson input (see /api/schema/lesson.json). Fragments are generated when omitted. ' +
        'An existing slug returns 409 unless `?upsert=true`, which replaces that lesson.',
      request: {
        query: z.object({ upsert: z.enum(['true', 'false']).optional() }),
        body: { content: { 'application/json': { schema: LessonInput } }, required: true },
      },
      responses: {
        201: json(LessonOut, 'Created'),
        200: json(LessonOut, 'Replaced (upsert)'),
        ...errors,
        409: json(ErrorOut, 'Slug already exists'),
      },
    }),
    async (c) => {
      const upsert = c.req.valid('query').upsert === 'true';
      const lesson = await repo.createLesson(db, prepareLesson(c.req.valid('json')), { upsert });
      return c.json(lesson, lesson.createdAt === lesson.updatedAt ? 201 : 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lessons/{ref}',
      tags: ['lessons'],
      summary: 'Get a lesson with notes and fragments',
      request: { params: z.object({ ref: Ref }) },
      responses: { 200: json(LessonOut, 'Lesson'), ...errors },
    }),
    async (c) => c.json(await repo.getLesson(db, c.req.valid('param').ref), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/lessons/{ref}',
      tags: ['lessons'],
      summary: 'Replace a lesson',
      request: {
        params: z.object({ ref: Ref }),
        body: { content: { 'application/json': { schema: LessonInput } }, required: true },
      },
      responses: { 200: json(LessonOut, 'Replaced'), ...errors },
    }),
    async (c) =>
      c.json(await repo.replaceLesson(db, c.req.valid('param').ref, prepareLesson(c.req.valid('json'))), 200),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/lessons/{ref}',
      tags: ['lessons'],
      summary: 'Delete a lesson (with its fragments, progress and feedback)',
      request: { params: z.object({ ref: Ref }) },
      responses: { 204: { description: 'Deleted' }, ...errors },
    }),
    async (c) => {
      await repo.deleteLesson(db, c.req.valid('param').ref);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/lessons/{ref}/fragments',
      tags: ['lessons'],
      summary: 'Replace the practice fragments of a lesson',
      request: {
        params: z.object({ ref: Ref }),
        body: {
          content: { 'application/json': { schema: z.object({ fragments: z.array(Fragment).min(1) }) } },
          required: true,
        },
      },
      responses: { 200: json(LessonOut, 'Updated'), ...errors },
    }),
    async (c) =>
      c.json(await repo.setFragments(db, c.req.valid('param').ref, c.req.valid('json').fragments), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/lessons/{ref}/fragments/{position}/notes',
      tags: ['lessons'],
      summary: 'Replace the notes inside one fragment (fixing a fragment after feedback)',
      description: 'Removes every note whose onset lies in the fragment and inserts `notes` (lesson-absolute seconds).',
      request: {
        params: z.object({ ref: Ref, position: z.coerce.number().int().min(0) }),
        body: { content: { 'application/json': { schema: z.object({ notes: z.array(LessonNote) }) } }, required: true },
      },
      responses: { 200: json(LessonOut, 'Updated'), ...errors },
    }),
    async (c) => {
      const { ref, position } = c.req.valid('param');
      return c.json(await repo.replaceFragmentNotes(db, ref, position, c.req.valid('json').notes), 200);
    },
  );

  // ── import (non-JSON sources) ────────────────────────────────────────────
  app.post('/api/lessons/import/midi', async (c) => {
    const bytes = await readUpload(c);
    const q = c.req.query();
    const input = midiToLesson(bytes, { ...(q.title ? { title: q.title } : {}) });
    if (q.slug) input.slug = q.slug;
    if (q.sourceUrl) input.source = { kind: 'midi', url: q.sourceUrl };
    const v = validateLessonInput(input);
    if (!v.ok) return c.json({ error: 'validation', details: v.errors }, 400);
    const lesson = await repo.createLesson(db, prepareLesson(v.value), { upsert: q.upsert === 'true' });
    return c.json(lesson, 201);
  });
  app.openAPIRegistry.registerPath({
    method: 'post',
    path: '/api/lessons/import/midi',
    tags: ['lessons'],
    summary: 'Create a lesson from a Standard MIDI file',
    description:
      'Body: the raw .mid bytes (application/octet-stream) or multipart/form-data with field `file`. ' +
      'Query: title, slug, sourceUrl, upsert=true.',
    request: {
      query: z.object({
        title: z.string().optional(),
        slug: z.string().optional(),
        sourceUrl: z.string().optional(),
        upsert: z.enum(['true', 'false']).optional(),
      }),
      body: { content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } } },
    },
    responses: { 201: json(LessonOut, 'Created'), 400: json(ErrorOut, 'Not a usable MIDI file') },
  });

  // ── progress ─────────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lessons/{ref}/progress',
      tags: ['practice'],
      summary: 'Practice progress per fragment',
      request: { params: z.object({ ref: Ref }) },
      responses: { 200: json(z.object({ progress: z.array(ProgressOut) }), 'Progress'), ...errors },
    }),
    async (c) => c.json({ progress: await repo.getProgress(db, c.req.valid('param').ref) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/lessons/{ref}/progress',
      tags: ['practice'],
      summary: 'Record practice on a fragment (an attempt and/or a new status)',
      request: {
        params: z.object({ ref: Ref }),
        body: {
          content: {
            'application/json': {
              schema: z.object({
                fragmentPosition: z.number().int().min(0),
                status: ProgressStatus.optional(),
                attempt: z.boolean().optional(),
              }),
            },
          },
          required: true,
        },
      },
      responses: { 200: json(z.object({ progress: z.array(ProgressOut) }), 'Progress'), ...errors },
    }),
    async (c) =>
      c.json({ progress: await repo.recordProgress(db, c.req.valid('param').ref, c.req.valid('json')) }, 200),
  );

  // ── feedback ─────────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/lessons/{ref}/feedback',
      tags: ['feedback'],
      summary: 'Report that a lesson/fragment sounds wrong',
      request: {
        params: z.object({ ref: Ref }),
        body: { content: { 'application/json': { schema: FeedbackInput } }, required: true },
      },
      responses: { 201: json(FeedbackOut, 'Created'), ...errors },
    }),
    async (c) => c.json(await repo.addFeedback(db, c.req.valid('param').ref, c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/feedback',
      tags: ['feedback'],
      summary: 'List feedback (agents: `?status=open` is the work queue)',
      request: { query: z.object({ status: FeedbackStatus.optional(), lesson: z.string().optional() }) },
      responses: { 200: json(z.object({ feedback: z.array(FeedbackOut) }), 'Feedback'), ...errors },
    }),
    async (c) => c.json({ feedback: await repo.listFeedback(db, c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/api/feedback/{id}',
      tags: ['feedback'],
      summary: 'Update feedback status / resolution note',
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: {
            'application/json': {
              schema: z.object({ status: FeedbackStatus.optional(), resolution: z.string().max(4000).optional() }),
            },
          },
          required: true,
        },
      },
      responses: { 200: json(FeedbackOut, 'Updated'), ...errors },
    }),
    async (c) => c.json(await repo.updateFeedback(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );

  // ── docs ─────────────────────────────────────────────────────────────────
  app.doc('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'piano-steps API',
      version: '0.1.0',
      description:
        'Lessons, fragments, practice progress and feedback. Agents: create lessons with POST /api/lessons ' +
        '(JSON) or /api/lessons/import/midi; fix reported fragments via GET /api/feedback?status=open → ' +
        'PUT /api/lessons/{ref}/fragments/{position}/notes → PATCH /api/feedback/{id}.',
    },
  });
  app.get('/api/docs', Scalar({ url: '/api/openapi.json', pageTitle: 'piano-steps API' }));

  return app;
}

async function readUpload(c: Context): Promise<Uint8Array> {
  const type = c.req.header('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new Error('multipart field "file" is missing');
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Uint8Array(await c.req.arrayBuffer());
}
