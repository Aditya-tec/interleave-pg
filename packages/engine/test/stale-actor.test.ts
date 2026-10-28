import { describe, it, expect, afterEach } from 'vitest';
import { loadScenario } from '../src/loader.js';
import { createSession, type Session } from '../src/runner.js';
import { seed } from './cli-helpers.js';
import { testDsn } from './helpers.js';

describe('a statement from an abandoned run never reaches a later run', () => {
  let session: Session | undefined;
  afterEach(async () => { await session?.close(); session = undefined; });

  it('a stalled actor that wakes up during the next run is rejected on its own, and the next run completes', async () => {
    const { scenario, dir } = await loadScenario(seed('stale-actor.mjs'));
    session = await createSession(scenario, { dsn: await testDsn(), scenarioDir: dir, stallTimeoutMs: 300 });
    // Run 1: A sits on a timer for 3.5 s; the engine reports the stall after 0.3 s and abandons the run.
    await expect(session.run(['A', 'B'])).rejects.toThrow(/stalled outside the database/);
    // Run 2 starts at once and lasts about 2.4 s; A's late UPDATE from run 1 arrives in the middle of it.
    // B runs all 8 statements first, so A waits at its first gate when the stale write arrives.
    const r = await session.run([...Array(8).fill('B'), ...Array(8).fill('A')]);
    expect(r.results.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
  }, 30_000);
});
