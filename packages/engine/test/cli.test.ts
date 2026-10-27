import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { adminDsn, testDsn } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const cli = join(pkg, 'dist', 'cli.js');
const fx = (f: string) => join(here, 'fixtures', f);
let dsn: string;

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  const e: Record<string, string | undefined> = { ...process.env, INTERLEAVE_DSN: dsn, NODE_ENV: 'test', ...env };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: e as NodeJS.ProcessEnv, cwd: pkg, timeout: 60000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(async () => {
  const b = spawnSync(process.execPath, [join(pkg, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], { cwd: pkg, encoding: 'utf8' });
  if (b.status !== 0) throw new Error('build failed: ' + b.stdout + b.stderr);
  dsn = await testDsn();
});

describe('run', () => {
  it('exit 1 with timeline, violation and coverage for the lost-update schedule', () => {
    const r = runCli(['run', fx('lost-update-pool.mjs'), '--schedule', 'A,B,A,B']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/VIOLATION: both deposits applied/);
    expect(r.out).toMatch(/Coverage: explored 1 schedule \(forced\)/);
    expect(r.out).not.toMatch(/no race conditions/i);
  });
  it('exit 0 for the serial schedule with honest wording', () => {
    const r = runCli(['run', fx('lost-update-pool.mjs'), '--schedule', 'A,A,B,B']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/No violations found in 1 schedule/);
    expect(r.out).not.toMatch(/no race conditions/i);
  });
  it('works for knex through the CLI', () => {
    expect(runCli(['run', fx('lost-update-knex.mjs'), '--schedule', 'A,B,A,B']).code).toBe(1);
  });
  it('Phase 2: without --schedule, run explores (it used to be a usage error in Phase 1)', () => {
    const r = runCli(['run', fx('lost-update-pool.mjs')]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Coverage: explored \d+ schedules?/);
    expect(r.err).not.toMatch(/--schedule/);
  });
  it('AC1.6: exit 2 with the zero-statement message', () => {
    const r = runCli(['run', fx('no-statements.mjs'), '--schedule', 'A,B']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/no statements intercepted: pg resolution mismatch\?/);
  });
  it('.ts scenario: clear error on Node < 22.18, runs otherwise', () => {
    const r = runCli(['run', fx('ts-scenario.ts'), '--schedule', 'A,B']);
    const [maj = 0, min = 0] = process.versions.node.split('.').map(Number);
    if (maj > 22 || (maj === 22 && min >= 18)) expect(r.err).not.toMatch(/use a \.mjs scenario or upgrade Node/i);
    else {
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/Use a \.mjs scenario or upgrade Node/);
    }
  });
});

describe('AC1.5 S1 refusals via the CLI (exit 3)', () => {
  const run = (env: Record<string, string | undefined>, extra: string[] = []) =>
    runCli(['run', fx('lost-update-pool.mjs'), '--schedule', 'A,A,B,B', ...extra], env);
  it('remote host', () => {
    const r = run({ INTERLEAVE_DSN: 'postgres://u:topsecret@db.example.com:5432/interleave_dev' });
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/not local/);
    expect(r.err + r.out).not.toMatch(/topsecret/);
  });
  it('database name without the interleave_ prefix', () => {
    expect(run({ INTERLEAVE_DSN: dsn.replace('interleave_test', 'postgres') }).code).toBe(3);
  });
  it('missing DSN (DATABASE_URL is never used)', () => {
    expect(run({ INTERLEAVE_DSN: undefined, DATABASE_URL: dsn }).code).toBe(3);
  });
  it('NODE_ENV=production', () => {
    expect(run({ NODE_ENV: 'production' }).code).toBe(3);
  });
  it('missing marker table', async () => {
    const admin = new pg.Client(adminDsn());
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS interleave_test_nomarker');
    await admin.query('CREATE DATABASE interleave_test_nomarker');
    await admin.end();
    try {
      const r = run({ INTERLEAVE_DSN: dsn.replace('interleave_test', 'interleave_test_nomarker') });
      expect(r.code).toBe(3);
      expect(r.err).toMatch(/marker table/);
    } finally {
      const a2 = new pg.Client(adminDsn());
      await a2.connect();
      await a2.query('DROP DATABASE IF EXISTS interleave_test_nomarker');
      await a2.end();
    }
  });
  it('--dsn flag is honoured and checked too', () => {
    expect(run({ INTERLEAVE_DSN: undefined }, ['--dsn', 'postgres://u@10.1.2.3/interleave_x']).code).toBe(3);
  });
});

describe('doctor / init-db', () => {
  it('doctor passes on the test database', () => {
    const r = runCli(['doctor']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\[ok\] .*marker/);
    expect(r.out).not.toMatch(/FAIL/);
  });
  it('doctor refuses a remote target with exit 3', () => {
    expect(runCli(['doctor'], { INTERLEAVE_DSN: 'postgres://u:p@db.example.com/interleave_x' }).code).toBe(3);
  });
  it('init-db --compose prints a compose file without touching a database', () => {
    const r = runCli(['init-db', '--compose'], { INTERLEAVE_DSN: undefined });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/services:/);
  });
  const NAME = 'interleave_test_cliinit';
  afterAll(async () => {
    const a = new pg.Client(adminDsn());
    await a.connect();
    await a.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await a.end();
  });
  it('init-db creates a database from the maintenance DSN and redacts the password', () => {
    const r = runCli(['init-db', '--name', NAME], { INTERLEAVE_DSN: adminDsn() });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(new RegExp(NAME));
    expect(r.out).not.toMatch(/:interleave-pg@/);
  });
  it('init-db refuses a bad name with exit 3', () => {
    expect(runCli(['init-db', '--name', 'production'], { INTERLEAVE_DSN: adminDsn() }).code).toBe(3);
  });
});
