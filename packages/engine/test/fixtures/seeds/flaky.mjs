import { makePool } from './lib.mjs';

/** Deliberately flaky: the invariant fails on every odd evaluation, so a violation never replays 3 of 3. */
globalThis.__flakyCalls = 0;
export default {
  name: 'deliberately flaky',
  tables: ['scratch'],
  schema: 'sql/scratch.sql',
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return () => pool.query('SELECT 1');
  },
  actors: { A: (q) => q(), B: (q) => q() },
  invariants: [{ name: 'flaky invariant', js: () => ({ ok: ++globalThis.__flakyCalls % 2 === 0, detail: 'fails on odd evaluations' }) }],
};
