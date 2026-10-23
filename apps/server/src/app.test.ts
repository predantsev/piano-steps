import ToneMidi from '@tonejs/midi';
import { strToU8, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, MAX_BODY_BYTES } from './app.ts';
import { openDb, type DbHandle } from './db/client.ts';
import { seedDemoLessons } from './repo.ts';

const { Midi } = ToneMidi as unknown as typeof import('@tonejs/midi');

let handle: DbHandle;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  handle = await openDb({ dataDir: 'memory://' });
  await seedDemoLessons(handle.db);
  app = createApp({ db: handle.db, dbKind: handle.kind });
});
afterAll(() => handle.close());

const req = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  });

describe('lessons API', () => {
  it('lists seeded demo lessons', async () => {
    const r = await req('GET', '/api/lessons');
    expect(r.status).toBe(200);
    const { lessons } = (await r.json()) as { lessons: { slug: string; fragmentCount: number }[] };
    expect(lessons.map((l) => l.slug).sort()).toEqual(['fur-elise-opening', 'ode-to-joy', 'twinkle-twinkle']);
    expect(lessons.every((l) => l.fragmentCount > 0)).toBe(true);
  });

  it('creates, conflicts, upserts, fetches by slug and deletes', async () => {
    const lesson = {
      title: 'Test Тема',
      notes: [
        { pitch: 60, start: 0, duration: 0.5, hand: 'R' },
        { pitch: 64, start: 0.5, duration: 0.5, hand: 'R' },
      ],
    };
    const c1 = await req('POST', '/api/lessons', lesson);
    expect(c1.status).toBe(201);
    const created = (await c1.json()) as { id: string; slug: string; fragments: unknown[] };
    expect(created.slug).toBe('test-tema');
    expect(created.fragments.length).toBe(1);

    expect((await req('POST', '/api/lessons', lesson)).status).toBe(409);
    const up = await req('POST', '/api/lessons?upsert=true', { ...lesson, artist: 'X' });
    expect(up.status).toBe(200);

    const g = await req('GET', '/api/lessons/test-tema');
    expect(((await g.json()) as { artist: string }).artist).toBe('X');

    expect((await req('DELETE', `/api/lessons/${created.id}`)).status).toBe(204);
    expect((await req('GET', '/api/lessons/test-tema')).status).toBe(404);
  });

  it('rejects invalid lessons with readable errors', async () => {
    const r = await req('POST', '/api/lessons', { title: 'Bad', notes: [{ pitch: 500, start: 0, duration: 1 }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toMatch(/notes\.0\.pitch/);
  });

  it('imports a MIDI file', async () => {
    const m = new Midi();
    const t = m.addTrack();
    t.addNote({ midi: 60, time: 0, duration: 0.4 });
    t.addNote({ midi: 48, time: 0, duration: 0.4 });
    const r = await app.request('/api/lessons/import/midi?title=Midi%20Test', {
      method: 'POST',
      body: m.toArray(),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(r.status).toBe(201);
    const l = (await r.json()) as { notes: { pitch: number; hand: string }[] };
    expect(l.notes.find((n) => n.pitch === 48)?.hand).toBe('L');
  });
});

describe('practice + feedback loop', () => {
  it('records progress and runs the feedback → fix → resolve loop', async () => {
    const p = await req('POST', '/api/lessons/ode-to-joy/progress', { fragmentPosition: 0, attempt: true });
    expect(p.status).toBe(200);
    await req('POST', '/api/lessons/ode-to-joy/progress', { fragmentPosition: 0, attempt: true, status: 'mastered' });
    const prog = (await (await req('GET', '/api/lessons/ode-to-joy/progress')).json()) as {
      progress: { attempts: number; status: string }[];
    };
    expect(prog.progress[0]).toMatchObject({ attempts: 2, status: 'mastered' });

    const f = await req('POST', '/api/lessons/ode-to-joy/feedback', { fragmentPosition: 1, message: 'Sounds off' });
    expect(f.status).toBe(201);
    const fb = (await f.json()) as { id: string };

    const open = (await (await req('GET', '/api/feedback?status=open')).json()) as { feedback: { id: string }[] };
    expect(open.feedback.map((x) => x.id)).toContain(fb.id);

    const lesson = (await (await req('GET', '/api/lessons/ode-to-joy')).json()) as {
      fragments: { start: number; end: number }[];
    };
    const fr = lesson.fragments[1];
    const fix = await req('PUT', '/api/lessons/ode-to-joy/fragments/1/notes', {
      notes: [{ pitch: 72, start: fr.start, duration: 0.5, hand: 'R' }],
    });
    expect(fix.status).toBe(200);
    const fixed = (await fix.json()) as { notes: { pitch: number; start: number }[] };
    const inside = fixed.notes.filter((n) => n.start >= fr.start && n.start < fr.end);
    expect(inside).toEqual([expect.objectContaining({ pitch: 72 })]);

    const done = await req('PATCH', `/api/feedback/${fb.id}`, { status: 'resolved', resolution: 'Replaced with C5' });
    expect(((await done.json()) as { status: string }).status).toBe('resolved');
  });

  it('serves the OpenAPI spec', async () => {
    const r = await req('GET', '/api/openapi.json');
    const spec = (await r.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toContain('/api/lessons/{ref}/fragments/{position}/notes');
    expect(Object.keys(spec.paths)).toContain('/api/lessons/import/midi');
  });
});

describe('auth', () => {
  it('requires the bearer token for writes when API_TOKEN is set', async () => {
    const secured = createApp({ db: handle.db, dbKind: handle.kind, apiToken: 'secret' });
    expect((await secured.request('/api/lessons')).status).toBe(200);
    const body = JSON.stringify({ title: 'T', notes: [{ pitch: 60, start: 0, duration: 1 }] });
    const headers = { 'content-type': 'application/json' };
    expect((await secured.request('/api/lessons', { method: 'POST', body, headers })).status).toBe(401);
    const ok = await secured.request('/api/lessons', {
      method: 'POST',
      body,
      headers: { ...headers, authorization: 'Bearer secret' },
    });
    expect(ok.status).toBe(201);
  });
});

// ── #5: MusicXML import, MIDI export, error shape, OpenAPI completeness ──────

const fixtureXml = readFileSync(new URL('../../../packages/core/src/fixtures/two-hands.musicxml', import.meta.url), 'utf8');
type LessonJson = { slug: string; title: string; notes: { pitch: number; hand: string }[]; fragments: unknown[]; source?: { kind: string; url?: string } };
type ErrJson = { error: string; details?: string[]; id?: string };

const upload = (path: string, data: NonNullable<RequestInit['body']>, type = 'application/octet-stream') =>
  app.request(path, { method: 'POST', body: data, headers: { 'content-type': type } });

describe('MusicXML import', () => {
  it('imports raw MusicXML with hands from staves and bar-line fragments', async () => {
    const r = await upload('/api/lessons/import/musicxml?sourceUrl=https://example.org/score', fixtureXml, 'application/vnd.recordare.musicxml+xml');
    expect(r.status).toBe(201);
    const l = (await r.json()) as LessonJson;
    expect(l.slug).toBe('test-piece');
    expect(l.notes).toHaveLength(12);
    expect(l.notes.find((n) => n.pitch === 43)?.hand).toBe('L');
    expect(l.notes.find((n) => n.pitch === 75)?.hand).toBe('R');
    expect(l.fragments).toHaveLength(1);
    expect(l.source).toEqual({ kind: 'musicxml', url: 'https://example.org/score' });

    // same slug again → 409 with the existing id; ?upsert=true → 200
    const again = await upload('/api/lessons/import/musicxml', fixtureXml);
    expect(again.status).toBe(409);
    const conflict = (await again.json()) as ErrJson;
    expect(conflict).toMatchObject({ error: 'conflict' });
    expect(conflict.id).toBeTruthy();
    expect((await upload('/api/lessons/import/musicxml?upsert=true', fixtureXml)).status).toBe(200);
  });

  it('imports compressed .mxl and multipart uploads, with title/slug/part from the query', async () => {
    const container =
      '<container><rootfiles><rootfile full-path="s.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';
    const mxl = zipSync({ 'META-INF/container.xml': strToU8(container), 's.musicxml': strToU8(fixtureXml) });
    const r = await upload('/api/lessons/import/musicxml?title=Zipped&slug=zipped-mxl&part=P1', mxl, 'application/vnd.recordare.musicxml');
    expect(r.status).toBe(201);
    expect((await r.json()) as LessonJson).toMatchObject({ slug: 'zipped-mxl', title: 'Zipped' });

    const form = new FormData();
    form.set('file', new File([fixtureXml], 'piece.musicxml', { type: 'application/xml' }));
    const m = await app.request('/api/lessons/import/musicxml?slug=from-form', { method: 'POST', body: form });
    expect(m.status).toBe(201);
    expect(((await m.json()) as LessonJson).notes).toHaveLength(12);
  });

  it('answers 400 invalid-musicxml / bad-request / validation with details', async () => {
    const bad = await upload('/api/lessons/import/musicxml', '<score-partwise><part', 'application/xml');
    expect(bad.status).toBe(400);
    const e = (await bad.json()) as ErrJson;
    expect(e.error).toBe('invalid-musicxml');
    expect(e.details?.[0]).toMatch(/Not valid XML/);

    const nopart = await upload('/api/lessons/import/musicxml?part=Violin', fixtureXml);
    expect(((await nopart.json()) as ErrJson).details?.[0]).toMatch(/No part matches Violin/);

    const empty = await upload('/api/lessons/import/musicxml', '');
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as ErrJson).error).toBe('bad-request');

    const badSlug = await upload('/api/lessons/import/musicxml?slug=Not%20A%20Slug', fixtureXml);
    expect(badSlug.status).toBe(400);
    expect((await badSlug.json()) as ErrJson).toMatchObject({ error: 'validation' });
  });

  it('answers 413 too-large for an oversized body or a .mxl that unpacks too big (zip bomb)', async () => {
    const bomb = zipSync({ 'score.xml': new Uint8Array(25_000_000) }, { level: 9 });
    const r = await upload('/api/lessons/import/musicxml', bomb);
    expect(r.status).toBe(413);
    expect((await r.json()) as ErrJson).toMatchObject({ error: 'too-large', details: [expect.stringMatching(/limit is 20 MB/)] });

    for (const path of ['/api/lessons/import/musicxml', '/api/lessons/import/midi', '/api/lessons']) {
      const big = await app.request(path, {
        method: 'POST',
        body: new Uint8Array(MAX_BODY_BYTES + 1),
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(big.status, path).toBe(413);
      expect((await big.json()) as ErrJson, path).toEqual({ error: 'too-large', details: ['The request body is over 20 MB'] });
    }
    // Chunked (no content-length): counted while streaming.
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 21; i++) c.enqueue(chunk);
        c.close();
      },
    });
    const chunked = await app.request('/api/lessons/import/midi', {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' },
      duplex: 'half', // Node's fetch needs it for a stream body
    });
    expect(chunked.status).toBe(413);
  });
});

describe('MIDI export', () => {
  it('downloads a lesson as a two-track MIDI file that re-imports to the same notes', async () => {
    const lesson = (await (await req('GET', '/api/lessons/fur-elise-opening')).json()) as LessonJson;
    const r = await req('GET', '/api/lessons/fur-elise-opening/export.mid');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/midi');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="fur-elise-opening.mid"');
    const midi = new Midi(new Uint8Array(await r.arrayBuffer()));
    expect(midi.tracks.map((t) => t.name)).toEqual(['Right hand', 'Left hand']);
    expect(midi.tracks[0].notes.length + midi.tracks[1].notes.length).toBe(lesson.notes.length);
    expect(midi.tracks[1].notes.length).toBe(lesson.notes.filter((n) => n.hand === 'L').length);

    const back = await upload('/api/lessons/import/midi?slug=fur-elise-roundtrip', new Uint8Array(await (await req('GET', '/api/lessons/fur-elise-opening/export.mid')).arrayBuffer()));
    expect(back.status).toBe(201);
    const b = (await back.json()) as LessonJson;
    expect(b.notes.map((n) => `${n.pitch}${n.hand}`).sort()).toEqual(lesson.notes.map((n) => `${n.pitch}${n.hand}`).sort());
  });

  it('round-trips a one-hand melody below C4 with a leading rest and its time signature', async () => {
    const lesson = {
      slug: 'rv-melody',
      title: 'RV melody',
      tempo: { bpm: 120, timeSignature: [4, 4] },
      notes: [
        { pitch: 67, start: 0.5, duration: 0.5, hand: 'R' },
        { pitch: 62, start: 1, duration: 0.5, hand: 'R' },
        { pitch: 57, start: 1.5, duration: 0.5, hand: 'R' },
        { pitch: 55, start: 2, duration: 0.5, hand: 'R' },
      ],
    };
    expect((await req('POST', '/api/lessons', lesson)).status).toBe(201);
    const mid = new Uint8Array(await (await req('GET', '/api/lessons/rv-melody/export.mid')).arrayBuffer());
    const back = await upload('/api/lessons/import/midi?slug=rv-melody-back', mid);
    expect(back.status).toBe(201);
    const b = (await back.json()) as { notes: { pitch: number; start: number; duration: number; hand: string }[]; tempo: unknown };
    expect(b.notes.map(({ pitch, start, duration, hand }) => ({ pitch, start, duration, hand }))).toEqual(lesson.notes);
    expect(b.tempo).toEqual(lesson.tempo);
  });

  it('answers 404 not-found for an unknown lesson', async () => {
    const r = await req('GET', '/api/lessons/nope/export.mid');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not-found', details: ['Lesson "nope" not found'] });
  });
});

describe('error shape', () => {
  it('is always { error: code, details? } as JSON', async () => {
    const unknown = await req('GET', '/api/nothing-here');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not-found', details: ['No route for GET /api/nothing-here'] });

    const malformed = await app.request('/api/lessons', {
      method: 'POST',
      body: '{"title": ',
      headers: { 'content-type': 'application/json' },
    });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as ErrJson).error).toBe('bad-request');

    const badMidi = await upload('/api/lessons/import/midi', new Uint8Array([1, 2, 3, 4]));
    expect(badMidi.status).toBe(400);
    const m = (await badMidi.json()) as ErrJson;
    expect(m.error).toBe('invalid-midi');
    expect(m.details?.length).toBe(1);

    const missingFile = await app.request('/api/lessons/import/midi', { method: 'POST', body: new FormData() });
    expect(missingFile.status).toBe(400);
    expect(((await missingFile.json()) as ErrJson).details).toEqual(['multipart field "file" is missing']);

    const badQuery = await req('GET', '/api/feedback?status=closed');
    expect(badQuery.status).toBe(400);
    expect(((await badQuery.json()) as ErrJson).error).toBe('validation');

    const noFeedback = await req('PATCH', '/api/feedback/not-a-uuid', { status: 'resolved' });
    expect(noFeedback.status).toBe(404);
    expect(((await noFeedback.json()) as ErrJson).error).toBe('not-found');

    const noFragment = await req('PUT', '/api/lessons/ode-to-joy/fragments/99/notes', { notes: [] });
    expect(noFragment.status).toBe(404);
  });

  it('answers 401 unauthorized with a hint when the token is missing', async () => {
    const secured = createApp({ db: handle.db, dbKind: handle.kind, apiToken: 'secret' });
    const r = await secured.request('/api/lessons/ode-to-joy/export.mid');
    expect(r.status).toBe(200); // reads stay open
    const w = await secured.request('/api/lessons/import/musicxml', { method: 'POST', body: fixtureXml });
    expect(w.status).toBe(401);
    const e = (await w.json()) as ErrJson;
    expect(e.error).toBe('unauthorized');
    expect(e.details?.[0]).toMatch(/Authorization: Bearer/);
    const h = (await (await secured.request('/api/health')).json()) as { auth: boolean };
    expect(h.auth).toBe(true);
  });
});

describe('OpenAPI spec', () => {
  type Media = { example?: unknown; examples?: unknown; schema?: { $ref?: string; format?: string } };
  type Op = {
    summary?: string;
    description?: string;
    requestBody?: { content: Record<string, Media> };
    responses: Record<string, { content?: Record<string, Media> }>;
  };

  it('documents every route: summary, description, example bodies, consistent errors', async () => {
    const spec = (await (await req('GET', '/api/openapi.json')).json()) as { openapi: string; paths: Record<string, Record<string, Op>> };
    expect(spec.openapi).toBe('3.1.0');
    const paths = Object.keys(spec.paths);
    for (const p of [
      '/api/health',
      '/api/schema/lesson.json',
      '/api/lessons',
      '/api/lessons/{ref}',
      '/api/lessons/{ref}/fragments',
      '/api/lessons/{ref}/fragments/{position}/notes',
      '/api/lessons/import/midi',
      '/api/lessons/import/musicxml',
      '/api/lessons/{ref}/export.mid',
      '/api/lessons/{ref}/progress',
      '/api/lessons/{ref}/feedback',
      '/api/feedback',
      '/api/feedback/{id}',
    ])
      expect(paths).toContain(p);

    const problems: string[] = [];
    for (const [path, ops] of Object.entries(spec.paths))
      for (const [method, op] of Object.entries(ops)) {
        const where = `${method.toUpperCase()} ${path}`;
        if (!op.summary) problems.push(`${where}: no summary`);
        if (!op.description) problems.push(`${where}: no description`);
        for (const [type, media] of Object.entries(op.requestBody?.content ?? {})) {
          const binary = media.schema?.format === 'binary' || type === 'multipart/form-data';
          if (!binary && media.example === undefined && media.examples === undefined)
            problems.push(`${where}: request ${type} has no example`);
        }
        if (op.requestBody && !/curl|example/i.test(op.description ?? '') && Object.values(op.requestBody.content).every((m) => m.example === undefined))
          problems.push(`${where}: binary-only body without a curl example in the description`);
        for (const [status, res] of Object.entries(op.responses)) {
          const media = res.content?.['application/json'];
          if (status.startsWith('2') && media && media.example === undefined) problems.push(`${where}: ${status} has no example`);
          if (/^[45]/.test(status) && media?.schema?.$ref !== '#/components/schemas/Error')
            problems.push(`${where}: ${status} is not the Error schema`);
          if (/^[45]/.test(status) && media?.example === undefined) problems.push(`${where}: ${status} has no example`);
        }
        if (method !== 'get' && !op.responses['401']) problems.push(`${where}: write without a documented 401`);
      }
    expect(problems).toEqual([]);
  });

  it('has example bodies that the API accepts as they are', async () => {
    type Spec = { paths: Record<string, Record<string, { requestBody?: { content: Record<string, { example?: unknown }> } }>> };
    const spec = (await (await req('GET', '/api/openapi.json')).json()) as Spec;
    const xml = spec.paths['/api/lessons/import/musicxml'].post.requestBody!.content['application/vnd.recordare.musicxml+xml'].example;
    const fromXml = await upload('/api/lessons/import/musicxml?slug=spec-example-xml', String(xml), 'application/vnd.recordare.musicxml+xml');
    expect(fromXml.status).toBe(201);
    expect(((await fromXml.json()) as LessonJson).notes.map((n) => `${n.pitch}${n.hand}`)).toEqual(['48L', '64R', '67R']);

    const lesson = spec.paths['/api/lessons'].post.requestBody!.content['application/json'].example as { slug: string };
    expect((await req('POST', '/api/lessons', lesson)).status).toBe(201);
    const fix = spec.paths['/api/lessons/{ref}/fragments/{position}/notes'].put.requestBody!.content['application/json'].example;
    expect((await req('PUT', `/api/lessons/${lesson.slug}/fragments/0/notes`, fix)).status).toBe(200);
    const frs = spec.paths['/api/lessons/{ref}/fragments'].put.requestBody!.content['application/json'].example;
    expect((await req('PUT', `/api/lessons/${lesson.slug}/fragments`, frs)).status).toBe(200);
    const fb = spec.paths['/api/lessons/{ref}/feedback'].post.requestBody!.content['application/json'].example;
    const created = await req('POST', `/api/lessons/${lesson.slug}/feedback`, fb);
    expect(created.status).toBe(201);
    const patch = spec.paths['/api/feedback/{id}'].patch.requestBody!.content['application/json'].example;
    expect((await req('PATCH', `/api/feedback/${((await created.json()) as { id: string }).id}`, patch)).status).toBe(200);
    const prog = spec.paths['/api/lessons/{ref}/progress'].post.requestBody!.content['application/json'].example;
    expect((await req('POST', `/api/lessons/${lesson.slug}/progress`, prog)).status).toBe(200);
    expect((await req('PUT', `/api/lessons/${lesson.slug}`, lesson)).status).toBe(200);
  });

  it('serves the Scalar docs page', async () => {
    const r = await req('GET', '/api/docs');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    expect(await r.text()).toContain('/api/openapi.json');
  });
});
