/** Safety guard: raceproof only ever talks to a local throwaway database (S1/S2). */

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

export interface Target {
  host: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
}

export interface Conn {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
  end(): Promise<void>;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const DB_PATTERN = /^raceproof_/;

export function redactDsn(dsn: string): string {
  return dsn.replace(/^([a-z]+:\/\/[^:/@\s]*):[^@/\s]*@/i, '$1:***@');
}

export function isLocalHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith('/');
}

export function parseDsn(dsn: string): Target {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new UnsafeTargetError('refusing target: DSN is not a parseable postgres:// URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new UnsafeTargetError('refusing target: DSN must use the postgres:// scheme');
  }
  const socketDir = url.searchParams.get('host');
  let host = socketDir ?? decodeURIComponent(url.hostname);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) host = 'localhost';
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    database,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

/** Static checks only: no connection, no query. */
export function checkTargetStatic(t: Target, env: Record<string, string | undefined>): void {
  if (env.NODE_ENV === 'production') throw new UnsafeTargetError('refusing target: NODE_ENV is production');
  if (!isLocalHost(t.host)) {
    throw new UnsafeTargetError(`refusing target: host "${t.host}" is not local (allowed: localhost, 127.0.0.1, ::1, unix socket)`);
  }
  if (!DB_PATTERN.test(t.database)) {
    throw new UnsafeTargetError(`refusing target: database name "${t.database}" must match ${DB_PATTERN}`);
  }
}

export interface GuardDeps {
  env?: Record<string, string | undefined>;
  connect: (t: Target) => Promise<Conn>;
}

/**
 * S1. Static checks run first, with nothing sent. Only then do we connect and send one read-only
 * catalog probe for the marker table that only `init-db` creates.
 */
export async function assertSafeTarget(dsn: string | undefined, deps: GuardDeps): Promise<Target> {
  if (!dsn) throw new UnsafeTargetError('refusing target: no DSN. Set RACEPROOF_DSN or pass --dsn');
  const target = parseDsn(dsn);
  checkTargetStatic(target, deps.env ?? process.env);
  const conn = await deps.connect(target);
  try {
    const r = await conn.query(`SELECT to_regclass('public.raceproof_marker') IS NOT NULL AS raceproof_marker_ok`);
    if (!r.rows[0] || Object.values(r.rows[0])[0] !== true) {
      throw new UnsafeTargetError('refusing target: marker table raceproof_marker not found. Create the database with `raceproof init-db`');
    }
  } finally {
    await conn.end().catch(() => {});
  }
  return target;
}

/** S2: every hooked client must point at exactly the allowed target (loopback aliases are equivalent). */
export function checkClientParams(
  target: Target,
  c: { host?: string; port?: number | string; database?: string },
): void {
  const host = c.host ?? 'localhost';
  const port = Number(c.port ?? 5432);
  const sameHost = host === target.host || (LOOPBACK.has(host) && LOOPBACK.has(target.host));
  if (!sameHost || port !== target.port || c.database !== target.database) {
    throw new UnsafeTargetError(
      `UnsafeTargetError: client points at ${host}:${port}/${c.database}, allowed target is ${target.host}:${target.port}/${target.database}`,
    );
  }
}
