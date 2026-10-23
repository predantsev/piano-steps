import ToneMidi from '@tonejs/midi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
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
