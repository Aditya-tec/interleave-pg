import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { checkAllowDirs, resolveInside, writeReportFile } from '../src/safe-paths.js';
import { pkg, runCli, seed } from './cli-helpers.js';

const base = mkdtempSync(join(tmpdir(), 'interleave-sp-'));
const work = join(base, 'work'); // stands in for the working directory
const outside = join(base, 'outside');
const REPORT = JSON.stringify({ tool: 'interleave-pg', version: '0.0.0', scenario: 'x', target: { isolation: 'default' }, violations: [] });

function tryLink(target: string, path: string, type: 'dir' | 'file' | 'junction'): boolean {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (e: any) {
    if (e.code === 'EPERM' && process.platform === 'win32' && !process.env.CI) return false; // symlinks need a privilege on Windows
    throw e;
  }
}

beforeAll(() => {
  mkdirSync(work, { recursive: true });
  mkdirSync(outside, { recursive: true });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('--allow-dir values', () => {
  it('refuses a filesystem or drive root and the home directory', () => {
    expect(() => checkAllowDirs([parse(process.cwd()).root])).toThrow(/filesystem root/);
    expect(() => checkAllowDirs([homedir()])).toThrow(/home directory/);
  });
  it('refuses a directory that does not exist or is a file', () => {
    expect(() => checkAllowDirs([join(base, 'nope')])).toThrow(/does not exist/);
    writeFileSync(join(base, 'afile'), 'x');
    expect(() => checkAllowDirs([join(base, 'afile')])).toThrow(/not a directory/);
  });
  it('accepts an ordinary directory and returns its real path', () => {
    expect(checkAllowDirs([outside])).toHaveLength(1);
  });
  it('refuses a symlinked directory as an allowed directory', () => {
    const link = join(base, 'allow-link');
    if (!tryLink(outside, link, 'junction')) return;
    expect(() => checkAllowDirs([link])).toThrow(/symbolic link/);
  });
});

describe('writing a report (--json)', () => {
  it('writes atomically (temp file + rename in the same directory) and leaves no temp file behind', () => {
    const target = writeReportFile(join(work, 'out', 'r.json'), REPORT, [work]);
    expect(readFileSync(target, 'utf8')).toBe(REPORT);
    expect(readdirSync(join(work, 'out'))).toEqual(['r.json']);
  });
  it('overwrites an existing interleave-pg report', () => {
    writeFileSync(join(work, 'old.json'), REPORT);
    writeReportFile(join(work, 'old.json'), REPORT.replace('"x"', '"y"'), [work]);
    expect(readFileSync(join(work, 'old.json'), 'utf8')).toContain('"y"');
  });
  it('refuses to overwrite a file that is not an interleave-pg report (source files, package.json, notes)', () => {
    for (const [name, body] of [['package.json', '{"name":"mine"}'], ['notes.json', '{}'], ['broken.json', '{"tool":"interleave-pg"'], ['other.json', '{"tool":"something-else"}']] as const) {
      writeFileSync(join(work, name), body);
      expect(() => writeReportFile(join(work, name), REPORT, [work])).toThrow(/not an interleave-pg report/);
      expect(readFileSync(join(work, name), 'utf8')).toBe(body);
    }
  });
  it('requires a .json extension (cannot be aimed at .mjs, .ts, .sql ...)', () => {
    for (const name of ['scenario.mjs', 'x.ts', 'schema.sql', 'noext']) {
      expect(() => writeReportFile(join(work, name), REPORT, [work])).toThrow(/\.json/);
    }
  });
  it('refuses a directory as the target', () => {
    mkdirSync(join(work, 'adir.json'), { recursive: true });
    expect(() => writeReportFile(join(work, 'adir.json'), REPORT, [work])).toThrow(/directory/);
  });
  it('refuses traversal and absolute paths outside the allowed directories', () => {
    expect(() => writeReportFile(join(work, '..', 'outside', 'x.json'), REPORT, [work])).toThrow(/outside/);
    expect(() => writeReportFile(join(outside, 'x.json'), REPORT, [work])).toThrow(/outside/);
    expect(existsSync(join(outside, 'x.json'))).toBe(false);
  });
  it('an explicitly allowed directory works; its siblings do not', () => {
    writeReportFile(join(outside, 'ok.json'), REPORT, [work, outside]);
    expect(existsSync(join(outside, 'ok.json'))).toBe(true);
    expect(() => writeReportFile(join(base, 'sibling.json'), REPORT, [work, outside])).toThrow(/outside/);
  });
  it('refuses a symlinked (junction) directory that points outside, and a symlinked file', () => {
    const dirLink = join(work, 'escape');
    if (tryLink(outside, dirLink, 'junction')) {
      expect(() => writeReportFile(join(dirLink, 'pwn.json'), REPORT, [work])).toThrow(/symbolic link|outside/);
      expect(existsSync(join(outside, 'pwn.json'))).toBe(false);
    }
    const fileTarget = join(outside, 'victim.json');
    writeFileSync(fileTarget, REPORT);
    const fileLink = join(work, 'link.json');
    if (tryLink(fileTarget, fileLink, 'file')) {
      expect(() => writeReportFile(fileLink, REPORT.replace('"x"', '"pwned"'), [work])).toThrow(/symbolic link/);
      expect(readFileSync(fileTarget, 'utf8')).toBe(REPORT);
    }
  });
  it('a symlink inside the allowed tree that stays inside it is still refused (no symlinks at all)', () => {
    mkdirSync(join(work, 'real'), { recursive: true });
    const link = join(work, 'alias');
    if (!tryLink(join(work, 'real'), link, 'junction')) return;
    expect(() => writeReportFile(join(link, 'r.json'), REPORT, [work])).toThrow(/symbolic link/);
  });
});

describe('reading with resolveInside', () => {
  it('still rejects traversal for reads', () => {
    expect(() => resolveInside(join(work, '..', 'outside', 'x'), [work], 'report')).toThrow(/outside/);
  });
});

describe('through the CLI', () => {
  it('--allow-dir refuses a root and the home directory (exit 2)', async () => {
    expect((await runCli(['run', seed('lost-update-safe.mjs'), '--allow-dir', parse(process.cwd()).root])).code).toBe(2);
    expect((await runCli(['run', seed('lost-update-safe.mjs'), '--allow-dir', homedir()])).code).toBe(2);
  });
  it('--json will not overwrite package.json (exit 2) and leaves it untouched', async () => {
    const before = readFileSync(join(pkg, 'package.json'), 'utf8');
    const r = await runCli(['run', seed('lost-update.mjs'), '--json', 'package.json']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not an interleave-pg report/);
    expect(readFileSync(join(pkg, 'package.json'), 'utf8')).toBe(before);
  });
  it('--json refuses a scenario file as the target', async () => {
    const r = await runCli(['run', seed('lost-update.mjs'), '--json', join('test', 'fixtures', 'seeds', 'lost-update.mjs')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/\.json/);
  });
});
