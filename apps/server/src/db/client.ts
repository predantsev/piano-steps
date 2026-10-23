import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../drizzle');

/**
 * DATABASE_URL set → real Postgres. Otherwise PGlite (Postgres compiled to WASM) in a local
 * folder — zero setup, and every worktree/test gets its own isolated database.
 * `dataDir: 'memory://'` gives a throwaway in-memory DB (tests).
 */
export async function openDb(opts: { url?: string; dataDir?: string } = {}): Promise<DbHandle> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    const sql = postgres(url, { max: 5, onnotice: () => {} });
    const db = drizzlePg(sql, { schema });
    await migratePg(db, { migrationsFolder });
    return { db: db as unknown as Db, kind: 'postgres', close: () => sql.end() };
  }
  const dataDir = opts.dataDir ?? process.env.PGLITE_DIR ?? resolve(here, '../../.data/pglite');
  if (!dataDir.startsWith('memory://')) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() };
}
