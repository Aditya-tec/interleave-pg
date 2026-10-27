import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, type Session } from '../src/runner.js';
import { testDsn } from './helpers.js';
// @ts-ignore plain .mjs fixture
import blocking from './fixtures/blocking.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let dsn: string;
let session: Session | undefined;
beforeAll(async () => { dsn = await testDsn(); });
afterEach(async () => { await session?.close(); session = undefined; });

const FORCED = 'AABBAABB'.split(''); // A: BEGIN, SELECT FOR UPDATE | B: BEGIN, SELECT FOR UPDATE (blocks) | A: UPDATE, COMMIT | B: UPDATE, COMMIT

describe('runnable sets are a pure function of the schedule (blocked actors)', () => {
  it('(i) while the blocker is paused at its gate the blocked actor stays not-runnable and the blocker is scheduled', async () => {
    session = await createSession(blocking, { dsn, scenarioDir: fixtures });
    const r = await session.run(FORCED);
    // decision index 4 is the first one after B's SELECT ... FOR UPDATE blocked on A
    expect(r.decisions[4]!.runnable).toEqual(['A']);
    expect(r.decisions[4]!.chosen).toBe('A');
    expect(r.decisions[5]!.runnable).toEqual(['A']); // A still has its COMMIT; B is still blocked until A commits
    expect(r.results.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
  });
  it('(ii) once the blocker commits, the blocked actor is runnable at the very next decision, every time', async () => {
    session = await createSession(blocking, { dsn, scenarioDir: fixtures });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = await session.run(FORCED);
      expect(r.decisions[6]!.runnable).toEqual(['B']); // A has finished, B's blocked statement completed
      seen.add(JSON.stringify(r.decisions.map((d) => [d.runnable, d.chosen, d.preemption])));
    }
    expect(seen.size).toBe(1);
  });
  it('a deadlock does not stall the controller', async () => {
    // @ts-ignore
    const deadlock = (await import('./fixtures/deadlock.mjs')).default;
    session = await createSession(deadlock, { dsn, scenarioDir: fixtures });
    const t0 = Date.now();
    const r = await session.run('AABBAB'.split(''));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.results.map((x) => x.error?.code).filter(Boolean)).toEqual(['40P01']);
  });
});

describe('controller unit test with a fake database (slow wake-up of a blocked statement)', () => {
  it('waits for a blocked statement whose blocker has released, so the runnable set does not depend on wake-up speed', async () => {
    const { Controller } = await import('../src/controller.js');
    const { als } = await import('../src/actor-context.js');

    const lockHeld = { value: true }; // A holds the lock B waits for
    const clientA = { processID: 101 };
    const clientB = { processID: 202 };
    const control = {
      // pg_blocking_pids(B) is [101] while A holds the lock, [] after it released
      query: async (_sql: string, values?: unknown[]) => ({
        rows: ((values?.[0] as number[]) ?? []).map((pid) => ({ pid, b: pid === 202 && lockHeld.value ? [101] : [] })),
      }),
    };
    let wakeB!: () => void;
    const bWake = new Promise<void>((r) => { wakeB = r; });

    const ctl = new Controller({
      chooser: (ctx) => (ctx.index === 0 ? 'A' : ctx.index === 1 ? 'B' : undefined), // A.BEGIN, B.SELECT (blocks), then free
      runId: 1,
      stallTimeoutMs: 3000,
      runTimeoutMs: 10000,
      prepareClient: async () => {},
      control,
      blockPollMs: 2,
    });
    const gate = (client: object, sql: string, exec: () => Promise<unknown>) =>
      ctl.gate(als.getStore()!.actor, client, { sql }, async () => {
        try { return { ok: true as const, result: await exec() }; } catch (error) { return { ok: false as const, error }; }
      });

    await ctl.run({
      A: async () => {
        await gate(clientA, 'BEGIN', async () => 'ok');
        await gate(clientA, 'COMMIT', async () => { lockHeld.value = false; wakeB(); return 'ok'; }); // lock released here
        await gate(clientA, 'SELECT 1 /* A after commit */', async () => 'ok');
      },
      B: async () => {
        // B's statement only completes 150 ms after A's COMMIT: a slow wake-up. Then B has one more statement.
        await gate(clientB, 'SELECT ... FOR UPDATE', async () => { await bWake; await new Promise((r) => setTimeout(r, 150)); return 'ok'; });
        await gate(clientB, 'SELECT 2 /* B after wake-up */', async () => 'ok');
      },
    });

    // d0 A.BEGIN, d1 B.SELECT (blocks), d2 A.COMMIT (B still blocked: runnable is only A), d3 is taken after the COMMIT.
    expect(ctl.decisions[2]!.runnable).toEqual(['A']);
    // Without the fix the controller decides while B's wake-up is still pending and sees only ['A'].
    expect(ctl.decisions[3]!.runnable).toEqual(['A', 'B']);
    expect(ctl.results.get('B')!.status).toBe('fulfilled');
  });
});
