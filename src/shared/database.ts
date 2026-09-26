import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeConfig } from './config.js';

export interface QueryResult<T> { rows: T[]; affectedRows?: number }
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createDatabase(name: 'core' | 'auth' | 'witness', config: RuntimeConfig): Promise<Database> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
    const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
      async query<T>(sql: string, params?: unknown[]) {
        const result = await client.query(sql, params);
        return { rows: result.rows as T[], affectedRows: result.rowCount ?? undefined };
      },
      async exec(sql) { await client.query(sql); },
    });
    return { ...wrap(pool), async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const value = await fn(wrap(client)); await client.query('COMMIT'); return value; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }, async close() { await pool.end(); } };
  }
  if (config.production) throw new Error('PGlite is restricted to development/tests.');
  const parent = join(config.dataDir, 'db');
  await mkdir(parent, { recursive: true });
  const db = await PGlite.create(join(parent, name));
  const wrap = (q: { query: Function; exec: Function }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) { const result = await q.query(sql, params); return { rows: result.rows as T[], affectedRows: result.affectedRows }; },
    async exec(sql) { await q.exec(sql); },
  });
  return { ...wrap(db), transaction<T>(fn: (tx: Queryable) => Promise<T>) { return db.transaction(tx => fn(wrap(tx))); }, close() { return db.close(); } };
}
