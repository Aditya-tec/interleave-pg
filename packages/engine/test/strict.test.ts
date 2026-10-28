import { describe, it, expect } from 'vitest';
import { runCli, seed } from './cli-helpers.js';

describe('--strict: what the engine cannot gate is an error, not a warning', () => {
  it('without --strict a LISTEN is passed through with a warning', async () => {
    const r = await runCli(['run', seed('strict-listen.mjs')]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/LISTEN is not gated/);
  });
  it('with --strict the same scenario stops with exit 2 and names the statement and the flag', async () => {
    const r = await runCli(['run', seed('strict-listen.mjs'), '--strict']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/UnsupportedError/);
    expect(r.err).toMatch(/LISTEN/);
    expect(r.err).toMatch(/--strict/);
  });
  it('statements outside any actor: a warning normally', async () => {
    const r = await runCli(['run', seed('strict-untracked.mjs')]);
    expect([0, 1]).toContain(r.code);
    expect(r.out).toMatch(/untracked statement outside any actor/);
  });
  it('statements outside any actor: exit 2 with --strict', async () => {
    const r = await runCli(['run', seed('strict-untracked.mjs'), '--strict']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/UnsupportedError/);
    expect(r.err).toMatch(/outside any actor/);
  });
  it('a clean scenario is unaffected by --strict', async () => {
    const plain = await runCli(['run', seed('lost-update-safe.mjs')]);
    const strict = await runCli(['run', seed('lost-update-safe.mjs'), '--strict']);
    expect(strict.code).toBe(plain.code);
    expect(strict.code).toBe(0);
  });
  it('--strict is accepted by replay-free forms only: it is listed in --help', async () => {
    const r = await runCli(['--help']);
    expect(r.out).toMatch(/--strict/);
  });
});
