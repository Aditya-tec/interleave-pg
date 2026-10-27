import { checkTargetStatic, parseDsn, UnsafeTargetError, redactDsn } from './guard.js';
import { connectUnhooked, loadPg } from './pg-load.js';

const NAME_RE = /^raceproof_[a-z0-9_]{1,50}$/;
const quote = (id: string) => '"' + id.replace(/"/g, '""') + '"';

export interface InitDbOptions {
  /** DSN of a maintenance database (e.g. .../postgres) on the local server. */
  adminDsn: string;
  name: string;
  /** Directory used to resolve `pg`. Defaults to cwd. */
  fromDir?: string;
}

/** Creates the throwaway database, its marker table and a low deadlock_timeout. Returns the new DSN. */
export async function initDb(opts: InitDbOptions): Promise<string> {
  if (!opts.name.startsWith('raceproof_')) {
    throw new UnsafeTargetError(`refusing: database name "${opts.name}" must start with raceproof_`);
  }
  if (!NAME_RE.test(opts.name)) throw new Error(`invalid database name "${opts.name}" (allowed: raceproof_[a-z0-9_]+)`);
  const admin = parseDsn(opts.adminDsn);
  checkTargetStatic({ ...admin, database: opts.name }, process.env);
  const pg = loadPg(opts.fromDir ?? process.cwd());

  const a = await connectUnhooked(pg, admin);
  try {
    const exists = await a.query('SELECT 1 FROM pg_database WHERE datname = $1', [opts.name]);
    if (exists.rowCount === 0) {
      try {
        await a.query(`CREATE DATABASE ${quote(opts.name)}`);
      } catch (e: any) {
        if (e.code !== '42P04') throw e;
      }
    }
    await a.query(`ALTER DATABASE ${quote(opts.name)} SET deadlock_timeout = '50ms'`);
  } finally {
    await a.end();
  }

  const c = await connectUnhooked(pg, { ...admin, database: opts.name });
  try {
    await c.query('CREATE TABLE IF NOT EXISTS raceproof_marker (created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
    await c.query(`INSERT INTO raceproof_marker (created_by) SELECT 'raceproof init-db' WHERE NOT EXISTS (SELECT 1 FROM raceproof_marker)`);
  } finally {
    await c.end();
  }

  const u = new URL(opts.adminDsn);
  u.pathname = '/' + opts.name;
  return u.toString();
}

export { redactDsn };
