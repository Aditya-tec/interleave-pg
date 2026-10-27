import { describe, it, expect } from 'vitest';
import { assertSafeTarget, parseDsn, checkClientParams, redactDsn, UnsafeTargetError } from '../src/guard.js';

type Q = { sql: string }[];
function fakeConnect(queries: Q, markerExists = true) {
  let connects = 0;
  const connect = async () => {
    connects++;
    return {
      query: async (sql: string) => { queries.push({ sql }); return { rows: [{ ok: markerExists }] }; },
      end: async () => {},
    };
  };
  return { connect, count: () => connects };
}
const GOOD = 'postgres://postgres:pw@127.0.0.1:5433/raceproof_dev';

describe('S1 target guard', () => {
  const bad: [string, string, Record<string, string | undefined>?][] = [
    ['remote host', 'postgres://u:p@db.example.com:5432/raceproof_dev'],
    ['remote IP', 'postgres://u:p@10.0.0.5:5432/raceproof_dev'],
    ['db name without prefix', 'postgres://u:p@localhost:5433/production'],
    ['db name prefix not anchored', 'postgres://u:p@localhost:5433/my_raceproof_x'],
    ['no db name', 'postgres://u:p@localhost:5433'],
    ['unparseable', 'not a dsn'],
    ['production env', GOOD, { NODE_ENV: 'production' }],
  ];
  for (const [name, dsn, env] of bad) {
    it(`refuses ${name} and sends no query`, async () => {
      const queries: Q = [];
      const f = fakeConnect(queries);
      await expect(assertSafeTarget(dsn, { env: env ?? {}, connect: f.connect })).rejects.toBeInstanceOf(UnsafeTargetError);
      expect(f.count()).toBe(0);
      expect(queries).toEqual([]);
    });
  }
  it('refuses a missing marker table (only the catalog probe is sent)', async () => {
    const queries: Q = [];
    const f = fakeConnect(queries, false);
    await expect(assertSafeTarget(GOOD, { env: {}, connect: f.connect })).rejects.toBeInstanceOf(UnsafeTargetError);
    expect(queries.length).toBe(1);
    expect(queries[0]!.sql).toMatch(/^SELECT .*raceproof_marker/i);
  });
  it('refuses when no DSN is given', async () => {
    await expect(assertSafeTarget(undefined, { env: {}, connect: fakeConnect([]).connect })).rejects.toBeInstanceOf(UnsafeTargetError);
  });
  it('accepts loopback hosts and a unix socket', async () => {
    for (const dsn of [GOOD, 'postgres://u@localhost/raceproof_a', 'postgres://u@[::1]:5433/raceproof_a', 'postgres:///raceproof_a?host=/var/run/postgresql', 'postgres://u@%2Fvar%2Frun%2Fpostgresql/raceproof_a']) {
      const t = await assertSafeTarget(dsn, { env: {}, connect: fakeConnect([]).connect });
      expect(t.database).toMatch(/^raceproof_/);
    }
  });
});

describe('S2 client check', () => {
  const target = parseDsn(GOOD);
  it('accepts matching client (loopback aliases equal)', () => {
    expect(() => checkClientParams(target, { host: 'localhost', port: 5433, database: 'raceproof_dev' })).not.toThrow();
  });
  it('rejects other db, port, or host', () => {
    expect(() => checkClientParams(target, { host: '127.0.0.1', port: 5433, database: 'other' })).toThrow(UnsafeTargetError);
    expect(() => checkClientParams(target, { host: '127.0.0.1', port: 5432, database: 'raceproof_dev' })).toThrow(UnsafeTargetError);
    expect(() => checkClientParams(target, { host: 'db.example.com', port: 5433, database: 'raceproof_dev' })).toThrow(UnsafeTargetError);
  });
});

describe('redactDsn', () => {
  it('hides passwords', () => {
    expect(redactDsn('postgres://user:secret@host:5/db')).toBe('postgres://user:***@host:5/db');
    expect(redactDsn('garbage')).toBe('garbage');
  });
});
