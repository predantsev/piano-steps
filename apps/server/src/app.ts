import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  FeedbackInput,
  FeedbackKind,
  FeedbackStatus,
  Fragment,
  GuideInput,
  GuideLang,
  EXAMPLE_GUIDE,
  LessonInput,
  LessonNote,
  ProgressStatus,
  lessonToMidi,
  midiToLesson,
  MAX_SCORE_BYTES,
  MusicXmlTooLarge,
  musicxmlToLesson,
  prepareLesson,
  validateLessonInput,
  lessonRuleErrors,
  type LessonInput as LessonInputT,
} from '@piano-steps/core';
import { Scalar } from '@scalar/hono-api-reference';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { Db } from './db/client.ts';
import * as ex from './examples.ts';
import * as repo from './repo.ts';

/**
 * The HTTP API. It is the ONLY way lessons get in or out — the web app, the agent, the
 * transcriber module and tests all use it. Live docs: /api/docs · spec: /api/openapi.json.
 *
 * Every error is `{ error: <code>, details?: string[] }` (+ `id` on 409) — see `ErrorOut`.
 */

/** Thrown inside handlers to answer with a specific status + error code. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 413 | 415 | 500,
    readonly code: string,
    readonly details: string[] = [],
  ) {
    super(details[0] ?? code);
  }
}

/** Cap on any request body (uploads included). */
export const MAX_BODY_BYTES = 20 * 1024 * 1024;

const Ref = z.string().min(1).openapi({ description: 'Lesson id (uuid) or slug', example: 'twinkle-bar-1' });

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
    noteId: z.string().optional(),
    note: LessonNote.optional().openapi({ description: 'The note as it was when reported' }),
    kind: FeedbackKind.optional(),
    message: z.string(),
    status: FeedbackStatus,
    resolution: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Feedback');

const GuideOut = GuideInput.extend({ lang: z.string(), updatedAt: z.string() }).openapi('Guide');
const guideExample = { lang: 'en', updatedAt: '2026-10-28T12:00:00.000Z', ...EXAMPLE_GUIDE, sections: EXAMPLE_GUIDE.sections.slice(0, 1) };

const ErrorOut = z
  .object({
    error: z.string().openapi({
      description:
        'Stable machine code: `validation` (input does not match the schema / not a valid lesson), ' +
        '`bad-request` (malformed JSON, empty or unreadable upload), `invalid-midi`, `invalid-musicxml`, ' +
        '`unauthorized`, `not-found`, `conflict`, `internal`.',
      example: 'validation',
    }),
    details: z
      .array(z.string())
      .optional()
      .openapi({ description: 'Human-readable messages; for `validation` each is `path: message`.' }),
    id: z.string().optional().openapi({ description: 'On `conflict`: the id of the lesson that already has this slug.' }),
  })
  .openapi('Error');

const json = <T extends z.ZodType>(schema: T, description: string, example?: unknown) => ({
  content: { 'application/json': { schema, ...(example !== undefined ? { example } : {}) } },
  description,
});
const body = <T extends z.ZodType>(schema: T, example: unknown) => ({
  content: { 'application/json': { schema, example } },
  required: true,
});
const err = (description: string, example: unknown) => json(ErrorOut, description, example);
const read = { 404: err('Lesson not found', ex.errors.notFound) };
/** Responses of every route with a JSON body. */
const write = {
  400: err('Invalid input', ex.errors.validation),
  401: err('Missing or wrong bearer token (only when the server has API_TOKEN set)', ex.errors.unauthorized),
  413: err(`The body is over ${MAX_BODY_BYTES / 1048576} MB`, ex.errors.tooLarge),
  415: err('The body is not sent as `content-type: application/json`', ex.errors.unsupportedMediaType),
};

/** The schema passed; also enforce the rules it cannot express (fragment ranges, unique note ids). */
function checkedLesson<T extends Parameters<typeof lessonRuleErrors>[0]>(input: T): T {
  const errors = lessonRuleErrors(input);
  if (errors.length) throw new HttpError(400, 'validation', errors);
  return input;
}

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

  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.code, ...(e.details.length ? { details: e.details } : {}) }, e.status);
    if (e instanceof repo.NotFound) return c.json({ error: 'not-found', details: [e.message] }, 404);
    if (e instanceof repo.Conflict) return c.json({ error: 'conflict', details: [e.message], id: e.id }, 409);
    if (e instanceof repo.Invalid) return c.json({ error: 'validation', details: e.details }, 400);
    if (e instanceof HTTPException && e.status < 500) {
      const code = e.status === 401 ? 'unauthorized' : e.status === 404 ? 'not-found' : 'bad-request';
      return c.json({ error: code, details: [e.message] }, e.status);
    }
    console.error(e);
    return c.json({ error: 'internal', details: [e instanceof Error ? e.message : String(e)] }, 500);
  });

  app.notFound((c) => c.json({ error: 'not-found', details: [`No route for ${c.req.method} ${c.req.path}`] }, 404));

  // Every upload/body is capped (a .mid or a MusicXML file is far smaller); checked while streaming.
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new HttpError(413, 'too-large', [`The request body is over ${MAX_BODY_BYTES / 1048576} MB`]);
      },
    }),
  );

  if (apiToken) {
    app.use('/api/*', async (c, next) => {
      if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
      if (c.req.header('authorization') !== `Bearer ${apiToken}`) return c.json(ex.errors.unauthorized, 401);
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
      description:
        '`db` is `postgres` or `pglite`. `auth: true` means the server has API_TOKEN set: every non-GET ' +
        'request then needs `Authorization: Bearer <token>` (the web app asks for it in Settings).',
      responses: { 200: json(z.object({ ok: z.boolean(), db: z.string(), auth: z.boolean() }), 'OK', ex.health) },
    }),
    (c) => c.json({ ok: true, db: dbKind, auth: Boolean(apiToken) }, 200),
  );

  const lessonJsonSchema = z.toJSONSchema(LessonInput, { io: 'input' });
  app.get('/api/schema/lesson.json', (c) => c.json(lessonJsonSchema));
  app.openAPIRegistry.registerPath({
    method: 'get',
    path: '/api/schema/lesson.json',
    tags: ['meta'],
    summary: 'JSON Schema of the lesson input',
    description:
      'The same schema as `docs/lesson.schema.json`, generated from the zod definition in `packages/core`. ' +
      'Validate a lesson against it before POSTing, or hand it to a model as the output format.',
    responses: {
      200: {
        description: 'JSON Schema (draft 2020-12)',
        content: { 'application/json': { schema: { type: 'object' }, example: lessonJsonSchema } },
      },
    },
  });

  // ── lessons ──────────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lessons',
      tags: ['lessons'],
      summary: 'List lessons',
      description: 'Summaries only (no notes), sorted by title. Fetch one with GET /api/lessons/{ref}.',
      responses: { 200: json(z.object({ lessons: z.array(LessonSummaryOut) }), 'Lessons', { lessons: [ex.lessonSummary] }) },
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
        'Body = lesson input (see /api/schema/lesson.json): times in seconds, pitch as a MIDI number ' +
        '(60 = C4). Fragments are generated when omitted; the slug is derived from the title when omitted. ' +
        'An existing slug returns 409 unless `?upsert=true`, which replaces that lesson (200).',
      request: {
        query: z.object({ upsert: z.enum(['true', 'false']).optional() }),
        body: body(LessonInput, ex.lessonInput),
      },
      responses: {
        201: json(LessonOut, 'Created', ex.lesson),
        200: json(LessonOut, 'Replaced (upsert)', ex.lesson),
        ...write,
        409: err('Slug already exists', ex.errors.conflict),
      },
    }),
    async (c) => {
      const upsert = c.req.valid('query').upsert === 'true';
      const lesson = await repo.createLesson(db, prepareLesson(checkedLesson(c.req.valid('json'))), { upsert });
      return c.json(lesson, lesson.createdAt === lesson.updatedAt ? 201 : 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lessons/{ref}',
      tags: ['lessons'],
      summary: 'Get a lesson with notes and fragments',
      description:
        '`ref` is the id or the slug. Notes are sorted by onset; `fragments[i]` are time windows ' +
        '(`start` inclusive, `end` exclusive) over those notes — the practice chunks.',
      request: { params: z.object({ ref: Ref }) },
      responses: { 200: json(LessonOut, 'Lesson', ex.lesson), ...read },
    }),
    async (c) => c.json(await repo.getLesson(db, c.req.valid('param').ref), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/lessons/{ref}',
      tags: ['lessons'],
      summary: 'Replace a lesson',
      description:
        'Replaces everything (metadata, notes, fragments) of an existing lesson; the id stays. ' +
        'Fragments are regenerated when omitted. Progress and feedback are kept.',
      request: { params: z.object({ ref: Ref }), body: body(LessonInput, ex.lessonInput) },
      responses: { 200: json(LessonOut, 'Replaced', ex.lesson), ...write, ...read },
    }),
    async (c) =>
      c.json(await repo.replaceLesson(db, c.req.valid('param').ref, prepareLesson(checkedLesson(c.req.valid('json')))), 200),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/lessons/{ref}',
      tags: ['lessons'],
      summary: 'Delete a lesson (with its fragments, progress and feedback)',
      description: 'Irreversible. Answers 204 with an empty body.',
      request: { params: z.object({ ref: Ref }) },
      responses: { 204: { description: 'Deleted' }, 401: write[401], ...read },
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
      description:
        'Sets a new split into practice chunks (seconds, lesson-absolute). Notes are untouched. ' +
        'Progress is stored per fragment position, so re-splitting changes what old positions mean.',
      request: {
        params: z.object({ ref: Ref }),
        body: body(z.object({ fragments: z.array(Fragment).min(1) }), ex.fragments),
      },
      responses: { 200: json(LessonOut, 'Updated', ex.lesson), ...write, ...read },
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
      description:
        'Removes every note whose onset lies in fragment `position` and inserts `notes` ' +
        '(lesson-absolute seconds). The rest of the lesson is untouched. 400 `validation` if the result ' +
        'is not a valid lesson.',
      request: {
        params: z.object({ ref: Ref, position: z.coerce.number().int().min(0).openapi({ example: 0 }) }),
        body: body(z.object({ notes: z.array(LessonNote) }), ex.fragmentNotes),
      },
      responses: { 200: json(LessonOut, 'Updated', ex.lesson), ...write, 404: err('Lesson or fragment not found', ex.errors.notFound) },
    }),
    async (c) => {
      const { ref, position } = c.req.valid('param');
      return c.json(await repo.replaceFragmentNotes(db, ref, position, c.req.valid('json').notes), 200);
    },
  );

  // ── import / export (binary) ─────────────────────────────────────────────
  const ImportQuery = z.object({
    title: z.string().min(1).max(200).optional(),
    slug: z.string().optional(),
    sourceUrl: z.string().optional(),
    upsert: z.enum(['true', 'false']).optional(),
  });

  const saveImported = async (c: Context, input: LessonInputT, q: z.infer<typeof ImportQuery>) => {
    if (q.slug) input.slug = q.slug;
    const v = validateLessonInput(input);
    if (!v.ok) throw new HttpError(400, 'validation', v.errors);
    const lesson = await repo.createLesson(db, prepareLesson(v.value), { upsert: q.upsert === 'true' });
    return c.json(lesson, lesson.createdAt === lesson.updatedAt ? 201 : 200);
  };

  app.post('/api/lessons/import/midi', async (c) => {
    const q = parseQuery(c, ImportQuery);
    const bytes = await readUpload(c);
    let input: LessonInputT;
    try {
      input = midiToLesson(bytes, { ...(q.title ? { title: q.title } : {}) });
    } catch (e) {
      throw new HttpError(400, 'invalid-midi', [e instanceof Error ? e.message : String(e)]);
    }
    if (q.sourceUrl) input.source = { kind: 'midi', url: q.sourceUrl };
    return saveImported(c, input, q);
  });
  app.openAPIRegistry.registerPath({
    method: 'post',
    path: '/api/lessons/import/midi',
    tags: ['import / export'],
    summary: 'Create a lesson from a Standard MIDI file',
    description:
      'Body: the raw `.mid` bytes (`application/octet-stream`) or `multipart/form-data` with field `file`. ' +
      'Hands: tracks named "Right hand" / "Left hand" (our export.mid) → by name; else two tracks → the higher one ' +
      'is the right hand; one track → split at C4. Leading silence is trimmed, except in a file with those ' +
      'track names, which keeps its timing and time signature. ' +
      'Example: `curl -X POST "$BASE/api/lessons/import/midi?title=My%20Song" ' +
      '-H "content-type: application/octet-stream" --data-binary @song.mid`',
    request: {
      query: ImportQuery,
      body: {
        content: {
          'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) },
          'multipart/form-data': { schema: z.object({ file: z.string().openapi({ format: 'binary' }) }) },
        },
        required: true,
      },
    },
    responses: {
      201: json(LessonOut, 'Created', ex.lesson),
      200: json(LessonOut, 'Replaced (upsert)', ex.lesson),
      400: err('Not a usable MIDI file, or the result is not a valid lesson', ex.errors.invalidMidi),
      401: write[401],
      409: err('Slug already exists', ex.errors.conflict),
      413: err(`The body is over ${MAX_BODY_BYTES / 1048576} MB`, ex.errors.tooLarge),
    },
  });

  const MusicXmlQuery = ImportQuery.extend({
    part: z.string().optional(),
  });
  app.post('/api/lessons/import/musicxml', async (c) => {
    const q = parseQuery(c, MusicXmlQuery);
    const bytes = await readUpload(c);
    let input: LessonInputT;
    try {
      input = musicxmlToLesson(bytes, {
        ...(q.title ? { title: q.title } : {}),
        ...(q.part ? { parts: q.part.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      });
    } catch (e) {
      if (e instanceof MusicXmlTooLarge) throw new HttpError(413, 'too-large', [e.message]);
      throw new HttpError(400, 'invalid-musicxml', [e instanceof Error ? e.message : String(e)]);
    }
    if (q.sourceUrl) input.source = { kind: 'musicxml', url: q.sourceUrl };
    return saveImported(c, input, q);
  });
  app.openAPIRegistry.registerPath({
    method: 'post',
    path: '/api/lessons/import/musicxml',
    tags: ['import / export'],
    summary: 'Create a lesson from MusicXML (.musicxml / .xml, or compressed .mxl)',
    description:
      'Body: the file bytes (any content type; `.mxl` is recognised by its zip signature) or ' +
      '`multipart/form-data` with field `file`. Reads notes, rests, chords, ties (merged), backup/forward, ' +
      'tempo (`<sound tempo>` / metronome, changes honoured; 120 bpm before a first mark that comes after bar 2), ' +
      '`<transpose>` (transposing instruments import at the sounding pitch). Max 20 MB unpacked. Hands: a two-staff part → staff 1 = right, ' +
      'staff 2 = left; two single-staff parts → the higher is right. Fragments are cut on bar lines (~6 s). ' +
      'Not supported: score-timewise, repeats (read straight through), grace notes (skipped). ' +
      '`part` = comma-separated part ids or names to import (default: all). ' +
      'Example: `curl -X POST "$BASE/api/lessons/import/musicxml?part=P1" --data-binary @song.mxl`',
    request: {
      query: MusicXmlQuery,
      body: {
        content: {
          'application/vnd.recordare.musicxml+xml': { schema: z.string(), example: MUSICXML_EXAMPLE },
          'application/vnd.recordare.musicxml': { schema: z.string().openapi({ format: 'binary' }) },
          'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) },
          'multipart/form-data': { schema: z.object({ file: z.string().openapi({ format: 'binary' }) }) },
        },
        required: true,
      },
    },
    responses: {
      201: json(LessonOut, 'Created', ex.lesson),
      200: json(LessonOut, 'Replaced (upsert)', ex.lesson),
      400: err('Not readable MusicXML, or the result is not a valid lesson', ex.errors.invalidMusicXml),
      401: write[401],
      409: err('Slug already exists', ex.errors.conflict),
      413: err(
        `The body is over ${MAX_BODY_BYTES / 1048576} MB, or the score is over ${MAX_SCORE_BYTES / 1048576} MB unpacked (.mxl)`,
        ex.errors.tooLarge,
      ),
    },
  });

  app.get('/api/lessons/:ref/export.mid', async (c) => {
    const lesson = await repo.getLesson(db, c.req.param('ref'));
    return c.body(new Uint8Array(lessonToMidi(lesson)), 200, {
      'content-type': 'audio/midi',
      'content-disposition': `attachment; filename="${lesson.slug}.mid"`,
    });
  });
  app.openAPIRegistry.registerPath({
    method: 'get',
    path: '/api/lessons/{ref}/export.mid',
    tags: ['import / export'],
    summary: 'Download a lesson as a Standard MIDI file',
    description:
      'Format-1 MIDI with two tracks: "Right hand" then "Left hand" (notes without a hand: below C4 → left). ' +
      'Tempo and time signature go into the header. Re-importing it with /api/lessons/import/midi gives ' +
      'the same notes back (pitch, hand, start and duration to the MIDI tick, a leading rest included) and ' +
      'the same tempo — except two overlapping notes of the same pitch in one hand, which MIDI cannot tell ' +
      'apart (they come back re-cut). Fragments are not stored in MIDI: they are re-cut on import. Example: `curl -o song.mid "$BASE/api/lessons/twinkle-bar-1/export.mid"`',
    request: { params: z.object({ ref: Ref }) },
    responses: {
      200: {
        description: 'The .mid file (`content-disposition: attachment; filename="<slug>.mid"`)',
        content: { 'audio/midi': { schema: z.string().openapi({ format: 'binary' }) } },
      },
      ...read,
    },
  });

  // ── progress ─────────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lessons/{ref}/progress',
      tags: ['practice'],
      summary: 'Practice progress per fragment',
      description: 'One entry per fragment the user has practised; fragments never touched are absent.',
      request: { params: z.object({ ref: Ref }) },
      responses: { 200: json(z.object({ progress: z.array(ProgressOut) }), 'Progress', ex.progress), ...read },
    }),
    async (c) => c.json({ progress: await repo.getProgress(db, c.req.valid('param').ref) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/lessons/{ref}/progress',
      tags: ['practice'],
      summary: 'Record practice on a fragment (an attempt and/or a new status)',
      description:
        '`attempt: true` adds one to the attempt counter; `status` (new · learning · mastered) replaces the ' +
        'status. Returns the whole progress list of the lesson.',
      request: {
        params: z.object({ ref: Ref }),
        body: body(
          z.object({
            fragmentPosition: z.number().int().min(0),
            status: ProgressStatus.optional(),
            attempt: z.boolean().optional(),
          }),
          ex.progressInput,
        ),
      },
      responses: { 200: json(z.object({ progress: z.array(ProgressOut) }), 'Progress', ex.progress), ...write, ...read },
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
      description:
        'Written by the user from the app ("Sounds wrong"). It lands in the agents\' work queue ' +
        '(GET /api/feedback?status=open) with status `open`. Omit `fragmentPosition` for the lesson as a whole. ' +
        'From a tapped note the app sends `noteId` + `kind` (higher · lower · extra · missing · timing · other); the ' +
        'server then stores a copy of that note and its fragment, so the report stays readable after a fix.',
      request: { params: z.object({ ref: Ref }), body: body(FeedbackInput, ex.feedbackInput) },
      responses: { 201: json(FeedbackOut, 'Created', ex.feedback), ...write, ...read },
    }),
    async (c) => c.json(await repo.addFeedback(db, c.req.valid('param').ref, c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/feedback',
      tags: ['feedback'],
      summary: 'List feedback (agents: `?status=open` is the work queue)',
      description:
        'Newest first. Filter by `status` (open · in-progress · resolved · wont-fix) and/or `lesson` (id or slug). ' +
        'Each item names `lessonSlug` + `fragmentPosition`; read that fragment with GET /api/lessons/{ref}.',
      request: {
        query: z.object({
          status: FeedbackStatus.optional().openapi({ example: 'open' }),
          lesson: z.string().optional().openapi({ example: 'twinkle-bar-1' }),
        }),
      },
      responses: {
        200: json(z.object({ feedback: z.array(FeedbackOut) }), 'Feedback', { feedback: [ex.feedback] }),
        400: err('Invalid filter', ex.errors.validation),
        ...read,
      },
    }),
    async (c) => c.json({ feedback: await repo.listFeedback(db, c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/api/feedback/{id}',
      tags: ['feedback'],
      summary: 'Update feedback status / resolution note',
      description:
        'Agents: set `in-progress` when you pick an item up, then `resolved` (or `wont-fix`) with a short ' +
        '`resolution` saying what changed — the user reads it.',
      request: {
        params: z.object({ id: z.string().openapi({ example: ex.feedback.id }) }),
        body: body(
          z.object({ status: FeedbackStatus.optional(), resolution: z.string().max(4000).optional() }),
          ex.feedbackPatch,
        ),
      },
      responses: {
        200: json(FeedbackOut, 'Updated', { ...ex.feedback, ...ex.feedbackPatch }),
        ...write,
        404: err('Feedback not found', { error: 'not-found', details: [`Feedback "${ex.feedback.id}" not found`] }),
      },
    }),
    async (c) => c.json(await repo.updateFeedback(db, c.req.valid('param').id, c.req.valid('json')), 200),
  );

  // ── guide ────────────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/guide',
      tags: ['guide'],
      summary: 'The in-app guide ("How to use it") in one language',
      description:
        'Falls back to English when there is no guide in `lang`; `lang` in the answer says which one you got. ' +
        'A paragraph starting with "• " is a list item.',
      request: { query: z.object({ lang: GuideLang.optional().openapi({ example: 'uk' }) }) },
      responses: {
        200: json(GuideOut, 'Guide', guideExample),
        400: err('Invalid language code', ex.errors.validation),
        404: err('No guide at all', { error: 'not-found', details: ['No guide in "uk" or "en"'] }),
      },
    }),
    async (c) => c.json(await repo.getGuide(db, c.req.valid('query').lang ?? 'en'), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/guides',
      tags: ['guide'],
      summary: 'Which languages the guide exists in',
      description: 'One entry per language. Update every one of them when the guide changes.',
      responses: {
        200: json(
          z.object({ guides: z.array(z.object({ lang: z.string(), title: z.string(), updatedAt: z.string() })) }),
          'Guides',
          { guides: [{ lang: 'en', title: EXAMPLE_GUIDE.title, updatedAt: guideExample.updatedAt }] },
        ),
      },
    }),
    async (c) => c.json({ guides: await repo.listGuides(db) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/guide/{lang}',
      tags: ['guide'],
      summary: 'Create or replace the guide in one language',
      description:
        'Agents: when a change alters what the user sees, update the guide in EVERY language listed by ' +
        'GET /api/guides, keeping section ids the same across languages. The whole guide is replaced.',
      request: {
        params: z.object({ lang: GuideLang.openapi({ example: 'uk' }) }),
        body: body(GuideInput, { title: EXAMPLE_GUIDE.title, sections: guideExample.sections }),
      },
      responses: { 200: json(GuideOut, 'Saved', guideExample), ...write },
    }),
    async (c) => c.json(await repo.putGuide(db, c.req.valid('param').lang, c.req.valid('json')), 200),
  );

  // ── docs ─────────────────────────────────────────────────────────────────
  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'piano-steps API',
      version: '0.2.0',
      description:
        'Lessons, fragments, practice progress and feedback. Time is in seconds, pitch is a MIDI number (60 = C4).\n\n' +
        'Agents: create lessons with POST /api/lessons (JSON), /api/lessons/import/midi or ' +
        '/api/lessons/import/musicxml; download one as MIDI with GET /api/lessons/{ref}/export.mid; fix reported ' +
        'fragments via GET /api/feedback?status=open → PUT /api/lessons/{ref}/fragments/{position}/notes → ' +
        'PATCH /api/feedback/{id}. The in-app guide is GET /api/guide?lang= / PUT /api/guide/{lang} — keep it in ' +
        'step with what you change, in every language (GET /api/guides).\n\n' +
        'Errors are always `{ "error": "<code>", "details": ["…"] }` (see the Error schema). When /api/health ' +
        'says `auth: true`, send `Authorization: Bearer <token>` on every non-GET request.',
    },
  });
  app.get('/api/docs', Scalar({ url: '/api/openapi.json', pageTitle: 'piano-steps API' }));

  return app;
}

const MUSICXML_EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Two notes</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
    <sound tempo="100"/>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff></note>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff></note>
    <backup><duration>4</duration></backup>
    <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>
  </measure></part>
</score-partwise>`;

function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success)
    throw new HttpError(
      400,
      'validation',
      r.error.issues.map((i) => `${i.path.join('.') || '(query)'}: ${i.message}`),
    );
  return r.data;
}

async function readUpload(c: Context): Promise<Uint8Array> {
  const type = c.req.header('content-type') ?? '';
  let bytes: Uint8Array;
  if (type.startsWith('multipart/form-data')) {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new HttpError(400, 'bad-request', ['multipart field "file" is missing']);
    bytes = new Uint8Array(await file.arrayBuffer());
  } else bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, 'bad-request', ['The request body is empty — send the file bytes']);
  return bytes;
}
