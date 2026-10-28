import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { openDb } from './db/client.ts';
import { ensureNoteIds, seedDemoLessons, seedGuide } from './repo.ts';

const port = Number(process.env.PORT ?? 9301);
const host = process.env.HOST ?? '127.0.0.1';

const handle = await openDb();
if (process.env.SEED_DEMO !== '0') {
  const n = await seedDemoLessons(handle.db);
  if (n) console.log(`seeded ${n} demo lessons`);
}

const backfilled = await ensureNoteIds(handle.db);
if (backfilled) console.log(`gave note ids to ${backfilled} lessons`);
if (await seedGuide(handle.db)) console.log('seeded the example guide (en)');

const app = createApp({ db: handle.db, dbKind: handle.kind, apiToken: process.env.API_TOKEN || undefined });

// Production: serve the built web app from the same origin (one container, one port).
const here = dirname(fileURLToPath(import.meta.url));
const webDist = process.env.WEB_DIST ?? resolve(here, '../../web/dist');
if (process.env.SERVE_WEB === '1' && existsSync(webDist)) {
  const root = relative(process.cwd(), webDist) || '.';
  const indexHtml = readFileSync(resolve(webDist, 'index.html'), 'utf8');
  app.use('/*', serveStatic({ root }));
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml)));
  console.log(`serving web app from ${webDist}`);
}

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`piano-steps API on http://${host}:${info.port} (db: ${handle.kind}) · docs /api/docs`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await handle.close();
    process.exit(0);
  });
