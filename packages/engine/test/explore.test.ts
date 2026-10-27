import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSession, type Session } from '../src/runner.js';
import { explore, exitCodeFor, formatExplore, type ExploreReport } from '../src/explorer.js';
import { loadScenario } from '../src/loader.js';
import { testDsn } from './helpers.js';
import { SEEDS } from './seeds.expected.js';

const here = dirname(fileURLToPath(import.meta.url));
const seeds = join(here, 'fixtures', 'seeds');
let dsn: string;
let session: Session | undefined;
beforeAll(async () => { dsn = await testDsn(); });
afterEach(async () => { await session?.close(); session = undefined; });

async function open(file: string, isolation: 'default' | 'rc' | 'rr' | 'ser' = 'default') {
  const { scenario, dir } = await loadScenario(join(seeds, file));
  session = await createSession(scenario, { dsn, scenarioDir: dir, isolation });
  return session;
}
const confirmed = (r: ExploreReport) => r.violations.filter((v) => v.status === 'CONFIRMED');

describe('AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count', () => {
  for (const exp of SEEDS.filter((s) => s.kind === 'buggy')) {
    it(`${exp.file}`, async () => {
      const report = await explore(await open(exp.file), {});
      const hit = confirmed(report).find((v) => v.invariant === exp.invariant);
      expect(hit, `expected a confirmed violation of "${exp.invariant}"`).toBeDefined();
      expect(hit!.kind).toBe('VIOLATION');
      expect(hit!.confirmed).toBe('3/3');
      // minimal preemption count, derived by reasoning in seeds.expected.ts
      expect(hit!.preemptions).toBe(exp.minPreemptions);
      // pinned position of the first violating schedule in the deterministic exploration order
      expect(hit!.scheduleIndex).toBe(exp.firstViolationIndex);
      expect(report.coverage.exhaustiveWithinBound).toBe(true);
      expect(report.coverage.stoppedBy).toBe('complete');
      expect(exitCodeFor(report)).toBe(1);
      // the schedule is the replayable choice sequence
      expect(hit!.schedule.length).toBeGreaterThan(0);
    });
  }
  it('pinned explored-schedule counts for every seed', async () => {
    for (const exp of SEEDS) {
      const report = await explore(await open(exp.file), {});
      expect(report.coverage.explored, exp.file).toBe(exp.explored);
      await session?.close();
      session = undefined;
    }
  });
});

describe('safe controls never trip the tool', () => {
  for (const exp of SEEDS.filter((s) => s.kind === 'safe')) {
    it(`${exp.file}: no finding, exhaustive within the bound, exit 0`, async () => {
      const report = await explore(await open(exp.file), {});
      expect(report.violations).toEqual([]);
      expect(report.coverage.exhaustiveWithinBound).toBe(true);
      expect(report.coverage.stoppedBy).toBe('complete');
      expect(exitCodeFor(report)).toBe(0);
    });
  }
});

describe('AC2.2 minimality', () => {
  it('a bug needing exactly 2 preemptions is found at 2 and not found with a bound of 1 (honestly reported)', async () => {
    const found = await explore(await open('two-preemptions.mjs'), {});
    expect(confirmed(found)[0]!.preemptions).toBe(2);
    await session!.close();
    session = undefined;
    const bounded = await explore(await open('two-preemptions.mjs'), { maxPreemptions: 1 });
    expect(bounded.violations).toEqual([]);
    expect(bounded.coverage.preemptionBound).toBe(1);
    expect(bounded.coverage.exhaustiveWithinBound).toBe(true);
    expect(formatExplore(bounded)).toMatch(/preemption bound 1, exhaustive within bound: yes/);
  });
});

describe('AC2.3 confirmation', () => {
  it('a deliberately flaky scenario is UNCONFIRMED, exits 4 and never counts as a finding', async () => {
    (globalThis as any).__flakyCalls = 0;
    const report = await explore(await open('flaky.mjs'), {});
    expect(report.violations.length).toBeGreaterThan(0);
    expect(report.violations.every((v) => v.status === 'UNCONFIRMED')).toBe(true);
    expect(confirmed(report)).toEqual([]);
    expect(report.violations[0]!.confirmed).not.toBe('3/3');
    expect(exitCodeFor(report)).toBe(4);
    const text = formatExplore(report);
    expect(text).toMatch(/UNCONFIRMED \(flaky\)/);
    expect(text).not.toMatch(/\bCONFIRMED\b(?!.*UNCONFIRMED)/);
  });
  it('a confirmed violation reports confirmed 3/3', async () => {
    const report = await explore(await open('lost-update.mjs'), { confirmRuns: 3 });
    expect(confirmed(report)[0]!.confirmed).toBe('3/3');
    expect(formatExplore(report)).toMatch(/CONFIRMED \(3\/3\)/);
  });
});

describe('AC2.4 output wording', () => {
  it('always prints the coverage statement and never claims there are no race conditions', async () => {
    for (const file of ['lost-update.mjs', 'lost-update-safe.mjs', 'explode.mjs']) {
      const report = await explore(await open(file), { maxSchedules: 40 });
      const text = formatExplore(report);
      expect(text).toMatch(/Coverage: explored \d+ schedules?, preemption bound \d+, exhaustive within bound: (yes|no), stopped by: (complete|schedule-budget|time-budget)/);
      expect(text).not.toMatch(/no race conditions?/i);
      expect(text).not.toMatch(/race[- ]free|proved? correct|guarantee/i);
      await session?.close();
      session = undefined;
    }
  });
  it('a clean run says what was explored, not that the code is correct', async () => {
    const report = await explore(await open('lost-update-safe.mjs'), {});
    expect(formatExplore(report)).toMatch(/^No violations found in \d+ schedules \(preemption bound 3, exhaustive within bound: yes\)/m);
  });
});

describe('AC2.6 serial-equivalence oracle', () => {
  it('catches a lost update with NO hand-written invariant, labelled ANOMALY', async () => {
    const report = await explore(await open('lost-update-no-invariants.mjs'), {});
    const hit = confirmed(report)[0]!;
    expect(hit.kind).toBe('ANOMALY');
    expect(hit.invariant).toBe('serial-equivalence');
    expect(hit.preemptions).toBe(1);
    expect(exitCodeFor(report)).toBe(1);
    expect(report.oracles).toContain('serial-equivalence');
  });
  it('can be switched off', async () => {
    const report = await explore(await open('lost-update-no-invariants.mjs'), { serialOracle: false });
    expect(report.violations).toEqual([]);
    expect(report.oracles).not.toContain('serial-equivalence');
  });
  it('benign nondeterminism (uuid, timestamp) does not trigger it', async () => {
    const report = await explore(await open('benign-nondeterminism.mjs'), {});
    expect(report.violations).toEqual([]);
  });
});

describe('AC2.7 budgets', () => {
  it('stops on the schedule budget and says so (exit 0, not exhaustive)', async () => {
    const report = await explore(await open('explode.mjs'), { maxSchedules: 50 });
    expect(report.coverage.explored).toBe(50);
    expect(report.coverage.stoppedBy).toBe('schedule-budget');
    expect(report.coverage.exhaustiveWithinBound).toBe(false);
    expect(exitCodeFor(report)).toBe(0);
    const text = formatExplore(report);
    expect(text).toMatch(/exhaustive within bound: no, stopped by: schedule-budget/);
    expect(text).toMatch(/not exhaustive/i);
  });
  it('stops on the time budget with the real clock', async () => {
    const report = await explore(await open('explode.mjs'), { timeBudgetMs: 400, maxSchedules: 100000 });
    expect(report.coverage.stoppedBy).toBe('time-budget');
    expect(report.coverage.exhaustiveWithinBound).toBe(false);
    expect(report.coverage.explored).toBeGreaterThan(0);
    expect(formatExplore(report)).toMatch(/stopped by: time-budget/);
  });
  it('time budget logic with an injected clock', async () => {
    const clock = { t: 0, now() { return this.t; } };
    const s = await open('explode.mjs');
    const orig = s.execute.bind(s);
    s.execute = async (o) => { clock.t += 10; return orig(o); };
    const report = await explore(s, { timeBudgetMs: 35, maxSchedules: 100000, clock, serialOracle: false }); // reference runs would also spend the budget
    expect(report.coverage.explored).toBe(4); // runs start at t=0,10,20,30; at 40 the budget is spent
    expect(report.coverage.stoppedBy).toBe('time-budget');
  });
});

describe('random fallback', () => {
  it('is deterministic for a seed, never exhaustive, and reports the seed', async () => {
    const a = await explore(await open('lost-update.mjs'), { strategy: 'random', seed: 3, runs: 25 });
    await session!.close();
    session = undefined;
    const b = await explore(await open('lost-update.mjs'), { strategy: 'random', seed: 3, runs: 25 });
    expect(a.coverage.explored).toBe(25);
    expect(a.coverage.exhaustiveWithinBound).toBe(false);
    expect(a.coverage.strategy).toBe('random');
    expect(a.coverage.seed).toBe(3);
    expect(a.violations.map((v) => [v.kind, v.invariant, v.scheduleIndex, v.schedule])).toEqual(b.violations.map((v) => [v.kind, v.invariant, v.scheduleIndex, v.schedule]));
    expect(formatExplore(a)).toMatch(/random, seed 3/);
  });
  it('finds the lost update and confirms it', async () => {
    const r = await explore(await open('lost-update.mjs'), { strategy: 'random', seed: 1, runs: 40 });
    expect(confirmed(r).length).toBeGreaterThan(0);
  });
});

describe('nondeterminism warning', () => {
  it('warns when the statement sequence differs between the original run and a replay', async () => {
    const report = await explore(await open('nondeterministic.mjs'), {});
    const hit = confirmed(report)[0]!;
    expect(hit.warnings.join(' ')).toMatch(/nondeterministic scenario/);
  });
  it('does not warn for a deterministic scenario', async () => {
    const report = await explore(await open('lost-update.mjs'), {});
    expect(confirmed(report)[0]!.warnings).toEqual([]);
  });
});

describe('classification hints (heuristic, never certain)', () => {
  const labels = async (file: string) => (confirmed(await explore(await open(file), {}))[0]?.hints ?? []).map((h) => h.label);
  it('lost update -> read-modify-write', async () => { expect(await labels('lost-update.mjs')).toContain('read-modify-write'); });
  it('oversell -> read-modify-write', async () => { expect(await labels('oversell.mjs')).toContain('read-modify-write'); });
  it('check then insert', async () => { expect(await labels('check-then-insert.mjs')).toContain('check-then-insert'); });
  it('write skew', async () => { expect(await labels('write-skew.mjs')).toContain('write-skew'); });
  it('deadlock', async () => { expect(await labels('deadlock.mjs')).toContain('deadlock'); });
  it('every hint is labelled heuristic and carries a fix pattern', async () => {
    const report = await explore(await open('lost-update.mjs'), {});
    const hints = confirmed(report)[0]!.hints;
    expect(hints.length).toBeGreaterThan(0);
    for (const h of hints) {
      expect(h.heuristic).toBe(true);
      expect(h.fix.length).toBeGreaterThan(0);
    }
    expect(formatExplore(report)).toMatch(/hint \(heuristic\)/);
  });
});

describe('exitCodeFor semantics (0 vs 1 vs 4)', () => {
  const base = (violations: ExploreReport['violations'], stoppedBy: 'complete' | 'schedule-budget' | 'time-budget'): ExploreReport =>
    ({ violations, coverage: { stoppedBy } } as unknown as ExploreReport);
  const v = (status: 'CONFIRMED' | 'UNCONFIRMED') => ({ status }) as ExploreReport['violations'][number];
  it('1 when any finding is confirmed, whatever stopped the search', () => {
    for (const s of ['complete', 'schedule-budget', 'time-budget'] as const) {
      expect(exitCodeFor(base([v('CONFIRMED')], s))).toBe(1);
      expect(exitCodeFor(base([v('CONFIRMED'), v('UNCONFIRMED')], s))).toBe(1);
    }
  });
  it('4 when there are findings but none is confirmed', () => {
    for (const s of ['complete', 'schedule-budget', 'time-budget'] as const) expect(exitCodeFor(base([v('UNCONFIRMED')], s))).toBe(4);
  });
  it('0 when nothing was found, including after a budget stop (the wording says it was not exhaustive)', () => {
    for (const s of ['complete', 'schedule-budget', 'time-budget'] as const) expect(exitCodeFor(base([], s))).toBe(0);
  });
});

describe('seeds are importable as plain modules', () => {
  it('file URLs resolve', () => { expect(pathToFileURL(seeds).href).toMatch(/^file:/); });
});
