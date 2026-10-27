import { describe, it, expect } from 'vitest';
import { decide, forcedChooser, prefixChooser, randomChooser, serialChooser, mulberry32, type Chooser, type Decision, type DecisionCtx } from '../src/choosers.js';
import { exploreBounded, exploreRandom, type Clock, type Executor } from '../src/strategy.js';

/**
 * A tiny deterministic model of the controller: each actor has `counts[id]` statements and every
 * statement is a scheduling point. It uses the same `decide` as the real controller, so the
 * strategy is tested here without a database.
 */
function model(counts: Record<string, number>, onRun?: (sequence: string) => void): Executor<{ decisions: Decision[]; sequence: string }> {
  return async (chooser: Chooser) => {
    const left = { ...counts };
    const decisions: Decision[] = [];
    let last: string | undefined;
    for (;;) {
      const runnable = Object.keys(left).filter((k) => left[k]! > 0).sort();
      if (runnable.length === 0) break;
      const ctx: DecisionCtx = {
        index: decisions.length,
        runnable,
        last,
        status: (id) => (left[id] === 0 ? 'DONE' : runnable.includes(id) ? 'AT_GATE' : 'OTHER'),
      };
      const d = decide(ctx, chooser);
      decisions.push(d);
      left[d.chosen]!--;
      last = d.chosen;
    }
    const sequence = decisions.map((d) => d.chosen).join('');
    onRun?.(sequence);
    return { decisions, sequence };
  };
}
const preemptionsOf = (d: Decision[]) => d.filter((x) => x.preemption).length;
const fakeClock = (): Clock & { t: number } => ({ t: 0, now() { return this.t; } });

describe('decide / preemption accounting', () => {
  it('counts a switch away from a runnable actor, not a switch after it finished', async () => {
    const run = await model({ A: 2, B: 2 })(prefixChooser(['A', 'B', 'A', 'B']));
    expect(run.sequence).toBe('ABAB');
    expect(run.decisions.map((d) => d.preemption)).toEqual([false, true, true, false]);
    const run2 = await model({ A: 2, B: 2 })(prefixChooser(['A', 'B', 'B', 'A']));
    expect(preemptionsOf(run2.decisions)).toBe(1);
    const serial = await model({ A: 2, B: 2 })(prefixChooser(['B', 'B', 'A', 'A']));
    expect(preemptionsOf(serial.decisions)).toBe(0);
  });
  it('default policy continues the current actor, else the lowest id', async () => {
    expect((await model({ A: 2, B: 2 })(() => undefined)).sequence).toBe('AABB');
    expect((await model({ A: 2, B: 2 })(prefixChooser(['B'])).then((r) => r.sequence))).toBe('BBAA');
  });
  it('flags a prefix entry that is not runnable and falls back to the default policy', async () => {
    const r = await model({ A: 1, B: 1 })(prefixChooser(['A', 'A']));
    expect(r.sequence).toBe('AB');
    expect(r.decisions[1]!.diverged).toBe(true);
  });
  it('forcedChooser keeps Phase 1 semantics: skips finished actors, keeps entries for blocked ones', () => {
    const warnings: string[] = [];
    const chooser = forcedChooser(['A', 'B', 'A'], (m) => warnings.push(m));
    const ctx = (status: Record<string, 'DONE' | 'AT_GATE' | 'OTHER'>, runnable: string[]): DecisionCtx => ({ index: 0, runnable, status: (id) => status[id] ?? 'OTHER' });
    expect(chooser(ctx({ A: 'AT_GATE', B: 'AT_GATE' }, ['A', 'B']))).toBe('A');
    expect(chooser(ctx({ A: 'AT_GATE', B: 'OTHER' }, ['A']))).toBeUndefined(); // B blocked: entry kept
    expect(chooser(ctx({ A: 'AT_GATE', B: 'AT_GATE' }, ['A', 'B']))).toBe('B');
    expect(chooser(ctx({ A: 'DONE', B: 'AT_GATE' }, ['B']))).toBeUndefined(); // A finished: dropped with a warning
    expect(warnings.length).toBe(1);
  });
  it('serialChooser runs actors in the given order', async () => {
    expect((await model({ A: 2, B: 2, C: 1 })(serialChooser(['C', 'B', 'A']))).sequence).toBe('CBBAA');
  });
});

describe('exploreBounded (iterative context bounding)', () => {
  const opts = { maxPreemptions: 3, maxSchedules: 2000, timeBudgetMs: 120000 };

  it('enumerates every schedule exactly once and reports exhaustive within the bound', async () => {
    const seen: string[] = [];
    const s = await exploreBounded(model({ A: 2, B: 2 }, (q) => seen.push(q)), opts, fakeClock());
    expect(s.explored).toBe(6); // C(4,2)
    expect(new Set(seen).size).toBe(6);
    expect(s.stoppedBy).toBe('complete');
    expect(s.exhaustive).toBe(true);
  });
  it('explores in non-decreasing preemption order (0, then 1, then 2 ...)', async () => {
    const counts: number[] = [];
    await exploreBounded(model({ A: 3, B: 3 }), opts, fakeClock(), (info) => { counts.push(info.preemptions); });
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0]).toBe(0);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(3);
  });
  it('AC2.2 model: the first schedule that violates a bug needing exactly 2 preemptions has exactly 2', async () => {
    let first: { index: number; preemptions: number; sequence: string } | undefined;
    await exploreBounded(model({ A: 2, B: 2 }), opts, fakeClock(), (info, r) => {
      if (!first && ['ABAB', 'BABA'].includes((r as { sequence: string }).sequence)) first = { index: info.index, preemptions: info.preemptions, sequence: (r as { sequence: string }).sequence };
    });
    expect(first!.preemptions).toBe(2);
    expect(first!.index).toBeGreaterThan(4); // all 0- and 1-preemption schedules (2 + 2) come first
  });
  it('a bound of 1 explores only schedules with at most 1 preemption and says so', async () => {
    const seen: string[] = [];
    const s = await exploreBounded(model({ A: 2, B: 2 }, (q) => seen.push(q)), { ...opts, maxPreemptions: 1 }, fakeClock());
    expect([...seen].sort()).toEqual(['AABB', 'ABBA', 'BAAB', 'BBAA']);
    expect(s.exhaustive).toBe(true); // exhaustive WITHIN the bound
    expect(s.maxPreemptions).toBe(1);
  });
  it('is deterministic: identical order and counts on repeated runs', async () => {
    const a: string[] = [];
    const b: string[] = [];
    await exploreBounded(model({ A: 3, B: 2, C: 2 }, (q) => a.push(q)), { ...opts, maxSchedules: 200 }, fakeClock());
    await exploreBounded(model({ A: 3, B: 2, C: 2 }, (q) => b.push(q)), { ...opts, maxSchedules: 200 }, fakeClock());
    expect(a).toEqual(b);
  });
  it('stops at maxSchedules with stoppedBy schedule-budget and exhaustive false', async () => {
    const s = await exploreBounded(model({ A: 2, B: 2 }), { ...opts, maxSchedules: 3 }, fakeClock());
    expect(s.explored).toBe(3);
    expect(s.stoppedBy).toBe('schedule-budget');
    expect(s.exhaustive).toBe(false);
  });
  it('finishing exactly on the budget is "complete", not a budget stop', async () => {
    const s = await exploreBounded(model({ A: 2, B: 2 }), { ...opts, maxSchedules: 6 }, fakeClock());
    expect(s.stoppedBy).toBe('complete');
    expect(s.exhaustive).toBe(true);
  });
  it('time budget uses the injected clock: stops before the run that starts past the budget', async () => {
    const clock = fakeClock();
    const exec = model({ A: 3, B: 3 });
    const timed: Executor<{ decisions: Decision[]; sequence: string }> = async (c) => { clock.t += 10; return exec(c); };
    const s = await exploreBounded(timed, { ...opts, timeBudgetMs: 25 }, clock);
    expect(s.explored).toBe(3); // starts at t=0, 10, 20; at t=30 the budget (25) is spent
    expect(s.stoppedBy).toBe('time-budget');
    expect(s.exhaustive).toBe(false);
  });
  it('a time budget of 0 stops before the first schedule', async () => {
    const s = await exploreBounded(model({ A: 2, B: 2 }), { ...opts, timeBudgetMs: 0 }, fakeClock());
    expect(s.explored).toBe(0);
    expect(s.stoppedBy).toBe('time-budget');
  });
  it('rejects more than 4 actors', async () => {
    await expect(exploreBounded(model({ A: 1, B: 1, C: 1, D: 1, E: 1 }), opts, fakeClock())).rejects.toThrow(/at most 4 actors/);
  });
});

describe('exploreRandom (seeded fallback)', () => {
  it('same seed gives the same schedules, a different seed gives different ones', async () => {
    const run = async (seed: number) => {
      const seen: string[] = [];
      await exploreRandom(model({ A: 3, B: 3 }, (q) => seen.push(q)), { runs: 12, seed }, fakeClock());
      return seen;
    };
    expect(await run(7)).toEqual(await run(7));
    expect(await run(7)).not.toEqual(await run(8));
  });
  it('runs exactly M schedules, reports distinct ones, and is never exhaustive', async () => {
    const s = await exploreRandom(model({ A: 3, B: 3 }), { runs: 25, seed: 1 }, fakeClock());
    expect(s.explored).toBe(25);
    expect(s.distinct).toBeLessThanOrEqual(25);
    expect(s.exhaustive).toBe(false);
    expect(s.stoppedBy).toBe('complete');
  });
  it('honours the time budget through the clock', async () => {
    const clock = fakeClock();
    const exec = model({ A: 3, B: 3 });
    const timed: Executor<{ decisions: Decision[]; sequence: string }> = async (c) => { clock.t += 10; return exec(c); };
    const s = await exploreRandom(timed, { runs: 100, seed: 1, timeBudgetMs: 25 }, clock);
    expect(s.explored).toBe(3);
    expect(s.stoppedBy).toBe('time-budget');
  });
  it('mulberry32 is a pure function of the seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(randomChooser(mulberry32(1))({ index: 0, runnable: ['A', 'B'], status: () => 'AT_GATE' })).toBeTypeOf('string');
  });
});
