import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pkg, runCli, seed } from './cli-helpers.js';

describe('run without --schedule explores', () => {
  it('finds, confirms and prints the lost update (exit 1) with the coverage statement', async () => {
    const r = await runCli(['run', seed('lost-update.mjs')]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/CONFIRMED \(3\/3\) VIOLATION: both deposits applied/);
    expect(r.out).toMatch(/Coverage: explored \d+ schedules?, preemption bound 3, exhaustive within bound: yes, stopped by: complete/);
    expect(r.out).not.toMatch(/no race conditions?/i);
  });
  it('a safe scenario exits 0 and says what was explored', async () => {
    const r = await runCli(['run', seed('lost-update-safe.mjs')]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^No violations found in \d+ schedules \(preemption bound 3, exhaustive within bound: yes\)/m);
  });
  it('--max-preemptions 0 explores only serial schedules and says so', async () => {
    const r = await runCli(['run', seed('lost-update.mjs'), '--max-preemptions', '0']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/preemption bound 0, exhaustive within bound: yes/);
  });
  it('--max-schedules stops with schedule-budget, exit 0, honest wording', async () => {
    const r = await runCli(['run', seed('explode.mjs'), '--max-schedules', '20']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/explored 20 schedules, preemption bound 3, exhaustive within bound: no, stopped by: schedule-budget/);
    expect(r.out).toMatch(/not exhaustive/);
  });
  it('--time-budget stops with time-budget', async () => {
    const r = await runCli(['run', seed('explode.mjs'), '--time-budget', '500ms', '--max-schedules', '100000']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/stopped by: time-budget/);
  });
  it('the flaky scenario exits 4 and is inconclusive', async () => {
    const r = await runCli(['run', seed('flaky.mjs')]);
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/UNCONFIRMED \(flaky\)/);
    expect(r.out).toMatch(/Inconclusive/);
  });
  it('--strategy random --seed N --runs M is deterministic', async () => {
    const a = await runCli(['run', seed('lost-update.mjs'), '--strategy', 'random', '--seed', '3', '--runs', '25']);
    const b = await runCli(['run', seed('lost-update.mjs'), '--strategy', 'random', '--seed', '3', '--runs', '25']);
    expect(a.code).toBe(1);
    expect(a.out).toBe(b.out);
    expect(a.out).toMatch(/random, seed 3/);
  });
  it('--isolation ser on write skew: the anomaly is excluded (aborted by the database), exit 0', async () => {
    const r = await runCli(['run', seed('write-skew.mjs'), '--isolation', 'ser']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/isolation: ser/);
  });
  it('--schedule is still a forced single schedule', async () => {
    const r = await runCli(['run', seed('lost-update.mjs'), '--schedule', 'A,B,B,A']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Schedule: A,B,B,A \(forced\)/);
  });
});

describe('--isolation matrix', () => {
  it('AC2.5: write skew is admitted under rc and rr, aborted (40001) and not admitted under ser; the three outcomes are separate columns', async () => {
    const r = await runCli(['run', seed('write-skew.mjs'), '--isolation', 'matrix']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/level\s+admitted\s+aborted \(retriable\)\s+prevented by blocking\/constraint/);
    expect(r.out).toMatch(/^rc\s+yes \(\d+\)\s+-\s+-/m);
    expect(r.out).toMatch(/^rr\s+yes \(\d+\)\s+-\s+-/m);
    expect(r.out).toMatch(/^ser\s+no\s+40001\s+-/m);
  });
  it('a correct locking fix shows up as prevented by blocking', async () => {
    const r = await runCli(['run', seed('write-skew-safe.mjs'), '--isolation', 'matrix']);
    expect(r.out).toMatch(/^rc\s+no\s+-\s+blocking/m);
  });
});

describe('option validation (exit 2)', () => {
  const bad: [string, string[]][] = [
    ['negative preemptions', ['--max-preemptions', '-1']],
    ['non-numeric schedules', ['--max-schedules', 'lots']],
    ['unknown strategy', ['--strategy', 'quantum']],
    ['unknown isolation', ['--isolation', 'chaos']],
    ['bad time budget', ['--time-budget', 'soon']],
  ];
  for (const [name, flags] of bad) {
    it(`rejects ${name}`, async () => {
      const r = await runCli(['run', seed('lost-update.mjs'), ...flags]);
      expect(r.code).toBe(2);
    });
  }
});

describe('--json report', () => {
  it('writes the report inside the working directory', async () => {
    const out = join('test', '.tmp', 'explore-report.json');
    const r = await runCli(['run', seed('lost-update.mjs'), '--json', out]);
    expect(r.code).toBe(1);
    const j = JSON.parse(readFileSync(join(pkg, out), 'utf8'));
    expect(j.tool).toBe('interleave-pg');
    expect(j.coverage.stoppedBy).toBe('complete');
    expect(j.violations[0].confirmed).toBe('3/3');
    expect(j.violations[0].schedule.length).toBeGreaterThan(0);
    expect(j.exitCode).toBe(1);
  });
  it('refuses to write outside the working directory (exit 2)', async () => {
    const r = await runCli(['run', seed('lost-update.mjs'), '--json', join('..', '..', 'escape.json')]);
    expect(r.code).toBe(2);
    expect(existsSync(join(pkg, '..', '..', 'escape.json'))).toBe(false);
  });
});

describe('every connection goes through the guard (exit 3)', () => {
  const remote = 'postgres://u:topsecret@db.example.com:5432/interleave_x';
  const hostile = 'postgres://u@localhost:5433/interleave_test?hostaddr=10.0.0.5';
  const cases: [string, string[], string][] = [
    ['exploration', ['run', seed('lost-update.mjs')], remote],
    ['random fallback', ['run', seed('lost-update.mjs'), '--strategy', 'random', '--runs', '5'], remote],
    ['isolation matrix', ['run', seed('write-skew.mjs'), '--isolation', 'matrix'], remote],
    ['hostile query parameter, random fallback', ['run', seed('lost-update.mjs'), '--strategy', 'random'], hostile],
  ];
  for (const [name, args, dsn] of cases) {
    it(name, async () => {
      const r = await runCli(args, { INTERLEAVE_DSN: dsn });
      expect(r.code).toBe(3);
      expect(r.err + r.out).not.toMatch(/topsecret/);
    });
  }
});
