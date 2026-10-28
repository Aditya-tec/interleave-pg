#!/usr/bin/env node
// Serial single-user sanity check for the externally authored held-out scenarios. It does NOT explore interleavings:
// each scenario's actors run one after another (A then B, and B then A) and the results are compared with the
// serial behaviour the author listed. Needs INTERLEAVE_DSN (local throwaway database).
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = (f) => import(pathToFileURL(join(root, 'packages', 'engine', 'dist', f)).href);
const { createSession } = await dist('runner.js');
const { loadScenario } = await dist('loader.js');
const { serialChooser } = await dist('choosers.js');
const pg = (await import(pathToFileURL(join(root, 'node_modules', 'pg', 'lib', 'index.js')).href)).default;

const dsn = process.env.INTERLEAVE_DSN;
if (!dsn) throw new Error('set INTERLEAVE_DSN');

// What the author said serial runs must look like. `first` is the result of whichever actor runs first.
const EXPECT = {
  'leave-balance-overdraw': { first: { approved: true }, second: { approved: false }, state: ['SELECT days_left AS v FROM leave_balances WHERE employee_id = 1', 2], label: 'balance 2' },
  'retried-job-double-send': { first: { sent: true }, second: { skipped: true }, state: ['SELECT count(*)::int AS v FROM outbox', 1], label: 'outbox rows 1' },
  'webhook-credit-before-dedupe': { first: { applied: true }, second: { duplicate: true }, state: ['SELECT credits AS v FROM accounts WHERE id = 1', 10], label: 'credits 10' },
  'seat-hold-atomic-update': { first: { booked: true }, second: { booked: false }, state: ['SELECT (holder IS NOT NULL)::int AS v FROM seats WHERE id = 12', 1], label: 'seat held' },
  'wallet-optimistic-version': { first: { ok: true }, second: { ok: false }, state: ['SELECT balance AS v FROM wallets WHERE id = 1', 40], label: 'balance 40' },
};

let failed = false;
for (const [id, exp] of Object.entries(EXPECT)) {
  const { scenario, dir } = await loadScenario(join(root, 'corpus', 'heldout-human', id, 'scenario.mjs'));
  const session = await createSession(scenario, { dsn, scenarioDir: dir });
  try {
    for (const order of [['A', 'B'], ['B', 'A']]) {
      const r = await session.execute({ chooser: serialChooser(order) });
      const by = Object.fromEntries(r.results.map((x) => [x.actor, x.status === 'fulfilled' ? x.value : { error: x.error?.message }]));
      const c = new pg.Client(dsn);
      await c.connect();
      const v = (await c.query(exp.state[0])).rows[0].v;
      await c.end();
      const ok =
        JSON.stringify(by[order[0]]) === JSON.stringify(exp.first) &&
        JSON.stringify(by[order[1]]) === JSON.stringify(exp.second) &&
        v === exp.state[1] &&
        r.violations.length === 0;
      if (!ok) failed = true;
      console.log(`${ok ? 'ok  ' : 'DIFF'} ${id} ${order.join(',')}: first=${JSON.stringify(by[order[0]])} second=${JSON.stringify(by[order[1]])} ${exp.label}: got ${v}; invariants violated: ${r.violations.length}`);
    }
  } catch (e) {
    failed = true;
    console.log(`ERR  ${id}: ${e.name}: ${e.message.split('\n')[0]}`);
  } finally {
    await session.close();
  }
}
console.log(failed ? '\nSERIAL RESULTS DIFFER FROM THE AUTHOR\'S LIST' : '\nall serial results match the author\'s list');
process.exit(failed ? 1 : 0);
