import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import pg from 'pg';
import { createSession, type Session } from '../src/runner.js';
import { UnsafeTargetError, parseDsn } from '../src/guard.js';
import { adminDsn, testDsn } from './helpers.js';
import { countingListener, countingProxy, type Listener } from './net-helpers.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let dsn: string;
let session: Session | undefined;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => { dsn = await testDsn(); });
afterEach(async () => {
  await session?.close();
  session = undefined;
  while (closers.length) await closers.pop()!();
});

const withDb = (u: string, db: string) => { const x = new URL(u); x.pathname = '/' + db; return x.toString(); };
const withHostPort = (u: string, host: string, port: number) => { const x = new URL(u); x.hostname = host; x.port = String(port); return x.toString(); };

/** A scenario whose app pool is created by `make` and warmed up inside setup (so a connect is attempted at once). */
function scenarioWith(make: () => any) {
  return {
    name: 'hostile pool',
    tables: ['accounts'],
    schema: 'sql/accounts.sql',
    setup: async () => {
      const pool = make();
      await pool.query('SELECT 1');
      return { pool };
    },
    actors: { A: (c: any) => c.pool.query('SELECT 1'), B: (c: any) => c.pool.query('SELECT 2') },
  };
}
async function expectRefused(scenario: any, target: string) {
  const err = await createSession(scenario, { dsn: target, scenarioDir: fixtures }).then(
    (s) => { session = s; return s.run(['A', 'B']).then(() => undefined, (e: unknown) => e); },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(UnsafeTargetError);
}

describe('nothing leaves the machine: hostile host and port', () => {
  it('hostile port on loopback: a counting listener accepts zero connections', async () => {
    const hostile = await countingListener('127.0.0.1');
    closers.push(hostile.close);
    const bad = withHostPort(dsn, '127.0.0.1', hostile.port);
    await expectRefused(scenarioWith(() => new pg.Pool({ connectionString: bad, max: 2 })), dsn);
    expect(hostile.connections()).toBe(0);
  });
  it('hostile host (127.0.0.2, same port as the target): a counting listener accepts zero connections', async (ctx) => {
    const targetPort = Number(parseDsn(dsn).port);
    let hostile: Listener;
    try {
      hostile = await countingListener('127.0.0.2', targetPort);
    } catch (e: any) {
      if (e.code === 'EADDRNOTAVAIL' || e.code === 'EADDRINUSE') return ctx.skip(`cannot bind 127.0.0.2:${targetPort} here (${e.code})`);
      throw e;
    }
    closers.push(hostile.close);
    const bad = withHostPort(dsn, '127.0.0.2', targetPort);
    await expectRefused(scenarioWith(() => new pg.Pool({ connectionString: bad, max: 2 })), dsn);
    expect(hostile.connections()).toBe(0);
  });
  it('control: the same listener does see a connection when nothing refuses it (the method observes traffic)', async () => {
    const l = await countingListener('127.0.0.1');
    closers.push(l.close);
    const c = new net.Socket();
    await new Promise<void>((r) => c.connect(l.port, '127.0.0.1', () => r()));
    c.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(l.connections()).toBe(1);
  });
});

describe('nothing leaves the machine: a different database on the same local Postgres', () => {
  it('the server side (a counting proxy) never receives a StartupMessage for that database', async () => {
    const a = parseDsn(adminDsn());
    const proxy = await countingProxy({ host: a.host, port: a.port });
    closers.push(proxy.close);
    const viaProxy = withHostPort(dsn, '127.0.0.1', proxy.port);
    const other = withDb(viaProxy, 'postgres');
    await expectRefused(scenarioWith(() => new pg.Pool({ connectionString: other, max: 2 })), viaProxy);
    await new Promise((r) => setTimeout(r, 100));
    expect(proxy.startupDatabases()).not.toContain('postgres');
    // the proxy does see legitimate traffic: the guard and the control connection asked for the target database
    expect(proxy.startupDatabases()).toContain('interleave_test');
  });
  it('control: the proxy does record a direct connection to another database', async () => {
    const a = parseDsn(adminDsn());
    const proxy = await countingProxy({ host: a.host, port: a.port });
    closers.push(proxy.close);
    const c = new pg.Client(withDb(withHostPort(dsn, '127.0.0.1', proxy.port), 'postgres'));
    await c.connect();
    await c.end();
    expect(proxy.startupDatabases()).toContain('postgres');
  });
});

describe('effective settings (PGHOST / PGPORT / PGDATABASE fallbacks), not the DSN string', () => {
  const saved: Record<string, string | undefined> = {};
  const setEnv = (kv: Record<string, string>) => { for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; } };
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  it('pool without host/port, PGHOST/PGPORT point at a hostile listener: refused, zero connections', async () => {
    const hostile = await countingListener('127.0.0.1');
    closers.push(hostile.close);
    setEnv({ PGHOST: '127.0.0.1', PGPORT: String(hostile.port), PGDATABASE: 'interleave_test' });
    await expectRefused(scenarioWith(() => new pg.Pool({ user: 'postgres', password: 'x', max: 2 })), dsn);
    expect(hostile.connections()).toBe(0);
  });
  it('pool without a database, PGDATABASE points at another database: refused, proxy never sees it', async () => {
    const a = parseDsn(adminDsn());
    const proxy = await countingProxy({ host: a.host, port: a.port });
    closers.push(proxy.close);
    const viaProxy = withHostPort(dsn, '127.0.0.1', proxy.port);
    setEnv({ PGDATABASE: 'postgres' });
    await expectRefused(
      scenarioWith(() => new pg.Pool({ host: '127.0.0.1', port: proxy.port, user: 'postgres', password: 'interleave-pg', max: 2 })),
      viaProxy,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(proxy.startupDatabases()).not.toContain('postgres');
  });
});

describe('custom stream option', () => {
  it('Pool with a stream factory is refused', async () => {
    await expectRefused(scenarioWith(() => new pg.Pool({ connectionString: dsn, max: 2, stream: () => new PassThrough() } as any)), dsn);
  });
  it('Client with a net.Socket subclass is refused', async () => {
    class Sneaky extends net.Socket {}
    const scenario = {
      name: 'custom stream',
      tables: ['accounts'],
      schema: 'sql/accounts.sql',
      setup: async () => {
        const client = new pg.Client({ connectionString: dsn, stream: new Sneaky() } as any);
        await client.connect();
        return { client };
      },
      actors: { A: (c: any) => c.client.query('SELECT 1'), B: (c: any) => c.client.query('SELECT 2') },
    };
    await expectRefused(scenario, dsn);
  });
  it('Client with a net.Socket whose connect was replaced on the instance is refused', async () => {
    const s = new net.Socket();
    (s as any).connect = function () { return this; };
    const scenario = {
      name: 'patched socket',
      tables: ['accounts'],
      schema: 'sql/accounts.sql',
      setup: async () => {
        const client = new pg.Client({ connectionString: dsn, stream: s } as any);
        await client.connect();
        return { client };
      },
      actors: { A: (c: any) => c.client.query('SELECT 1'), B: (c: any) => c.client.query('SELECT 2') },
    };
    await expectRefused(scenario, dsn);
  });
});
