import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDsn } from './helpers.js';
// @ts-ignore the metrics script lives outside the package
import { judgeLimit, markdown, percentile, summarize } from '../../../eval/engine-metrics.js';

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
    const r = spawnSync(process.execPath, [join(root, 'eval', 'engine-metrics.js'), '--set', 'heldout-human', '--only', 'zz-dummy-scenario'], {
      // --only: a test must never explore the real human scenarios
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, INTERLEAVE_DSN: await testDsn(), NODE_ENV: 'test' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\| zz-dummy-scenario \| buggy .*\| hit \|/);
    expect(r.stdout).toMatch(/Set `heldout-human`: 1 scenarios/);
  });
});

describe('judging honest-limit scenarios (expected.json fields: message, notice, warning, stoppedBy)', () => {
  const rep = (o: Record<string, unknown> = {}) => ({
    violations: [] as any[],
    warnings: [] as string[],
    coverage: { stoppedBy: 'complete', exhaustiveWithinBound: true },
    ...o,
  });
  it('message: must match the error text, and there must be an error', () => {
    expect(judgeLimit({ message: 'cannot see' } as any, undefined, 'NoStatementsError: the tool cannot see this')).toBe(true);
    expect(judgeLimit({ message: 'cannot see' } as any, undefined, 'something else')).toBe(false);
    expect(judgeLimit({ message: 'cannot see' } as any, rep() as any, undefined)).toBe(false);
  });
  it('message: may also match the printed report text when the run produced no error (for example the non-exhaustive wording after a budget stop)', () => {
    expect(judgeLimit({ message: 'exhaustive within bound: no' } as any, rep() as any, undefined, 'Coverage: ..., exhaustive within bound: no, stopped by: schedule-budget')).toBe(true);
    expect(judgeLimit({ message: 'exhaustive within bound: no' } as any, rep() as any, undefined, 'Coverage: ..., exhaustive within bound: yes')).toBe(false);
    expect(judgeLimit({ message: 'x' } as any, undefined, undefined, undefined)).toBe(false);
  });
  it('notice: a CONFIRMED finding must carry it', () => {
    const f = (status: string, notice: string) => rep({ violations: [{ status, notice, kind: 'VIOLATION', invariant: 'x' }] }) as any;
    expect(judgeLimit({ notice: 'N' } as any, f('CONFIRMED', 'N'), undefined)).toBe(true);
    expect(judgeLimit({ notice: 'N' } as any, f('UNCONFIRMED', 'N'), undefined)).toBe(false);
    expect(judgeLimit({ notice: 'N' } as any, f('CONFIRMED', 'other'), undefined)).toBe(false);
  });
  it('warning: a regex that must match a run-level or finding-level warning', () => {
    expect(judgeLimit({ warning: 'nondeterministic' } as any, rep({ warnings: ['nondeterministic scenario: x'] }) as any, undefined)).toBe(true);
    expect(judgeLimit({ warning: 'nondeterministic' } as any, rep({ violations: [{ status: 'CONFIRMED', warnings: ['nondeterministic scenario: y'] }] }) as any, undefined)).toBe(true);
    expect(judgeLimit({ warning: 'nondeterministic' } as any, rep() as any, undefined)).toBe(false);
  });
  it('stoppedBy: the search must have stopped for one of the named reasons and must not claim to be exhaustive', () => {
    const stopped = (by: string, exhaustive: boolean) => rep({ coverage: { stoppedBy: by, exhaustiveWithinBound: exhaustive } }) as any;
    expect(judgeLimit({ stoppedBy: ['schedule-budget', 'time-budget'] } as any, stopped('time-budget', false), undefined)).toBe(true);
    expect(judgeLimit({ stoppedBy: 'schedule-budget' } as any, stopped('time-budget', false), undefined)).toBe(false);
    expect(judgeLimit({ stoppedBy: 'schedule-budget' } as any, stopped('schedule-budget', true), undefined)).toBe(false);
  });
  it('every field that is given must hold, and an expected.json with none of them judges nothing as OK', () => {
    expect(judgeLimit({ message: 'a', warning: 'b' } as any, rep({ warnings: ['b'] }) as any, 'a')).toBe(true);
    expect(judgeLimit({ message: 'a', warning: 'b' } as any, rep() as any, 'a')).toBe(false);
    expect(judgeLimit({} as any, rep() as any, undefined)).toBe(false);
  });
});


describe('small sets are reported as counts, not percentages (docs/METRICS_v2.md)', () => {
  const r = (id: string, o: Record<string, unknown> = {}) => row({ id, ...o });
  const metricLines = (md: string) => md.split('\n').filter((l) => /^\| (Recall|False positives|False-positive|Confirmation)/.test(l));
  it('fewer than 20 scenarios: counts only, with the sample size stated', () => {
    const rows = [r('a'), r('b'), r('c', { expect: 'safe', outcome: 'clean' })];
    const md = markdown(summarize('small', rows as any), rows as any);
    expect(md).toMatch(/\| Recall \| 2 of 2 in-scope buggy/);
    expect(md).toMatch(/\| False positives \| 0 of 1 in-scope safe/);
    expect(md).toMatch(/small sample/i);
    expect(metricLines(md).join('')).not.toMatch(/%/);
  });
  it('20 or more scenarios keep percentages next to the counts', () => {
    const rows = Array.from({ length: 20 }, (_, i) => r('s' + i));
    expect(markdown(summarize('big', rows as any), rows as any)).toMatch(/\| Recall \| 100\.0% \(20\/20/);
  });
  it('the observed preemption count of the hit is recorded next to the derived one', () => {
    const rows = [r('p', { expectedMinPreemptions: 2, observedPreemptions: 2 })];
    expect(markdown(summarize('x', rows as any), rows as any)).toMatch(/\| 2 \/ 2 \|/);
  });
});
