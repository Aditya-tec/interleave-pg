import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { pkg, runCli } from './cli-helpers.js';

const example = (f: string) => join(pkg, '..', '..', 'examples', 'gift-card', f);

describe('examples/gift-card (the README quickstart)', () => {
  it('finds the double redemption with no schedule given, and says how it happened', async () => {
    const r = await runCli(['run', example('scenario.mjs'), '--allow-dir', join(pkg, '..', '..')]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/CONFIRMED \(3\/3\) VIOLATION: never redeem more than the card holds - 120 redeemed from a card holding 100/);
    expect(r.out).toMatch(/read-modify-write/);
    expect(r.out).toMatch(/Coverage: explored \d+ schedules/);
  });
  it('the fixed version explores fewer schedules and reports no violation', async () => {
    const r = await runCli(['run', example('scenario-fixed.mjs'), '--allow-dir', join(pkg, '..', '..')]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/No violations found in \d+ schedules/);
  });
  it('doctor accepts the example scenario', async () => {
    const r = await runCli(['doctor', example('scenario.mjs'), '--allow-dir', join(pkg, '..', '..')]);
    expect(r.code).toBe(0);
  });
  it('the README quickstart block has at most 5 lines and ends with this example', async () => {
    const { readFileSync } = await import('node:fs');
    const readme = readFileSync(join(pkg, '..', '..', 'README.md'), 'utf8');
    const block = /## Quickstart[\s\S]*?```bash\r?\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';
    const lines = block.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines[lines.length - 1]).toMatch(/run examples\/gift-card\/scenario\.mjs$/);
  });
});

describe('clean clone', () => {
  it('the root build script relinks the interleave-pg bin (npm ci runs before dist exists, so npx would not find it)', async () => {
    const { readFileSync } = await import('node:fs');
    const root = JSON.parse(readFileSync(join(pkg, '..', '..', 'package.json'), 'utf8'));
    expect(root.scripts.build).toMatch(/npm rebuild interleave-pg/);
  });
});
