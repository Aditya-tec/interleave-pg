import { createRequire } from 'node:module';
import { join } from 'node:path';

export const BYPASS = Symbol.for('raceproof.bypass');

export type PgModule = any;

/** Resolve the target project's own `pg` (the copy its code will use). */
export function loadPg(fromDir: string): PgModule {
  return createRequire(join(fromDir, 'noop.js'))('pg');
}

/** Connected client that bypasses the hook (engine-internal queries). */
export async function connectUnhooked(pg: PgModule, t: { host: string; port: number; database: string; user?: string; password?: string }) {
  const client = new pg.Client({ host: t.host, port: t.port, database: t.database, user: t.user, password: t.password });
  (client as any)[BYPASS] = true;
  client.on('error', () => {});
  await client.connect();
  return client;
}
