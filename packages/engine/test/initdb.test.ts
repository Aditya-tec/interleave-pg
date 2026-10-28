import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { initDb } from '../src/initdb.js';
import { UnsafeTargetError } from '../src/guard.js';
import { adminDsn } from './helpers.js';

const NAME = 'interleave_test_initdb';
describe('init-db', () => {
  afterAll(async () => {
    const c = new pg.Client(adminDsn());
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await c.end();
  });
  it('creates the database, marker table and low deadlock_timeout; is idempotent', async () => {
    const dsn = await initDb({ adminDsn: adminDsn(), name: NAME });
    await initDb({ adminDsn: adminDsn(), name: NAME });
    const c = new pg.Client(dsn);
    await c.connect();
    const m = await c.query(`SELECT to_regclass('public.interleave_marker') IS NOT NULL AS ok`);
    const d = await c.query('SHOW deadlock_timeout');
    await c.end();
    expect(m.rows[0].ok).toBe(true);
    expect(d.rows[0].deadlock_timeout).toBe('300ms');
  });
  it('refuses names without the interleave_ prefix and remote hosts', async () => {
    await expect(initDb({ adminDsn: adminDsn(), name: 'production' })).rejects.toBeInstanceOf(UnsafeTargetError);
    await expect(initDb({ adminDsn: 'postgres://u:p@db.example.com/postgres', name: 'interleave_x' })).rejects.toBeInstanceOf(UnsafeTargetError);
  });
  it('rejects hostile names', async () => {
    await expect(initDb({ adminDsn: adminDsn(), name: 'interleave_x"; DROP DATABASE postgres; --' })).rejects.toThrow();
  });
});

describe('configurable deadlock_timeout', () => {
  const N2 = 'interleave_test_dltimeout';
  afterAll(async () => {
    const c = new pg.Client(adminDsn());
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${N2}`);
    await c.end();
  });
  it('init-db applies a custom value and the default is 300ms', async () => {
    const show = async (dsn: string) => {
      const c = new pg.Client(dsn);
      await c.connect();
      const r = await c.query('SHOW deadlock_timeout');
      await c.end();
      return r.rows[0].deadlock_timeout as string;
    };
    expect(await show(await initDb({ adminDsn: adminDsn(), name: N2, deadlockTimeout: '150ms' }))).toBe('150ms');
    expect(await show(await initDb({ adminDsn: adminDsn(), name: N2 }))).toBe('300ms');
  });
  it('rejects values that are not a bounded duration (no SQL is built from them)', async () => {
    for (const bad of ['abc', '5ms', '11s', "1s'; DROP DATABASE postgres; --", '', '1.5s', '-100ms']) {
      await expect(initDb({ adminDsn: adminDsn(), name: N2, deadlockTimeout: bad })).rejects.toThrow(/deadlock timeout/i);
    }
  });
});
