import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDsn } from './helpers.js';
// @ts-ignore the metrics script lives outside the package
import { percentile, summarize } from '../../../eval/engine-metrics.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const row = (o: Record<string, unknown>) => ({ id: 'x', expect: 'buggy', scope: 'in', outcome: 'hit', explored: 5, runtimeMs: 1000, confirmed: [], unconfirmed: [], ...o });

describe('metrics definitions (docs/METRICS.md)', () => {
  it('percentiles use the nearest-rank method', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
  it('a mismatch is not a hit, and it counts against recall', () => {
    const s = summarize('t', [row({ outcome: 'hit' }), row({ outcome: 'mismatch' }), row({ outcome: 'miss' }), row({ outcome: 'hit' })]);
    expect(s.hits).toBe(2);
    expect(s.mismatches).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.recall).toBe(0.5);
    expect(s.gates['recall >= 90%']).toBe(false);
  });
  it('out-of-scope scenarios are excluded from every rate and from the runtime percentiles', () => {
    const s = summarize('t', [
      row({ outcome: 'hit', runtimeMs: 1000 }),
      row({ scope: 'out', expect: 'unsupported', outcome: 'limit-ok', runtimeMs: 999999, confirmed: ['VIOLATION:x'] }),
    ]);
    expect(s.inScopeBuggy).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.runtimeP95Ms).toBe(1000);
    expect(s.confirmedFindings).toBe(0);
  });
  it('only a confirmed finding on a safe scenario is a false positive; an unconfirmed one fails the confirmation gate instead', () => {
    const s = summarize('t', [
      row({ expect: 'safe', outcome: 'clean' }),
      row({ expect: 'safe', outcome: 'false-positive', confirmed: ['ANOMALY:serial-equivalence'] }),
      row({ expect: 'safe', outcome: 'clean', unconfirmed: ['VIOLATION:flaky'] }),
      row({ expect: 'safe', outcome: 'error' }),
    ]);
    expect(s.inScopeSafe).toBe(4);
    expect(s.falsePositives).toBe(1);
    expect(s.safeErrors).toBe(1);
    expect(s.fpRate).toBe(0.25);
    expect(s.confirmationRate).toBe(0.5);
    expect(s.gates['false positives == 0']).toBe(false);
    expect(s.gates['confirmation 100%']).toBe(false);
  });
  it('gates are judged on the numbers, never loosened', () => {
    const ok = summarize('t', [row({ outcome: 'hit', runtimeMs: 10_000 }), row({ expect: 'safe', outcome: 'clean', runtimeMs: 10_000 })]);
    expect(ok.gates['runtime median <= 10 s']).toBe(true);
    const slow = summarize('t', [row({ outcome: 'hit', runtimeMs: 10_001 })]);
    expect(slow.gates['runtime median <= 10 s']).toBe(false);
    expect(slow.gates['runtime p95 <= 60 s']).toBe(true);
  });
});

describe('heldout-human is picked up with no code change', () => {
  const dir = join(root, 'corpus', 'heldout-human', 'zz-dummy-scenario');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('a dummy scenario dropped into the directory is discovered, run and reported', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'schema.sql'), 'DROP TABLE IF EXISTS dummy CASCADE;\nCREATE TABLE dummy (id int PRIMARY KEY, n int NOT NULL);\n');
    writeFileSync(
      join(dir, 'scenario.mjs'),
      `import { makePool } from '../../_lib/lib.mjs';
export default {
  name: 'dummy lost update',
  tables: ['dummy'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO dummy VALUES (1, 0)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async () => {
      const r = await pool.query('SELECT n FROM dummy WHERE id = 1');
      await pool.query('UPDATE dummy SET n = $1 WHERE id = 1', [r.rows[0].n + 1]);
    };
  },
  actors: { A: (bump) => bump(), B: (bump) => bump() },
  invariants: [{ name: 'both increments counted', sql: 'SELECT n = 2 AS ok FROM dummy WHERE id = 1' }],
};
`,
    );
    writeFileSync(join(dir, 'expected.json'), JSON.stringify({ id: 'zz-dummy-scenario', expect: 'buggy', scope: 'in', class: 'lost-update', driver: 'pg', invariant: 'both increments counted' }));
    const r = spawnSync(process.execPath, [join(root, 'eval', 'engine-metrics.js'), '--set', 'heldout-human'], {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, INTERLEAVE_DSN: await testDsn(), NODE_ENV: 'test' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\| zz-dummy-scenario \| buggy .*\| hit \|/);
    expect(r.stdout).toMatch(/Set `heldout-human`: 1 scenarios/);
  });
});
