import { checkTargetStatic, parseDsn, UnsafeTargetError, redactDsn } from './guard.js';
import { connectUnhooked, loadPg } from './pg-load.js';

const NAME_RE = /^interleave_[a-z0-9_]{1,50}$/;
export const DEFAULT_DEADLOCK_TIMEOUT = '300ms';

/** Accepts only <digits>ms or <digits>s between 10 ms and 10 s; returns milliseconds. Nothing else reaches SQL. */
export function parseDeadlockTimeout(v: string): number {
  const m = /^([0-9]{1,5})(ms|s)$/.exec(v);
  const ms = m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : NaN;
  if (!(ms >= 10 && ms <= 10_000)) throw new Error(`invalid deadlock timeout "${v}": use a duration like 300ms or 1s between 10ms and 10s`);
  return ms;
}

const quote = (id: string) => '"' + id.replace(/"/g, '""') + '"';

export interface InitDbOptions {
  /** DSN of a maintenance database (e.g. .../postgres) on the local server. */
  adminDsn: string;
  name: string;
  /** deadlock_timeout for the test database, 10ms to 10s (default 300ms). */
  deadlockTimeout?: string;
  /** Directory used to resolve `pg`. Defaults to cwd. */
  fromDir?: string;
}

/** Creates the throwaway database, its marker table and a low deadlock_timeout. Returns the new DSN. */
export async function initDb(opts: InitDbOptions): Promise<string> {
  if (!opts.name.startsWith('interleave_')) {
    throw new UnsafeTargetError(`refusing: database name "${opts.name}" must start with interleave_`);
  }
  if (!NAME_RE.test(opts.name)) throw new Error(`invalid database name "${opts.name}" (allowed: interleave_[a-z0-9_]+)`);
  const timeout = parseDeadlockTimeout(opts.deadlockTimeout ?? DEFAULT_DEADLOCK_TIMEOUT);
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
    await a.query(`ALTER DATABASE ${quote(opts.name)} SET deadlock_timeout = '${timeout}ms'`);
  } finally {
    await a.end();
  }

  const c = await connectUnhooked(pg, { ...admin, database: opts.name });
  try {
    await c.query('CREATE TABLE IF NOT EXISTS interleave_marker (created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
    await c.query(`INSERT INTO interleave_marker (created_by) SELECT 'interleave-pg init-db' WHERE NOT EXISTS (SELECT 1 FROM interleave_marker)`);
  } finally {
    await c.end();
  }

  const u = new URL(opts.adminDsn);
  u.pathname = '/' + opts.name;
  return u.toString();
}

export { redactDsn };
