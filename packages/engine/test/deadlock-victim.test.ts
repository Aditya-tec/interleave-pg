import { describe, it, expect, afterAll } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/runner.js';
import { explore, type ExploreReport } from '../src/explorer.js';
import { initDb } from '../src/initdb.js';
import { loadScenario } from '../src/loader.js';
import { adminDsn } from './helpers.js';

const seeds = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'seeds');

async function run(file: string, deadlockTimeout: string) {
  const dsn = await initDb({ adminDsn: adminDsn(), name: 'interleave_test', deadlockTimeout });
  const { scenario, dir } = await loadScenario(join(seeds, file));
  const s = await createSession(scenario, { dsn, scenarioDir: dir });
  try {
    const victims = new Set<string>();
    const orig = s.execute.bind(s);
    s.execute = async (o) => {
      const r = await orig(o);
      for (const x of r.results) if (x.error?.code === '40P01') victims.add(x.actor);
      return r;
    };
    const report = await explore(s, {});
    return { report, victims: [...victims].sort() };
  } finally {
    await s.close();
  }
}
const key = (r: ExploreReport) => ({
  explored: r.coverage.explored,
  stoppedBy: r.coverage.stoppedBy,
  findings: r.violations.map((v) => [v.kind, v.invariant, v.status, v.confirmed, v.scheduleIndex, v.preemptions, v.occurrences]),
  exit: r.exitCode,
});

afterAll(async () => { await initDb({ adminDsn: adminDsn(), name: 'interleave_test' }); });

describe('no finding depends on WHICH actor Postgres picks as the deadlock victim', () => {
  it('victim A (300 ms) and victim B (10 ms, the second waiter times out first) give the same findings, counts and exit code', async () => {
    const slow = await run('deadlock.mjs', '300ms');
    const fast = await run('deadlock.mjs', '10ms'); // 10 ms is the lowest accepted value
    expect(slow.victims).toContain('A');
    expect(fast.victims).toContain('B');
    expect(key(fast.report)).toEqual(key(slow.report));
  });
  it('the safe (lock-ordered) variant is clean whichever way the timer falls', async () => {
    for (const t of ['300ms', '10ms']) {
      const r = await run('deadlock-safe.mjs', t);
      expect(r.report.violations).toEqual([]);
    }
  });
});
