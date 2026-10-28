import { makePool } from './lib.mjs';

/** Two statements in flight at once inside one actor: not supported in v1, and the tool must say so. */
export default {
  name: 'parallel statements inside one actor',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async () => {
      await Promise.all([pool.query('SELECT balance FROM accounts WHERE id = 1'), pool.query('SELECT count(*) FROM accounts')]);
    };
  },
  actors: { A: (run) => run(), B: (run) => run() },
  invariants: [],
};
