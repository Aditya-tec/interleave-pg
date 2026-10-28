import { describe, it, expect } from 'vitest';
// @ts-ignore the eval scripts live outside the package
import { firstViolationIndex, harnessLimitMs, parseDuration } from '../../../eval/engine-metrics.js';
// @ts-ignore
import { diffRows } from '../../../eval/stability-compare.mjs';

const row = (o: Record<string, unknown> = {}) => ({
  id: 's', outcome: 'hit', explored: 100, confirmed: ['VIOLATION:inv'], unconfirmed: [], stoppedBy: 'complete', observedPreemptions: 1, firstViolationIndex: 3, ...o,
});

describe('metrics options for the stability proof', () => {
  it('--time-budget accepts ms, s and m and nothing else', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('1800s')).toBe(1_800_000);
    expect(parseDuration('2m')).toBe(120_000);
    expect(parseDuration(undefined)).toBeUndefined();
    expect(() => parseDuration('soon')).toThrow(/500ms, 30s or 2m/);
  });

  it('the harness limit stays 300 s by default and always exceeds the time budget it was given', () => {
    expect(harnessLimitMs(undefined)).toBe(300_000);
    expect(harnessLimitMs(1_800_000)).toBeGreaterThan(1_800_000);
    expect(harnessLimitMs(10_000)).toBe(300_000);
  });

  it('records the schedule at which the expected violation was first seen', () => {
    const report = { violations: [
      { status: 'CONFIRMED', invariant: 'other', scheduleIndex: 9 },
      { status: 'UNCONFIRMED', invariant: 'inv', scheduleIndex: 1 },
      { status: 'CONFIRMED', invariant: 'inv', scheduleIndex: 4 },
    ] };
    expect(firstViolationIndex(report, 'inv')).toBe(4);
    expect(firstViolationIndex(report, 'missing')).toBeUndefined();
    expect(firstViolationIndex(undefined, 'inv')).toBeUndefined();
  });
});

describe('diffRows: the stability criterion', () => {
  it('identical rows have no differences', () => {
    expect(diffRows([row()], [row()], 'strict').differences).toEqual([]);
    expect(diffRows([row()], [row()], 'amended').differences).toEqual([]);
  });

  it('strict compares every field, including schedules explored and why the search stopped', () => {
    const d = diffRows([row()], [row({ explored: 80, stoppedBy: 'time-budget' })], 'strict');
    expect(d.differences.map((x: any) => x.id)).toEqual(['s']);
  });

  it('strict also compares the first-violation schedule index', () => {
    expect(diffRows([row()], [row({ firstViolationIndex: 5 })], 'strict').differences).toHaveLength(1);
  });

  it('amended ignores schedule count and stop reason only when a run stopped by time budget, and lists that stop', () => {
    const d = diffRows([row()], [row({ explored: 40, stoppedBy: 'time-budget' })], 'amended');
    expect(d.differences).toEqual([]);
    expect(d.timeBudgetStops).toEqual([{ id: 's', explored: 40 }]);
  });

  it('amended still compares schedule count and stop reason when neither run stopped by time budget', () => {
    expect(diffRows([row()], [row({ explored: 99 })], 'amended').differences).toHaveLength(1);
    expect(diffRows([row()], [row({ stoppedBy: 'schedule-budget' })], 'amended').differences).toHaveLength(1);
  });

  it('amended still compares outcome, findings, confirmations and preemption counts, even for a time-budget stop', () => {
    const tb = { stoppedBy: 'time-budget' };
    expect(diffRows([row()], [row({ ...tb, outcome: 'miss' })], 'amended').differences).toHaveLength(1);
    expect(diffRows([row()], [row({ ...tb, confirmed: [] })], 'amended').differences).toHaveLength(1);
    expect(diffRows([row()], [row({ ...tb, unconfirmed: ['VIOLATION:x'] })], 'amended').differences).toHaveLength(1);
    expect(diffRows([row()], [row({ ...tb, observedPreemptions: 2 })], 'amended').differences).toHaveLength(1);
  });

  it('a missing scenario is a difference', () => {
    expect(diffRows([row(), row({ id: 't' })], [row()], 'amended').differences).toHaveLength(1);
  });
});
