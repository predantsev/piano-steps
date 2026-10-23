/**
 * Upload a lesson to a running piano-steps app.
 *
 *   npm run lesson:add -- song.mid  [--title "My Song"] [--slug my-song] [--source-url URL]
 *   npm run lesson:add -- lesson.json
 *
 * Env: PIANO_STEPS_URL (default http://127.0.0.1:9300 — works for Docker, `npm start` and
 * `npm run dev`, where Vite proxies /api), PIANO_STEPS_API_TOKEN.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    slug: { type: 'string' },
    'source-url': { type: 'string' },
    base: { type: 'string' },
  },
});

const file = positionals[0];
if (!file) {
  console.error('usage: npm run lesson:add -- <file.mid|file.json> [--title T] [--slug s] [--source-url URL]');
  process.exit(2);
}
const base = (values.base ?? process.env.PIANO_STEPS_URL ?? 'http://127.0.0.1:9300').replace(/\/$/, '');
const headers: Record<string, string> = {};
if (process.env.PIANO_STEPS_API_TOKEN) headers.authorization = `Bearer ${process.env.PIANO_STEPS_API_TOKEN}`;

let res: Response;
if (/\.json$/i.test(file)) {
  const body = JSON.parse(readFileSync(file, 'utf8'));
  if (values.title) body.title = values.title;
  if (values.slug) body.slug = values.slug;
  res = await fetch(`${base}/api/lessons?upsert=true`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
} else {
  const q = new URLSearchParams({ title: values.title ?? basename(file).replace(/\.(mid|midi)$/i, ''), upsert: 'true' });
  if (values.slug) q.set('slug', values.slug);
  if (values['source-url']) q.set('sourceUrl', values['source-url']);
  res = await fetch(`${base}/api/lessons/import/midi?${q}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    body: readFileSync(file),
  });
}

const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
if (!res.ok) {
  console.error(`✗ ${res.status}`, JSON.stringify(out, null, 2));
  process.exit(1);
}
const notes = Array.isArray(out.notes) ? out.notes.length : '?';
const frags = Array.isArray(out.fragments) ? out.fragments.length : '?';
console.log(`✓ ${out.title} → ${base}/?lesson=${out.slug}  (${notes} notes, ${frags} fragments)`);
