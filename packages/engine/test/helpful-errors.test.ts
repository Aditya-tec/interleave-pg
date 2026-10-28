import { describe, it, expect } from 'vitest';
import { runCli, seed } from './cli-helpers.js';
import { testDsn } from './helpers.js';

/** A user who makes a common mistake gets one sentence saying what went wrong and one saying what to do, never a stack. */
const noStack = (s: string) => expect(s).not.toMatch(/\n\s+at \S+ \(|node:internal|\.ts:\d+:\d+/);

describe('helpful errors', () => {
  it('Postgres is not running: says where it tried and how to start it, points at doctor', async () => {
    const r = await runCli(['run', seed('lost-update.mjs')], { INTERLEAVE_DSN: 'postgres://u:p@127.0.0.1:1/interleave_x' });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/cannot connect to 127\.0\.0\.1:1/);
    expect(r.err).toMatch(/docker compose up -d/);
    expect(r.err).toMatch(/interleave-pg doctor/);
    noStack(r.err);
  });
  it('the database does not exist: says to run init-db', async () => {
    const u = new URL(await testDsn());
    u.pathname = '/interleave_does_not_exist';
    const r = await runCli(['run', seed('lost-update.mjs')], { INTERLEAVE_DSN: u.toString() });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/interleave_does_not_exist/);
    expect(r.err).toMatch(/init-db/);
    noStack(r.err);
  });
  it('wrong password: says so without printing it', async () => {
    const u = new URL(await testDsn());
    u.password = 'wrong-pw-123';
    const r = await runCli(['run', seed('lost-update.mjs')], { INTERLEAVE_DSN: u.toString() });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/password authentication failed/i);
    expect(r.err).toMatch(/INTERLEAVE_DSN/);
    expect(r.err).not.toContain('wrong-pw-123');
    noStack(r.err);
  });
  it('no DSN: says how to get one', async () => {
    const r = await runCli(['run', seed('lost-update.mjs')], { INTERLEAVE_DSN: undefined });
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/INTERLEAVE_DSN/);
    expect(r.err).toMatch(/init-db/);
  });
  it('a missing scenario file: names the path and says how to check the setup', async () => {
    const r = await runCli(['run', 'no-such-file.mjs']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/scenario file not found: no-such-file\.mjs/);
    noStack(r.err);
  });
  it('an unknown option: short message, the offending option, and a pointer to --help (not the full usage dump)', async () => {
    const r = await runCli(['run', seed('lost-update.mjs'), '--bogus']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--bogus/);
    expect(r.err).toMatch(/--help/);
    expect(r.err.split('\n').length).toBeLessThan(6);
  });
  it('an unknown command suggests the closest real one', async () => {
    const r = await runCli(['rnu', 'x.mjs']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/unknown command "rnu"/);
    expect(r.err).toMatch(/did you mean "run"/);
  });
  it('a scenario that throws on load reports its own message, not a stack', async () => {
    const r = await runCli(['run', seed('invalid-no-actors.mjs')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/invalid scenario/);
    noStack(r.err);
  });
});
