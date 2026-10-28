#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { doctor } from './doctor.js';
import { ScenarioError } from './errors.js';
import { explore, exploreMatrix, formatExplore, formatMatrix, replayFinding, type ExploreRunOptions } from './explorer.js';
import { redactDsn, UnsafeTargetError } from './guard.js';
import { initDb } from './initdb.js';
import { loadScenario } from './loader.js';
import { MAX_REPORT_BYTES, parseReport, serializeReport } from './report.js';
import { formatRun } from './reporter.js';
import { createSession, type Isolation } from './runner.js';
import { resolveInside } from './safe-paths.js';

const USAGE = `interleave-pg - force concurrent Postgres statements through many interleavings (local throwaway DB only)

Usage:
  interleave-pg init-db [--name interleave_dev] [--compose] [--deadlock-timeout 300ms]
  interleave-pg run <scenario.mjs> [--max-preemptions K] [--max-schedules N] [--time-budget 120s]
                    [--strategy dfs|random --seed N --runs M] [--isolation default|rc|rr|ser|matrix]
                    [--json out.json] [--allow-dir DIR]
  interleave-pg run <scenario.mjs> --schedule A,B,A,B        (one forced schedule)
  interleave-pg replay <report.json> [--violation v1] [--allow-dir DIR]
  interleave-pg doctor

The target database comes only from --dsn or INTERLEAVE_DSN (never DATABASE_URL).
Exit codes: 0 no finding in the explored schedules, 1 confirmed violation, 2 tool/scenario error,
3 unsafe target refused, 4 inconclusive (findings that did not replay 3 of 3).
`;

const COMPOSE = `name: interleave-pg
services:
  postgres:
    image: postgres:17
    ports:
      - "127.0.0.1:5433:5432"
    environment:
      POSTGRES_PASSWORD: interleave-pg
      POSTGRES_DB: postgres
    tmpfs:
      - /var/lib/postgresql/data
`;

function out(s: string): void { process.stdout.write(s.endsWith('\n') ? s : s + '\n'); }
function err(s: string): void { process.stderr.write(s.endsWith('\n') ? s : s + '\n'); }

function intOpt(name: string, v: string | undefined, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (v === undefined) return undefined;
  if (!/^-?\d+$/.test(v) || Number(v) < min || Number(v) > max) {
    throw new ScenarioError(`--${name} must be an integer between ${min} and ${max === Number.MAX_SAFE_INTEGER ? 'infinity' : max}`);
  }
  return Number(v);
}

function durationMs(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = /^(\d+)(ms|s|m)?$/.exec(v);
  if (!m) throw new ScenarioError('--time-budget must look like 500ms, 30s or 2m');
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : m[2] === 'm' ? n * 60_000 : n * 1000;
}

function roots(allow: string[] | undefined): string[] {
  return [process.cwd(), ...(allow ?? []).map((d) => resolve(d))];
}

function writeReport(path: string, text: string, rootDirs: string[]): void {
  const target = resolveInside(path, rootDirs, 'report path');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    out(USAGE);
    return cmd ? 0 : 2;
  }
  const common = { dsn: { type: 'string' as const } };

  if (cmd === 'init-db') {
    const { values } = parseArgs({ args: rest, options: { ...common, name: { type: 'string' }, compose: { type: 'boolean' }, 'deadlock-timeout': { type: 'string' } } });
    if (values.compose) {
      out(COMPOSE);
      return 0;
    }
    const dsn = values.dsn ?? process.env.INTERLEAVE_DSN;
    if (!dsn) throw new UnsafeTargetError('refusing: no DSN. Set INTERLEAVE_DSN (a maintenance database on the local server) or pass --dsn');
    const target = await initDb({ adminDsn: dsn, name: values.name ?? 'interleave_dev', deadlockTimeout: values['deadlock-timeout'] });
    out(`database ready: ${redactDsn(target)}`);
    return 0;
  }

  if (cmd === 'doctor') {
    const { values } = parseArgs({ args: rest, options: { ...common } });
    const r = await doctor(values.dsn ?? process.env.INTERLEAVE_DSN, process.cwd());
    out(r.lines.join('\n'));
    return r.ok ? 0 : 2;
  }

  if (cmd === 'run') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        ...common,
        schedule: { type: 'string' },
        'max-preemptions': { type: 'string' },
        'max-schedules': { type: 'string' },
        'time-budget': { type: 'string' },
        strategy: { type: 'string' },
        seed: { type: 'string' },
        runs: { type: 'string' },
        isolation: { type: 'string' },
        json: { type: 'string' },
        'allow-dir': { type: 'string', multiple: true },
      },
    });
    const file = positionals[0];
    if (!file) throw new ScenarioError('usage: interleave-pg run <scenario> [options]  (see --help)');
    const strategy = values.strategy ?? 'dfs';
    if (strategy !== 'dfs' && strategy !== 'random') throw new ScenarioError('--strategy must be dfs or random');
    const isoArg = values.isolation ?? 'default';
    if (!['default', 'rc', 'rr', 'ser', 'matrix'].includes(isoArg)) throw new ScenarioError('--isolation must be default, rc, rr, ser or matrix');
    const opts: ExploreRunOptions = {
      maxPreemptions: intOpt('max-preemptions', values['max-preemptions'], 0, 20),
      maxSchedules: intOpt('max-schedules', values['max-schedules'], 1),
      timeBudgetMs: durationMs(values['time-budget']),
      strategy,
      seed: intOpt('seed', values.seed, 0, 2 ** 32 - 1),
      runs: intOpt('runs', values.runs, 1),
    };
    const rootDirs = roots(values['allow-dir']);
    if (values.json) resolveInside(values.json, rootDirs, 'report path'); // fail before doing any work
    const dsn = (values.dsn ?? process.env.INTERLEAVE_DSN) as string;
    const { scenario, dir } = await loadScenario(file);
    const scenarioAbs = resolve(file);
    const rel = relative(process.cwd(), scenarioAbs);
    opts.scenarioFile = rel.startsWith('..') || isAbsolute(rel) ? scenarioAbs : rel;
    const open = (isolation: Isolation) => createSession(scenario, { dsn, scenarioDir: dir, isolation });

    if (values.schedule) {
      if (isoArg === 'matrix') throw new ScenarioError('--schedule cannot be combined with --isolation matrix');
      const schedule = values.schedule.split(',').map((s) => s.trim()).filter(Boolean);
      const session = await open(isoArg as Isolation);
      try {
        const result = await session.run(schedule);
        out(formatRun(result));
        return result.violations.length ? 1 : 0;
      } finally {
        await session.close();
      }
    }

    if (isoArg === 'matrix') {
      const rows = await exploreMatrix((iso) => open(iso), opts);
      out(formatMatrix(rows));
      if (values.json) {
        const body = { tool: 'interleave-pg', matrix: rows.map((r) => ({ isolation: r.isolation, admitted: r.admitted, aborted: r.aborted, prevented: r.prevented, coverage: r.report.coverage })) };
        writeReport(values.json, JSON.stringify(body, null, 2), rootDirs);
      }
      return 0;
    }

    const session = await open(isoArg as Isolation);
    try {
      const report = await explore(session, opts);
      out(formatExplore(report));
      if (values.json) writeReport(values.json, serializeReport(report), rootDirs);
      return report.exitCode;
    } finally {
      await session.close();
    }
  }

  if (cmd === 'replay') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { ...common, violation: { type: 'string' }, 'allow-dir': { type: 'string', multiple: true } },
    });
    const file = positionals[0];
    if (!file) throw new ScenarioError('usage: interleave-pg replay <report.json> [--violation v1]');
    const rootDirs = roots(values['allow-dir']);
    const reportPath = resolveInside(file, rootDirs, 'report');
    let size: number;
    try {
      size = statSync(reportPath).size;
    } catch {
      throw new ScenarioError(`cannot read report "${file}"`);
    }
    if (size > MAX_REPORT_BYTES) throw new ScenarioError(`report too large (${size} bytes, limit ${MAX_REPORT_BYTES})`);
    const saved = parseReport(readFileSync(reportPath, 'utf8'));
    const finding = values.violation
      ? saved.violations.find((v) => v.id === values.violation)
      : (saved.violations.find((v) => v.status === 'CONFIRMED') ?? saved.violations[0]);
    if (!finding) throw new ScenarioError(values.violation ? `no violation "${values.violation}" in the report` : 'the report has no violations to replay');
    if (!saved.scenarioFile) throw new ScenarioError('the report does not name its scenario file');
    const scenarioPath = resolveInside(saved.scenarioFile, rootDirs, 'scenario file');
    const { scenario, dir } = await loadScenario(scenarioPath);
    const session = await createSession(scenario, { dsn: (values.dsn ?? process.env.INTERLEAVE_DSN) as string, scenarioDir: dir, isolation: saved.isolation });
    try {
      const r = await replayFinding(session, finding, 3);
      const lines = [
        `Replaying ${finding.id} (${finding.kind}: ${finding.invariant}) under the saved schedule ${finding.schedule.join(',')}`,
        `Reproduced ${r.reproduced}/${r.runs}`,
      ];
      if (r.fingerprintDiffers) lines.push('note: the statement sequence differs from the saved one (the code under test changed, or the scenario is nondeterministic)');
      if (r.diverged) lines.push('warning: nondeterministic scenario: the replay diverged from the saved schedule');
      if (r.reproduced === 0) lines.push('Not reproduced under this schedule. That does not prove a fix: run the full exploration as well.');
      out(lines.join('\n'));
      return r.reproduced === r.runs ? 1 : r.reproduced === 0 ? 0 : 4;
    } finally {
      await session.close();
    }
  }

  throw new ScenarioError(`unknown command "${cmd}"\n\n${USAGE}`);
}

main(process.argv.slice(2)).then(
  (code) => exit(code),
  (e: any) => {
    if (e instanceof UnsafeTargetError) {
      err(redactDsn(e.message));
      exit(3);
    } else if (typeof e?.code === 'string' && e.code.startsWith('ERR_PARSE_ARGS')) {
      err(`${e.message}\n\n${USAGE}`);
      exit(2);
    } else {
      err(`${e?.name ?? 'Error'}: ${redactDsn(String(e?.message ?? e))}`);
      exit(2);
    }
  },
);

/** Flush stdio, then exit (app pools may keep the event loop alive). */
function exit(code: number): void {
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
}
