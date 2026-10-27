#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { doctor } from './doctor.js';
import { ScenarioError } from './errors.js';
import { redactDsn, UnsafeTargetError } from './guard.js';
import { initDb } from './initdb.js';
import { loadScenario } from './loader.js';
import { formatRun } from './reporter.js';
import { createSession } from './runner.js';

const USAGE = `interleave-pg - force concurrent Postgres statements through chosen interleavings (local throwaway DB only)

Usage:
  interleave-pg init-db [--name interleave_dev] [--compose]
  interleave-pg run <scenario.mjs> --schedule A,B,A,B
  interleave-pg doctor

The target database comes only from --dsn or INTERLEAVE_DSN (never DATABASE_URL).
Exit codes: 0 no violations in the explored schedule, 1 violation, 2 tool/scenario error, 3 unsafe target refused.
`;

const COMPOSE = `services:
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

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    out(USAGE);
    return cmd ? 0 : 2;
  }
  const common = { dsn: { type: 'string' as const } };

  if (cmd === 'init-db') {
    const { values } = parseArgs({ args: rest, options: { ...common, name: { type: 'string' }, compose: { type: 'boolean' } } });
    if (values.compose) {
      out(COMPOSE);
      return 0;
    }
    const dsn = values.dsn ?? process.env.INTERLEAVE_DSN;
    if (!dsn) throw new UnsafeTargetError('refusing: no DSN. Set INTERLEAVE_DSN (a maintenance database on the local server) or pass --dsn');
    const target = await initDb({ adminDsn: dsn, name: values.name ?? 'interleave_dev' });
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
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { ...common, schedule: { type: 'string' } } });
    const file = positionals[0];
    if (!file) throw new ScenarioError('usage: interleave-pg run <scenario> --schedule A,B,A,B');
    if (!values.schedule) {
      throw new ScenarioError('--schedule is required (e.g. --schedule A,B,A,B). Automatic exploration is not available yet.');
    }
    const schedule = values.schedule.split(',').map((s) => s.trim()).filter(Boolean);
    const { scenario, dir } = await loadScenario(file);
    const session = await createSession(scenario, {
      dsn: (values.dsn ?? process.env.INTERLEAVE_DSN) as string,
      scenarioDir: dir,
    });
    try {
      const result = await session.run(schedule);
      out(formatRun(result));
      return result.violations.length ? 1 : 0;
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
    } else if (e?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || e?.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
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

