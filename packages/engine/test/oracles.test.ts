import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { hashSnapshot, isSerializable, normalizeResult, outcomeKey, permutations, retriableAborts, takeSnapshot } from '../src/oracles.js';
import { testDsn } from './helpers.js';

describe('outcome normalization', () => {
  it('uses the SQLSTATE for database errors and the message for application errors', () => {
    expect(normalizeResult({ actor: 'A', status: 'rejected', error: { code: '40001', message: 'could not serialize' } })).toBe('db:40001');
    expect(normalizeResult({ actor: 'A', status: 'rejected', error: { message: 'sold out' } })).toBe('err:sold out');
    expect(normalizeResult({ actor: 'A', status: 'rejected', error: { code: 'ECONNRESET', message: 'x' } })).toBe('err:x');
  });
  it('stable-stringifies fulfilled values (key order does not matter)', () => {
    const a = normalizeResult({ actor: 'A', status: 'fulfilled', value: { x: 1, y: [1, { b: 2, a: 1 }] } });
    const b = normalizeResult({ actor: 'A', status: 'fulfilled', value: { y: [1, { a: 1, b: 2 }], x: 1 } });
    expect(a).toBe(b);
  });
  it('permutations of up to 4 actors', () => {
    expect(permutations(['A', 'B']).map((p) => p.join(''))).toEqual(['AB', 'BA']);
    expect(permutations(['A', 'B', 'C', 'D']).length).toBe(24);
  });
});

describe('serial-equivalence decision', () => {
  const out = (snapshot: string, results: Record<string, string>) => ({ snapshot, results });
  const ref = (sets: Record<string, string[]>) => (subset: string[]) => new Set(sets[subset.join('')] ?? []);
  it('accepts an outcome that equals some serial outcome and rejects one that does not', () => {
    const serial = out('S120', { A: 'ok', B: 'ok' });
    const sets = { AB: [outcomeKey(serial, ['A', 'B'])] };
    expect(isSerializable(serial, ref(sets))).toBe(true);
    expect(isSerializable(out('S110', { A: 'ok', B: 'ok' }), ref(sets))).toBe(false);
  });
  it('retriable aborts (40001, 40P01) are compared against serial runs of the remaining actors', () => {
    const aborted = out('S100+B', { A: 'db:40001', B: 'ok' });
    expect(retriableAborts(aborted.results)).toEqual(['A']);
    const sets = { B: [outcomeKey(out('S100+B', { B: 'ok' }), ['B'])] };
    expect(isSerializable(aborted, ref(sets))).toBe(true);
    expect(isSerializable(out('S100+X', { A: 'db:40001', B: 'ok' }), ref(sets))).toBe(false);
  });
  it('a non-retriable error is part of the outcome', () => {
    const o = out('S', { A: 'ok', B: 'err:sold out' });
    expect(retriableAborts(o.results)).toEqual([]);
    expect(isSerializable(o, ref({ AB: [outcomeKey(o, ['A', 'B'])] }))).toBe(true);
  });
});

describe('snapshots', () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client(await testDsn());
    await client.connect();
    await client.query(`
      DROP TABLE IF EXISTS snap_a; DROP TABLE IF EXISTS snap_nopk; DROP TABLE IF EXISTS "snap""hostile";
      CREATE TABLE snap_a (id serial PRIMARY KEY, name text, created_at timestamptz DEFAULT now());
      CREATE TABLE snap_nopk (v text);
      CREATE TABLE "snap""hostile" (k int PRIMARY KEY, v text);`);
  });
  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS snap_a; DROP TABLE IF EXISTS snap_nopk; DROP TABLE IF EXISTS "snap""hostile"`);
    await client.end();
  });
  const snap = async (tables: string[], ignore: string[] = []) => hashSnapshot(await takeSnapshot(client, tables, ignore));

  it('ignores identity/serial columns and listed columns, so insertion order and timestamps do not matter', async () => {
    await client.query('TRUNCATE snap_a RESTART IDENTITY');
    await client.query("INSERT INTO snap_a (name) VALUES ('x'), ('y')");
    const h1 = await snap(['snap_a'], ['created_at']);
    await client.query('TRUNCATE snap_a RESTART IDENTITY');
    await client.query("INSERT INTO snap_a (name) VALUES ('y')");
    await new Promise((r) => setTimeout(r, 5));
    await client.query("INSERT INTO snap_a (name) VALUES ('x')");
    expect(await snap(['snap_a'], ['created_at'])).toBe(h1);
  });
  it('detects a real difference in data', async () => {
    await client.query('TRUNCATE snap_a RESTART IDENTITY');
    await client.query("INSERT INTO snap_a (name) VALUES ('x')");
    const h1 = await snap(['snap_a'], ['created_at']);
    await client.query("INSERT INTO snap_a (name) VALUES ('x')");
    expect(await snap(['snap_a'], ['created_at'])).not.toBe(h1);
  });
  it('orders tables without a primary key by row content', async () => {
    await client.query("TRUNCATE snap_nopk; INSERT INTO snap_nopk VALUES ('b'), ('a')");
    const h1 = await snap(['snap_nopk']);
    await client.query("TRUNCATE snap_nopk; INSERT INTO snap_nopk VALUES ('a'), ('b')");
    expect(await snap(['snap_nopk'])).toBe(h1);
  });
  it('quotes hostile table names safely (S9)', async () => {
    await client.query('TRUNCATE "snap""hostile"');
    await client.query("INSERT INTO \"snap\"\"hostile\" VALUES (1, 'v')");
    expect(typeof (await snap(['snap"hostile']))).toBe('string');
    await expect(snap(['snap_a"; DROP TABLE snap_a; --'])).rejects.toThrow();
    expect((await client.query("SELECT to_regclass('snap_a') IS NOT NULL AS ok")).rows[0].ok).toBe(true);
  });
});
