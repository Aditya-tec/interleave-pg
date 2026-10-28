import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'eval', 'check-gates.mjs');
const gates = { 'recall >= 90%': true, 'false positives == 0': true, 'confirmation 100%': true };

/** A results file with `hits` buggy scenarios found and the given extra rows. */
function results(extra: object[]): string {
  const rows = [
    ...Array.from({ length: 13 }, (_, i) => ({ id: `b${i}`, scope: 'in', outcome: 'hit' })),
    ...extra,
  ];
  const f = join(mkdtempSync(join(tmpdir(), 'gates-')), 'r.json');
  writeFileSync(f, JSON.stringify({ summary: { gates, runtimeMedianMs: 1, runtimeP95Ms: 1 }, rows }));
  return f;
}
const check = (file: string, ...flags: string[]) => spawnSync(process.execPath, [script, file, ...flags], { encoding: 'utf8' });

describe('check-gates --every-scenario (the regression check for the adversarial dev set)', () => {
  it('passes when every scenario came out as expected', () => {
    const r = check(results([{ id: 'ok', scope: 'in', outcome: 'hit' }, { id: 's', scope: 'in', outcome: 'clean' }, { id: 'l', scope: 'out', outcome: 'limit-ok' }]), '--every-scenario');
    expect(r.status).toBe(0);
  });

  it('fails on one missed buggy scenario even though recall is still above 90% (13 of 14 = 92.9%)', () => {
    const f = results([{ id: 'queue-claim', scope: 'in', outcome: 'miss' }]);
    expect(check(f).status).toBe(0); // the ordinary gates do not see it
    const r = check(f, '--every-scenario');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/queue-claim/);
  });

  it('fails on a flagged safe scenario or a limit scenario without its message', () => {
    expect(check(results([{ id: 'fp', scope: 'in', outcome: 'false-positive' }]), '--every-scenario').status).toBe(1);
    expect(check(results([{ id: 'lim', scope: 'out', outcome: 'limit-fail' }]), '--every-scenario').status).toBe(1);
  });
});
