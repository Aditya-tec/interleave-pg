/** Safety guard: interleave-pg only ever talks to a local throwaway database (S1/S2). */

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
const DB_PATTERN = /^interleave_/;

/**
 * S5. Replaces every password in `text` with `***`: URL userinfo (the password runs to the last "@" of the token, so a
 * raw "@" or "/" inside it cannot leak a tail), `password=` in a query string, and `password=` in keyword/value form.
 */
export function redactDsn(dsn: string): string {
  return dsn
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:/@\s]*):\S*@/gi, '$1:***@')
    .replace(/\bpassword\s*=\s*('(?:[^'\\]|\\.)*'|[^&\s]+)/gi, 'password=***');
}

export function isLocalHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith('/');
}

/** Query parameters a DSN may carry. Everything else (hostaddr, dbname, port, service, options, ...) is refused. */
const ALLOWED_PARAMS = new Set(['application_name', 'connect_timeout']);

export function parseDsn(dsn: string): Target {
  const refuse = (why: string): never => { throw new UnsafeTargetError(`refusing target: ${why}`); };
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return refuse('DSN is not a parseable postgres:// URL (multi-host DSNs and key=value strings are not supported)');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') refuse('DSN must use the postgres:// scheme');
  if (url.hostname.includes(',') || decodeURIComponent(url.hostname).includes(',')) refuse('multi-host DSNs are not supported');

  let socketDir: string | undefined;
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) refuse(`query parameter "${key}" is given more than once`);
    seen.add(key);
    if (key === 'host') {
      if (!value.startsWith('/') || value.includes(',')) refuse('query parameter "host" is only allowed as a local unix-socket directory path');
      socketDir = value;
    } else if (!ALLOWED_PARAMS.has(key)) {
      refuse(`query parameter "${key}" is not allowed (allowed: host=<socket dir>, ${[...ALLOWED_PARAMS].join(', ')})`);
    }
  }
  if (connectTimeoutInvalid(url)) refuse('connect_timeout must be a non-negative integer');

  const hostFromAuthority = decodeURIComponent(url.hostname);
  if (socketDir && hostFromAuthority) refuse('the host is set in two places (authority and ?host=)');
  let host = socketDir ?? hostFromAuthority;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) host = 'localhost';

  const pathDb = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (pathDb.includes('/')) refuse('database name must be a single path segment');
  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    database: pathDb,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

function connectTimeoutInvalid(url: URL): boolean {
  const v = url.searchParams.get('connect_timeout');
  return v !== null && !/^[0-9]+$/.test(v);
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
  if (!dsn) throw new UnsafeTargetError('refusing target: no DSN. Set INTERLEAVE_DSN or pass --dsn (create a throwaway database with `interleave-pg init-db`; `interleave-pg init-db --compose` prints a compose file for one)');
  const target = parseDsn(dsn);
  checkTargetStatic(target, deps.env ?? process.env);
  const conn = await deps.connect(target);
  try {
    const r = await conn.query(`SELECT to_regclass('public.interleave_marker') IS NOT NULL AS interleave_marker_ok`);
    if (!r.rows[0] || Object.values(r.rows[0])[0] !== true) {
      throw new UnsafeTargetError('refusing target: marker table interleave_marker not found. Create the database with `interleave-pg init-db`');
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

/**
 * Checks a pg Client's EFFECTIVE endpoint (host/port/database after pg resolved config and
 * PGHOST/PGPORT/PGDATABASE fallbacks) and its transport. Runs before a socket is opened.
 */
export function assertClientEndpoint(target: Target, client: any, netModule: typeof import('node:net')): void {
  checkClientParams(target, { host: client.host, port: client.port, database: client.database });
  const conn = client.connection;
  const s = conn?.stream;
  const pristine =
    conn?.constructor?.name === 'Connection' &&
    s instanceof netModule.Socket &&
    Object.getPrototypeOf(s) === netModule.Socket.prototype &&
    !Object.prototype.hasOwnProperty.call(s, 'connect') &&
    s.connect === netModule.Socket.prototype.connect &&
    s.connecting === false &&
    s.destroyed === false &&
    !s.remoteAddress;
  if (!pristine) {
    throw new UnsafeTargetError('UnsafeTargetError: client uses a custom stream/connection, which could carry traffic somewhere other than the checked endpoint');
  }
}
