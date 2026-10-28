import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explore, exitCodeFor, formatExplore } from '../src/explorer.js';
import { loadScenario } from '../src/loader.js';
import { createSession, type Session } from '../src/runner.js';
import { testDsn } from './helpers.js';

const seeds = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'seeds');
let dsn: string;
let session: Session | undefined;
beforeAll(async () => { dsn = await testDsn(); });
afterEach(async () => { await session?.close(); session = undefined; });
async function open(file: string) {
  const { scenario, dir } = await loadScenario(join(seeds, file));
  session = await createSession(scenario, { dsn, scenarioDir: dir });
  return session;
}

describe('retriable aborts are surfaced as notes, never as violations', () => {
  it('SERIALIZABLE without retry: the 40001 abort is noted, the run stays clean', async () => {
    const r = await explore(await open('ser-no-retry.mjs'), {});
    expect(r.violations).toEqual([]);
    expect(exitCodeFor(r)).toBe(0);
    expect(r.notes.join('\n')).toMatch(/actor [AB] aborted by the database \(40001 serialization_failure\); if the app does not retry, users see an error/);
    expect(formatExplore(r)).toMatch(/^note: actor [AB] aborted by the database \(40001/m);
  });
  it('a deadlock victim is noted too (40P01), and the invariant finding is unchanged', async () => {
    const r = await explore(await open('deadlock.mjs'), {});
    expect(r.notes.join('\n')).toMatch(/aborted by the database \(40P01 deadlock_detected\); if the app does not retry, users see an error/);
    expect(r.violations.some((v) => v.status === 'CONFIRMED' && v.invariant === 'no actor aborted by a deadlock')).toBe(true);
  });
  it('one note per actor and code, not one per schedule', async () => {
    const r = await explore(await open('ser-no-retry.mjs'), {});
    const mine = r.notes.filter((n) => n.includes('40001'));
    expect(new Set(mine).size).toBe(mine.length);
    expect(mine.length).toBeLessThanOrEqual(2);
  });
});

describe('a clean run says what the bound did not cover and what raising it costs', () => {
  it('at bound 3: how to raise it and an estimate of the cost from the schedule counts per level', async () => {
    const r = await explore(await open('lost-update-safe.mjs'), {});
    const t = formatExplore(r);
    expect(t).toMatch(/Bugs that need more than 3 preemptions were not searched for/);
    expect(t).toMatch(/--max-preemptions 4/);
    expect(t).toMatch(/schedules at each preemption level so far: /);
    expect(r.coverage.schedulesByPreemptions.reduce((a, b) => a + b, 0)).toBe(r.coverage.explored);
  });
  it('bound 0 explains that only serial schedules were run', async () => {
    const r = await explore(await open('lost-update-safe.mjs'), { maxPreemptions: 0 });
    expect(formatExplore(r)).toMatch(/Only serial schedules were run \(bound 0\).*--max-preemptions 1/);
  });
  it('three or more actors get an extra hint about growth and the random strategy', async () => {
    const r = await explore(await open('three-safe.mjs'), {});
    const t = formatExplore(r);
    expect(t).toMatch(/With 3 actors the number of schedules grows steeply with the bound/);
    expect(t).toMatch(/--strategy random/);
  });
  it('two actors do not get the actor hint, and runs with findings do not get the bound message', async () => {
    const clean = formatExplore(await explore(await open('lost-update-safe.mjs'), {}));
    expect(clean).not.toMatch(/grows steeply/);
    await session!.close();
    session = undefined;
    const buggy = formatExplore(await explore(await open('lost-update.mjs'), {}));
    expect(buggy).not.toMatch(/were not searched for/);
  });
  it('a clean run that stopped on a budget says how to raise the budget instead', async () => {
    const r = await explore(await open('explode.mjs'), { maxSchedules: 20 });
    expect(formatExplore(r)).toMatch(/--max-schedules|--time-budget/);
  });
});
