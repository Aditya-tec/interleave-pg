import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertSafeTarget, UnsafeTargetError } from '../src/guard.js';
import { createSession } from '../src/runner.js';
import { testDsn } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');

// Each of these must be refused: exit 3 and no query sent.
const HOSTILE: [string, string][] = [
  ['?host= pointing at a remote host', 'postgres://u@localhost/raceproof_a?host=evil.example.com'],
  ['?hostaddr= pointing at a remote IP', 'postgres://u@localhost/raceproof_a?hostaddr=10.0.0.5'],
  ['multi-host DSN where one host is non-local', 'postgres://u@localhost:5433,evil.example.com:5433/raceproof_a'],
  ['multi-host DSN, non-local host first', 'postgres://u@evil.example.com:5433,localhost:5433/raceproof_a'],
  ['?dbname= not matching the prefix (path is empty)', 'postgres://u@localhost/?dbname=production'],
  ['?dbname= not matching the prefix (path looks fine)', 'postgres://u@localhost/raceproof_a?dbname=production'],
];

describe('S1 hardening: hostile DSNs are refused with nothing sent', () => {
  for (const [name, dsn] of HOSTILE) {
    it(`refuses ${name}`, async () => {
      let connects = 0;
      const queries: string[] = [];
      const connect = async () => {
        connects++;
        return { query: async (s: string) => { queries.push(s); return { rows: [{ ok: true }] }; }, end: async () => {} };
      };
      await expect(assertSafeTarget(dsn, { env: {}, connect })).rejects.toBeInstanceOf(UnsafeTargetError);
      expect(connects).toBe(0);
      expect(queries).toEqual([]);
    });
  }
});

describe('S1 hardening through the CLI (exit 3)', () => {
  beforeAll(async () => { await testDsn(); });
  for (const [name, dsn] of HOSTILE) {
    it(`exit 3 for ${name}`, () => {
      const r = spawnSync(process.execPath, [join(pkg, 'dist', 'cli.js'), 'doctor'], {
        encoding: 'utf8', cwd: pkg, env: { ...process.env, RACEPROOF_DSN: dsn, NODE_ENV: 'test' },
      });
      expect(r.status).toBe(3);
    });
  }
});

describe('S2 blocks a pool created with such a DSN', () => {
  it('?host=evil.example.com: client host differs from the target, refused before any query', async () => {
    const dsn = await testDsn();
    const seen: string[] = [];
    const proto = (pg as any).Client.prototype;
    const original = proto.query;
    proto.query = function (this: any, ...a: any[]) { seen.push(`${this.host}:${typeof a[0] === 'string' ? a[0] : a[0]?.text}`); return original.apply(this, a); };
    let session: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      const evil = dsn + '?host=evil.example.com';
      const scenario = {
        name: 'evil host',
        tables: ['accounts'],
        schema: 'sql/accounts.sql',
        setup: async () => ({ pool: new pg.Pool({ connectionString: evil, max: 2 }) }),
        actors: { A: (c: any) => c.pool.query('SELECT 1'), B: (c: any) => c.pool.query('SELECT 2') },
      };
      session = await createSession(scenario as any, { dsn, scenarioDir: join(here, 'fixtures') });
      await expect(session.run(['A', 'B'])).rejects.toBeInstanceOf(UnsafeTargetError);
      expect(seen.filter((s) => s.startsWith('evil.example.com'))).toEqual([]);
    } finally {
      proto.query = original;
      await session?.close();
    }
  });
  it('?port= override: client port differs from the target, refused before any query', async () => {
    const dsn = await testDsn();
    let session: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      const other = dsn + '?port=5999';
      const scenario = {
        name: 'port override',
        tables: ['accounts'],
        schema: 'sql/accounts.sql',
        setup: async () => ({ pool: new pg.Pool({ connectionString: other, max: 2 }) }),
        actors: { A: (c: any) => c.pool.query('SELECT 1'), B: (c: any) => c.pool.query('SELECT 2') },
      };
      session = await createSession(scenario as any, { dsn, scenarioDir: join(here, 'fixtures') });
      await expect(session.run(['A', 'B'])).rejects.toBeInstanceOf(UnsafeTargetError);
    } finally {
      await session?.close();
    }
  });
});
