import { makePool } from '../../_lib/lib.mjs';

// Two statements in flight at once inside one actor (Promise.all): not supported in v1.
export default {
  name: 'limit: parallel statements inside one actor',
  tables: ['accounts'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async () => {
      const [r] = await Promise.all([pool.query('SELECT balance FROM accounts WHERE id = 1'), pool.query('SELECT count(*) FROM accounts')]);
      await pool.query('UPDATE accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + 10]);
    };
  },
  actors: { A: (deposit) => deposit(), B: (deposit) => deposit() },
  invariants: [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }],
};
