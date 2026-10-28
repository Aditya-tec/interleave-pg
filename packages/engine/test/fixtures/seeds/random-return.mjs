import { makePool } from './lib.mjs';

/** Correct code whose actors return a random value: the per-actor result differs on every run. */
export default {
  name: 'actors return random values',
  tables: ['nd_wallet'],
  schema: 'sql/nd-return.sql',
  seed: async (db) => { await db.query('INSERT INTO nd_wallet VALUES (1, 0)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async () => {
      await pool.query('UPDATE nd_wallet SET balance = balance + 1 WHERE id = 1');
      return Math.random();
    };
  },
  actors: { A: (bump) => bump(), B: (bump) => bump() },
  invariants: [{ name: 'both bumps counted', sql: 'SELECT balance = 2 AS ok FROM nd_wallet WHERE id = 1' }],
};
