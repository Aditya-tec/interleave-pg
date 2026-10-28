import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { redactDsn } from '../src/guard.js';
import { pkg, runCli, seed } from './cli-helpers.js';
import { testDsn } from './helpers.js';

const PW = 'S3cr3t-pw!';

describe('S5: redactDsn removes the password from every DSN shape', () => {
  const cases: [string, string][] = [
    ['plain', `postgres://user:${PW}@127.0.0.1:5433/interleave_x`],
    ['postgresql scheme, upper case', `POSTGRESQL://user:${PW}@localhost/interleave_x`],
    ['percent-encoded characters', 'postgres://user:p%40ss%2Fw%3Ard@localhost/interleave_x'],
    ['@ and / inside the password', 'postgres://user:p@ss/word@localhost/interleave_x'],
    ['no user name', `postgres://:${PW}@localhost/interleave_x`],
    ['password in the query string', `postgres://user@localhost/interleave_x?password=${PW}&application_name=x`],
    ['keyword/value form', `host=localhost dbname=interleave_x user=u password=${PW} port=5433`],
    ['keyword/value form, quoted', `host=localhost password='${PW} with space' dbname=x`],
  ];
  for (const [name, dsn] of cases) {
    it(`redacts: ${name}`, () => {
      const out = redactDsn(dsn);
      const secret = name.includes('percent') ? 'p%40ss' : name.includes('@ and /') ? 'ss/word' : PW;
      expect(out).not.toContain(secret);
      expect(out).not.toContain('with space');
      expect(out).toContain('***');
    });
  }
  it('leaves a DSN without a password unchanged', () => {
    expect(redactDsn('postgres://user@localhost/interleave_x')).toBe('postgres://user@localhost/interleave_x');
  });
  it('redacts a DSN inside a longer message, more than once', () => {
    const m = `bad: postgres://u:${PW}@h/d and again postgres://v:${PW}@h/d`;
    expect(redactDsn(m)).not.toContain(PW);
  });
});

describe('S5: the password never reaches output or files', () => {
  let good: string;
  beforeAll(async () => { good = await testDsn(); });

  const everything = (r: { out: string; err: string }) => r.out + r.err;

  it('a refused remote target (run, doctor, replay, init-db)', async () => {
    const dsn = `postgres://u:${PW}@db.example.com/interleave_x`;
    for (const args of [['run', seed('lost-update.mjs')], ['doctor'], ['replay', 'nothing.json'], ['init-db']]) {
      const r = await runCli(args, { INTERLEAVE_DSN: dsn });
      expect(everything(r), args[0]).not.toContain(PW);
    }
  });
  it('a malformed DSN', async () => {
    const r = await runCli(['run', seed('lost-update.mjs')], { INTERLEAVE_DSN: `postgres://u:${PW}@[bad host/interleave_x` });
    expect(r.code).toBe(3);
    expect(everything(r)).not.toContain(PW);
  });
  it('a refused query parameter', async () => {
    const r = await runCli(['run', seed('lost-update.mjs')], { INTERLEAVE_DSN: `postgres://u:${PW}@localhost/interleave_x?hostaddr=10.0.0.1` });
    expect(r.code).toBe(3);
    expect(everything(r)).not.toContain(PW);
  });
  it('a failed connection to a local port with the wrong password', async () => {
    const u = new URL(good);
    u.password = PW;
    const r = await runCli(['doctor'], { INTERLEAVE_DSN: u.toString() });
    expect(everything(r)).not.toContain(PW);
    const r2 = await runCli(['run', seed('lost-update.mjs')], { INTERLEAVE_DSN: u.toString() });
    expect(everything(r2)).not.toContain(PW);
  });
  it('--dsn on the command line is redacted too', async () => {
    const r = await runCli(['run', seed('lost-update.mjs'), '--dsn', `postgres://u:${PW}@db.example.com/interleave_x`]);
    expect(r.code).toBe(3);
    expect(everything(r)).not.toContain(PW);
  });
  it('report.json and report.html contain no credentials, even when the DSN has a password', async () => {
    mkdirSync(join(pkg, 'test', '.tmp'), { recursive: true });
    const j = join('test', '.tmp', 's5.json');
    const h = join('test', '.tmp', 's5.html');
    const r = await runCli(['run', seed('lost-update.mjs'), '--json', j, '--html', h]);
    expect(r.code).toBe(1);
    for (const f of [j, h]) {
      expect(existsSync(join(pkg, f))).toBe(true);
      const text = readFileSync(join(pkg, f), 'utf8');
      expect(text).not.toMatch(/password/i);
      expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    }
    expect(readdirSync(join(pkg, 'test', '.tmp'))).toContain('s5.json');
  });
});
