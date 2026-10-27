import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseReport } from '../src/report.js';
import { resolveInside } from '../src/safe-paths.js';
import { pkg, runCli, seed } from './cli-helpers.js';

const tmp = join(pkg, 'test', '.tmp', 'replay');
const rel = (f: string) => join('test', '.tmp', 'replay', f);
const good = () => ({
  tool: 'interleave-pg',
  version: '0.0.0',
  scenario: 'x',
  scenarioFile: 'test/fixtures/seeds/lost-update.mjs',
  target: { host: '127.0.0.1', port: 5433, db: 'interleave_test', isolation: 'default' },
  violations: [{ id: 'v1', kind: 'VIOLATION', invariant: 'both deposits applied', status: 'CONFIRMED', schedule: ['A', 'B', 'B', 'A'], fingerprint: 'a'.repeat(64) }],
});

beforeAll(() => { rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true }); });

describe('S10: saved reports are untrusted input (schema validation, in process)', () => {
  it('accepts a well-formed report and returns only the fields it needs', () => {
    const r = parseReport(JSON.stringify({ ...good(), extra: { evil: true } }));
    expect(r.violations[0]!.schedule).toEqual(['A', 'B', 'B', 'A']);
    expect((r as any).extra).toBeUndefined();
  });
  const bad: [string, (g: any) => void][] = [
    ['wrong tool', (g) => { g.tool = 'other'; }],
    ['no violations array', (g) => { delete g.violations; }],
    ['schedule entry with shell characters', (g) => { g.violations[0].schedule = ['A;rm -rf /']; }],
    ['schedule entry that is not a string', (g) => { g.violations[0].schedule = [1]; }],
    ['schedule far too long', (g) => { g.violations[0].schedule = Array(6000).fill('A'); }],
    ['bad fingerprint', (g) => { g.violations[0].fingerprint = 'zz'; }],
    ['bad kind', (g) => { g.violations[0].kind = 'EXPLOIT'; }],
    ['bad isolation', (g) => { g.target.isolation = 'chaos'; }],
    ['scenarioFile is not a string', (g) => { g.scenarioFile = { a: 1 }; }],
    ['too many violations', (g) => { g.violations = Array(80).fill(g.violations[0]); }],
  ];
  for (const [name, mutate] of bad) {
    it(`rejects: ${name}`, () => {
      const g: any = good();
      mutate(g);
      expect(() => parseReport(JSON.stringify(g))).toThrow(/invalid report/);
    });
  }
  it('rejects non-JSON and oversize input', () => {
    expect(() => parseReport('not json')).toThrow(/invalid report/);
    expect(() => parseReport(' '.repeat(2 * 1024 * 1024))).toThrow(/too large/);
  });
  it('does not pollute prototypes through __proto__ keys and never evaluates anything', () => {
    const text = JSON.stringify(good()).replace('"tool"', '"__proto__":{"polluted":true},"tool"');
    parseReport(text);
    expect(({} as any).polluted).toBeUndefined();
  });
});

describe('S10: path checks', () => {
  it('resolves paths inside the working directory and refuses everything else', () => {
    expect(resolveInside(join('test', 'cli.test.ts'), [pkg], 'file')).toContain('cli.test.ts');
    expect(() => resolveInside(join('..', '..', 'package.json'), [pkg], 'file')).toThrow(/outside/);
    expect(() => resolveInside('/etc/passwd', [pkg], 'file')).toThrow(/outside/);
    // A drive-letter path is only absolute on Windows; on Linux "C:\Windows\win.ini" is an ordinary relative file name.
    if (process.platform === 'win32') expect(() => resolveInside('C:\\Windows\\win.ini', [pkg], 'file')).toThrow(/outside/);
    else expect(() => resolveInside('/usr/bin/env', [pkg], 'file')).toThrow(/outside/);
    expect(resolveInside(join('..', '..', 'package.json'), [pkg, join(pkg, '..', '..')], 'file')).toContain('package.json');
  });
});

describe('replay command', () => {
  it('re-runs the saved schedule 3 times: reproduced 3/3, exit 1', async () => {
    const saved = rel('lost-update.json');
    expect((await runCli(['run', seed('lost-update.mjs'), '--json', saved])).code).toBe(1);
    const r = await runCli(['replay', saved]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Reproduced 3\/3/);
    expect(r.out).toMatch(/both deposits applied/);
  });
  it('--violation selects a finding; an unknown id is a usage error (exit 2)', async () => {
    const saved = rel('lost-update.json');
    expect((await runCli(['replay', saved, '--violation', 'v1'])).code).toBe(1);
    expect((await runCli(['replay', saved, '--violation', 'v99'])).code).toBe(2);
  });
  it('after a fix the same schedule is not reproduced (exit 0), and the wording does not claim a proof', async () => {
    const saved = rel('lost-update.json');
    const j = JSON.parse(readFileSync(join(pkg, saved), 'utf8'));
    j.scenarioFile = 'test/fixtures/seeds/lost-update-safe.mjs';
    writeFileSync(join(pkg, rel('fixed.json')), JSON.stringify(j));
    const r = await runCli(['replay', rel('fixed.json')]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Reproduced 0\/3/);
    expect(r.out).toMatch(/does not prove a fix/);
    expect(r.out).not.toMatch(/no race conditions?/i);
  });
  it('refuses a report outside the working directory unless --allow-dir names it', async () => {
    const saved = join(pkg, rel('lost-update.json'));
    const other = join(pkg, '..', '..', 'docs');
    const r = await runCli(['replay', saved], {}, other);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/outside/);
    const ok = await runCli(['replay', saved, '--allow-dir', pkg], {}, other);
    expect(ok.err).not.toMatch(/outside/);
  });
  it('refuses a scenario path that escapes the directory (exit 2)', async () => {
    const j = JSON.parse(readFileSync(join(pkg, rel('lost-update.json')), 'utf8'));
    j.scenarioFile = '../../package.json';
    writeFileSync(join(pkg, rel('escape.json')), JSON.stringify(j));
    const r = await runCli(['replay', rel('escape.json')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/outside/);
    j.scenarioFile = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
    writeFileSync(join(pkg, rel('abs.json')), JSON.stringify(j));
    expect((await runCli(['replay', rel('abs.json')])).code).toBe(2);
  });
  it('rejects malformed and oversize files (exit 2) without running anything', async () => {
    writeFileSync(join(pkg, rel('bad.json')), '{"tool":"interleave-pg"');
    expect((await runCli(['replay', rel('bad.json')])).code).toBe(2);
    writeFileSync(join(pkg, rel('big.json')), ' '.repeat(3 * 1024 * 1024));
    const r = await runCli(['replay', rel('big.json')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/too large/);
  });
  it('replay goes through the guard too (exit 3)', async () => {
    const r = await runCli(['replay', rel('lost-update.json')], { INTERLEAVE_DSN: 'postgres://u:topsecret@db.example.com/interleave_x' });
    expect(r.code).toBe(3);
    expect(r.err + r.out).not.toMatch(/topsecret/);
  });
});
