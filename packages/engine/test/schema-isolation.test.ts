import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { serialChooser } from '../src/choosers.js';
import { ScenarioError } from '../src/errors.js';
import { loadScenario } from '../src/loader.js';
import { createSession, type Session } from '../src/runner.js';
import { validateScenario } from '../src/scenario.js';
import { testDsn } from './helpers.js';
import { adminDsn } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
let dsn: string;
let session: Session | undefined;
beforeAll(async () => { dsn = await testDsn(); });
afterEach(async () => { await session?.close(); session = undefined; });

const base = (over: Record<string, unknown>) => ({
  name: 'iso',
  tables: ['iso_t'],
  actors: { A: () => 1, B: () => 2 },
  setup: async ({ dsn }: { dsn: string }) => {
    const pool = new pg.Pool({ connectionString: dsn, max: 2 });
    return { pool };
  },
  ...over,
});
const withSchema = async (tmpSql: string, sql: string) => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const d = join(here, '.tmp', 'iso');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, tmpSql), sql);
  return join(d, tmpSql);
};
const plainQuery = async (sql: string, values?: unknown[]) => {
  const c = new pg.Client(dsn);
  await c.connect();
  try { return (await c.query(sql, values)).rows; } finally { await c.end(); }
};
const touch = (c: any) => ({
  A: async ({ pool }: any) => { await pool.query('SELECT 1'); },
  B: async ({ pool }: any) => { await pool.query('SELECT 2'); },
  ...c,
});

describe('scenarios that bring their own schema start from a clean slate', () => {
  it('a second scenario with the same table name and other columns works with CREATE TABLE IF NOT EXISTS', async () => {
    const one = await withSchema('one.sql', 'CREATE TABLE IF NOT EXISTS iso_t (id int PRIMARY KEY, a text);');
    const two = await withSchema('two.sql', 'CREATE TABLE IF NOT EXISTS iso_t (id int PRIMARY KEY, b int NOT NULL);');
    session = await createSession(base({ schema: one, seed: async (db: any) => { await db.query("INSERT INTO iso_t VALUES (1, 'x')"); }, actors: touch({}) }) as any, { dsn, scenarioDir: here });
    await session.close();
    session = await createSession(base({ schema: two, seed: async (db: any) => { await db.query('INSERT INTO iso_t VALUES (1, 7)'); }, actors: touch({}) }) as any, { dsn, scenarioDir: here });
    const cols = await plainQuery("SELECT column_name FROM information_schema.columns WHERE table_name = 'iso_t' ORDER BY ordinal_position");
    expect(cols.map((r) => r.column_name)).toEqual(['id', 'b']);
  });
  it('the five externally authored schemas exactly as supplied (IF NOT EXISTS, no DROP) run back to back after clashing dev scenarios', async () => {
    const order = ['lost-update-pg-atomic', 'webhook-credit-before-dedupe', 'oversell-pg-atomic', 'seat-hold-atomic-update', 'lost-update-pg-rmw', 'wallet-optimistic-version', 'leave-balance-overdraw', 'retried-job-double-send'];
    for (const id of order) {
      const human = !['lost-update-pg-atomic', 'oversell-pg-atomic', 'lost-update-pg-rmw'].includes(id);
      const dir = human ? join(root, 'corpus', 'heldout-human', id) : join(root, 'corpus', 'dev', id);
      const { scenario, dir: sdir } = await loadScenario(join(dir, 'scenario.mjs'));
      const sc = human ? { ...scenario, schema: join(here, 'fixtures', 'as-supplied', `${id}.sql`) } : scenario;
      const s = await createSession(sc, { dsn, scenarioDir: sdir });
      try {
        const ids = s.actorIds;
        const r = await s.execute({ chooser: serialChooser(ids) });
        expect(r.results.every((x) => x.status === 'fulfilled'), id).toBe(true);
        expect(r.violations, id).toEqual([]);
      } finally {
        await s.close();
      }
    }
  });
  it('warns about tables the schema creates but "tables" does not list', async () => {
    await plainQuery('DROP TABLE IF EXISTS iso_extra'); // an unlisted table is by definition not cleaned by the engine
    const f = await withSchema('extra.sql', 'CREATE TABLE iso_t (id int PRIMARY KEY); CREATE TABLE iso_extra (id int PRIMARY KEY);');
    session = await createSession(base({ schema: f, actors: touch({}) }) as any, { dsn, scenarioDir: here });
    const r = await session.execute({ chooser: serialChooser(['A', 'B']) });
    expect(r.warnings.join(' ')).toMatch(/schema creates table "iso_extra" which is not listed in "tables"/);
    await session.close();
    session = undefined;
    await plainQuery('DROP TABLE IF EXISTS iso_extra');
  });
});

describe('scenarios without a schema (the user\'s migrations built the tables): truncate and reseed, NEVER drop', () => {
  it('keeps the table, its extra column and its index; only the rows are reset', async () => {
    await plainQuery('DROP TABLE IF EXISTS iso_mig');
    await plainQuery('CREATE TABLE iso_mig (id int PRIMARY KEY, n int NOT NULL, extra text DEFAULT \'migrated\')');
    await plainQuery('CREATE INDEX iso_mig_n ON iso_mig (n)');
    await plainQuery('INSERT INTO iso_mig VALUES (99, 99)');
    session = await createSession(base({ tables: ['iso_mig'], seed: async (db: any) => { await db.query('INSERT INTO iso_mig (id, n) VALUES (1, 0)'); }, actors: touch({}) }) as any, { dsn, scenarioDir: here });
    await session.execute({ chooser: serialChooser(['A', 'B']) });
    expect((await plainQuery('SELECT id FROM iso_mig ORDER BY id')).map((r) => r.id)).toEqual([1]);
    expect((await plainQuery("SELECT column_name FROM information_schema.columns WHERE table_name = 'iso_mig' AND column_name = 'extra'")).length).toBe(1);
    expect((await plainQuery("SELECT indexname FROM pg_indexes WHERE indexname = 'iso_mig_n'")).length).toBe(1);
    await session.close();
    session = undefined;
    await plainQuery('DROP TABLE iso_mig');
  });
});

describe('guard refusals for "tables" entries', () => {
  const ok = { name: 'x', actors: { A: () => 1, B: () => 2 } };
  for (const bad of ['interleave_marker', 'INTERLEAVE_MARKER', 'public.interleave_marker', 'pg_catalog.pg_class', 'information_schema.tables', 'other_schema.t', 'a.b.c', 'pg_temp.x', 'pg_class']) {
    it(`refuses "${bad}"`, () => {
      expect(() => validateScenario({ ...ok, tables: [bad] })).toThrow(ScenarioError);
    });
  }
  it('accepts plain and public-qualified names', () => {
    expect(() => validateScenario({ ...ok, tables: ['accounts', 'public.orders', 'Mixed_Case'] })).not.toThrow();
  });
});

void adminDsn;
