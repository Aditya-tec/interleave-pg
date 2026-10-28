import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminDsn, testDsn } from './helpers.js';
import pg from 'pg';
import { runCli, seed } from './cli-helpers.js';

const NOMARKER = 'interleave_test_doctor_nomarker';
let dsn: string;
let noMarkerDsn: string;
let lonely: string;

beforeAll(async () => {
  dsn = await testDsn();
  const a = new pg.Client(await adminDsn());
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${NOMARKER}`);
  await a.query(`CREATE DATABASE ${NOMARKER}`);
  await a.end();
  const u = new URL(dsn);
  u.pathname = `/${NOMARKER}`;
  noMarkerDsn = u.toString();
  lonely = mkdtempSync(join(tmpdir(), 'interleave-doctor-'));
  mkdirSync(join(lonely, 'app'), { recursive: true });
  writeFileSync(
    join(lonely, 'app', 'scenario.mjs'),
    `export default { name: 'x', tables: ['t'], actors: { A: async () => {}, B: async () => {} } };\n`,
  );
});

afterAll(async () => {
  const a = new pg.Client(await adminDsn());
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${NOMARKER}`);
  await a.end();
  rmSync(lonely, { recursive: true, force: true });
});

/** Every FAIL line is followed by a line telling the user what to do. */
function expectFixes(out: string): void {
  const lines = out.split('\n');
  lines.forEach((l, i) => {
    if (l.startsWith('[FAIL]')) expect(lines[i + 1], `no fix line after: ${l}`).toMatch(/^\s+fix: \S/);
  });
}

describe('doctor diagnoses seeded misconfigurations', () => {
  it('0. a healthy setup passes with exit 0', async () => {
    const r = await runCli(['doctor']);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/FAIL/);
  });

  it('1. no DSN at all: says so and how to get one (exit 3)', async () => {
    const r = await runCli(['doctor'], { INTERLEAVE_DSN: undefined });
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/\[FAIL\] no DSN/);
    expect(r.out).toMatch(/init-db --compose/);
    expectFixes(r.out);
  });

  it('2. a remote host: refused, explained, password never printed (exit 3)', async () => {
    const r = await runCli(['doctor'], { INTERLEAVE_DSN: 'postgres://u:topsecret@db.example.com/interleave_x' });
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/\[FAIL\].*not local/);
    expect(r.out + r.err).not.toMatch(/topsecret/);
    expectFixes(r.out);
  });

  it('3. Postgres is not listening on that port: says so, suggests starting it (exit 2)', async () => {
    const u = new URL(dsn);
    u.port = '1';
    const r = await runCli(['doctor'], { INTERLEAVE_DSN: u.toString() });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/\[FAIL\] cannot connect/);
    expect(r.out).toMatch(/docker compose up -d/);
    expectFixes(r.out);
  });

  it('4. the database exists but was not made by init-db: names the marker table and the fix (exit 3)', async () => {
    const r = await runCli(['doctor'], { INTERLEAVE_DSN: noMarkerDsn });
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/\[FAIL\].*interleave_marker/);
    expect(r.out).toMatch(/init-db/);
    expectFixes(r.out);
  });

  it('5. a scenario whose project has no pg: names the directory and the install command (exit 2)', async () => {
    const r = await runCli(['doctor', join(lonely, 'app', 'scenario.mjs'), '--allow-dir', lonely]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/\[FAIL\] pg is not resolvable/);
    expect(r.out).toMatch(/npm install pg/);
    expectFixes(r.out);
  });

  it('6. a scenario that does not load: reports the loader message, not a stack (exit 2)', async () => {
    const r = await runCli(['doctor', join('test', 'no-such-scenario.mjs')]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/\[FAIL\] scenario/);
    expect(r.out).not.toMatch(/\n\s+at /);
    expectFixes(r.out);
  });

  it('7. a scenario whose listed table does not exist and which has no schema: says what to do (exit 2)', async () => {
    const r = await runCli(['doctor', join('test', 'fixtures', 'doctor', 'missing-table.mjs')]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/\[FAIL\] table "dr_missing" .*does not exist/);
    expect(r.out).toMatch(/schema/);
    expectFixes(r.out);
  });

  it('8. a good scenario is accepted by doctor (exit 0)', async () => {
    const r = await runCli(['doctor', seed('lost-update.mjs')]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\[ok\] scenario/);
  });

  it('9. production NODE_ENV is refused with the reason (exit 3)', async () => {
    const r = await runCli(['doctor'], { NODE_ENV: 'production' });
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/\[FAIL\].*NODE_ENV/);
    expectFixes(r.out);
  });
});
