import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialChooser } from '../src/choosers.js';
import { loadScenario } from '../src/loader.js';
import { createSession } from '../src/runner.js';
import { testDsn } from './helpers.js';

/**
 * Normal single-user behaviour: every in-scope corpus scenario (dev, held-out, human-added) must run to the end when its
 * actors run one after another, in either order, with no error and with every invariant holding. The races only
 * appear under concurrency; if this fails, the scenario itself is broken.
 */
const corpus = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'corpus');
const entries: { set: string; id: string; dir: string }[] = [];
for (const set of ['dev', 'heldout', 'heldout-human']) {
  const base = join(corpus, set);
  if (!existsSync(base)) continue;
  for (const id of readdirSync(base).filter((n) => !n.startsWith('_') && !n.startsWith('.')).sort()) {
    const dir = join(base, id);
    if (existsSync(join(dir, 'expected.json')) && existsSync(join(dir, 'scenario.mjs'))) entries.push({ set, id, dir });
  }
}

let dsn: string;
beforeAll(async () => { dsn = await testDsn(); });

describe('corpus scenarios behave in single-user (serial) use', () => {
  it('finds scenarios', () => { expect(entries.length).toBeGreaterThan(0); });
  for (const e of entries) {
    const expected = JSON.parse(readFileSync(join(e.dir, 'expected.json'), 'utf8'));
    if (expected.scope === 'out') continue;
    it(`${e.set}/${e.id}`, async () => {
      const { scenario, dir } = await loadScenario(join(e.dir, 'scenario.mjs'));
      const session = await createSession(scenario, { dsn, scenarioDir: dir });
      try {
        const ids = session.actorIds;
        for (const order of [ids, [...ids].reverse()]) {
          const r = await session.execute({ chooser: serialChooser(order) });
          expect(r.results.map((x) => x.status), `${order.join('')} statuses`).toEqual(ids.map(() => 'fulfilled'));
          expect(r.violations, `${order.join('')} invariants`).toEqual([]);
        }
      } finally {
        await session.close();
      }
    });
  }
});
