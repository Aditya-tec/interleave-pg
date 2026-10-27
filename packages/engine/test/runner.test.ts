import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createSession, type Session } from '../src/runner.js';
import { NoStatementsError, StallError } from '../src/errors.js';
import { UnsafeTargetError } from '../src/guard.js';
import { testDsn } from './helpers.js';
// @ts-ignore plain .mjs fixtures
import { makeScenario } from './fixtures/lost-update.mjs';
// @ts-ignore
import blocking from './fixtures/blocking.mjs';
// @ts-ignore
import deadlock from './fixtures/deadlock.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
let dsn: string;
let session: Session | undefined;
beforeAll(async () => { dsn = await testDsn(); });
afterEach(async () => { await session?.close(); session = undefined; });

const violated = (r: { violations: { invariant: string }[] }) => r.violations.map((v) => v.invariant);
const sch = (s: string) => s.split('');

describe('AC1.1/AC1.2/AC1.7 lost update across driver styles', () => {
  const styles: [string, string, string][] = [
    ['pool', 'ABAB', 'AABB'],
    ['client', 'ABABABAB', 'AAAABBBB'],
    ['callback', 'ABAB', 'AABB'],
    ['knex', 'ABAB', 'AABB'],
  ];
  for (const [style, bad, serial] of styles) {
    it(`${style}: interleaved schedule violates, serial schedule is clean`, async () => {
      session = await createSession(makeScenario(style), { dsn, scenarioDir: fixtures });
      const r1 = await session.run(sch(bad));
      expect(r1.steps.map((s) => s.actor)).toEqual(sch(bad));
      expect(violated(r1)).toEqual(['both deposits applied']);
      const r2 = await session.run(sch(serial));
      expect(r2.steps.map((s) => s.actor)).toEqual(sch(serial));
      expect(r2.violations).toEqual([]);
    });
  }
  it('AC1.1: forced A,B,A,B violates 100/100 repeated runs', async () => {
    session = await createSession(makeScenario('pool'), { dsn, scenarioDir: fixtures });
    let hits = 0;
    for (let i = 0; i < 100; i++) {
      const r = await session.run(['A', 'B', 'A', 'B']);
      if (violated(r).includes('both deposits applied')) hits++;
    }
    expect(hits).toBe(100);
  });
});

describe('AC1.3 blocking', () => {
  it('completes without hanging and records the blocked step', async () => {
    session = await createSession(blocking, { dsn, scenarioDir: fixtures });
    const t0 = Date.now();
    const r = await session.run(sch('AABBAABB'));
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.violations).toEqual([]);
    expect(r.results.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
    const blocked = r.steps.filter((s) => s.blockedBy && s.blockedBy.length);
    expect(blocked.length).toBe(1);
    expect(blocked[0]!.actor).toBe('B');
    expect(blocked[0]!.sql).toMatch(/FOR UPDATE/);
    expect(blocked[0]!.blockedBy).toEqual(['A']);
  });
});

describe('AC1.4 deadlock', () => {
  it('ends with a 40P01 outcome inside 2s', async () => {
    session = await createSession(deadlock, { dsn, scenarioDir: fixtures });
    const t0 = Date.now();
    const r = await session.run(sch('AABBAB'));
    expect(Date.now() - t0).toBeLessThan(2000);
    const codes = r.results.map((x) => x.error?.code).filter(Boolean);
    expect(codes).toEqual(['40P01']);
    expect(r.steps.some((s) => s.errorCode === '40P01')).toBe(true);
  });
});

describe('AC1.6 zero statements intercepted', () => {
  it('fails with a clear error when the app uses a different pg copy', async () => {
    const tmp = join(here, '.tmp', 'pgcopy');
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(join(tmp, 'node_modules'), { recursive: true });
    const pgDir = dirname(dirname(fileURLToPath(import.meta.resolve('pg'))));
    cpSync(pgDir, join(tmp, 'node_modules', 'pg'), { recursive: true });
    writeFileSync(
      join(tmp, 'app.mjs'),
      `import pg from 'pg'; export const run = async (dsn) => { const c = new pg.Client(dsn); await c.connect(); await c.query('SELECT 1'); await c.end(); };`,
    );
    const scenario = {
      name: 'pg mismatch',
      tables: ['accounts'],
      schema: 'sql/accounts.sql',
      setup: async ({ dsn }: { dsn: string }) => ({ dsn, app: await import(join(tmp, 'app.mjs')) }),
      actors: { A: (c: any) => c.app.run(c.dsn), B: (c: any) => c.app.run(c.dsn) },
    };
    session = await createSession(scenario as any, { dsn, scenarioDir: fixtures });
    const err = await session.run(['A', 'B']).catch((e) => e);
    expect(err).toBeInstanceOf(NoStatementsError);
    expect(String(err.message)).toMatch(/no statements intercepted: pg resolution mismatch\?/);
  });
});

describe('S2 client target check', () => {
  it('aborts with UnsafeTargetError before any app query is sent to another database', async () => {
    const seen: string[] = [];
    const proto = (pg as any).Client.prototype;
    const original = proto.query;
    proto.query = function (this: any, ...a: any[]) {
      seen.push(`${this.database}:${typeof a[0] === 'string' ? a[0] : a[0]?.text}`);
      return original.apply(this, a);
    };
    try {
      const other = dsn.replace(/\/interleave_test$/, '/postgres');
      const scenario = {
        name: 'wrong db',
        tables: ['accounts'],
        schema: 'sql/accounts.sql',
        setup: async () => ({ pool: new pg.Pool({ connectionString: other, max: 2 }) }),
        actors: { A: (c: any) => c.pool.query('SELECT 42 AS marker_wrong_db'), B: (c: any) => c.pool.query('SELECT 1') },
      };
      session = await createSession(scenario as any, { dsn, scenarioDir: fixtures });
      await expect(session.run(['A', 'B'])).rejects.toBeInstanceOf(UnsafeTargetError);
      expect(seen.filter((s) => s.startsWith('postgres:'))).toEqual([]);
    } finally {
      proto.query = original;
    }
  });
});

describe('edge cases', () => {
  it('rejects parallel statements inside one actor', async () => {
    const scenario = {
      name: 'parallel',
      tables: ['accounts'],
      schema: 'sql/accounts.sql',
      setup: async ({ dsn }: { dsn: string }) => {
        const pool = new pg.Pool({ connectionString: dsn, max: 4 });
        await Promise.all([pool.query('SELECT pg_sleep(0.1)'), pool.query('SELECT pg_sleep(0.1)')]); // two idle clients
        return { pool };
      },
      actors: {
        A: (c: any) => Promise.all([c.pool.query('SELECT 1'), c.pool.query('SELECT 2')]),
        B: (c: any) => c.pool.query('SELECT 3'),
      },
    };
    session = await createSession(scenario as any, { dsn, scenarioDir: fixtures });
    const r = await session.run(['A', 'B']);
    expect(r.results[0]!.status).toBe('rejected');
    expect(r.results[0]!.error!.message).toMatch(/parallel statements within one actor/);
  });
  it('reports a stall when an actor waits outside the database', async () => {
    const scenario = {
      name: 'stall',
      tables: ['accounts'],
      schema: 'sql/accounts.sql',
      setup: async ({ dsn }: { dsn: string }) => ({ pool: new pg.Pool({ connectionString: dsn, max: 4 }) }),
      actors: {
        A: async (c: any) => { await new Promise((r) => setTimeout(r, 5000)); await c.pool.query('SELECT 1'); },
        B: (c: any) => c.pool.query('SELECT 3'),
      },
    };
    session = await createSession(scenario as any, { dsn, scenarioDir: fixtures, stallTimeoutMs: 300 });
    const err = await session.run(['A', 'B']).catch((e) => e);
    expect(err).toBeInstanceOf(StallError);
    expect(String(err.message)).toMatch(/actor "A" stalled outside the database; stub external calls in the scenario/);
  });
  it('rejects an unknown actor in the schedule', async () => {
    session = await createSession(makeScenario('pool'), { dsn, scenarioDir: fixtures });
    await expect(session.run(['A', 'Z'])).rejects.toThrow(/unknown actor "Z"/);
  });
});
