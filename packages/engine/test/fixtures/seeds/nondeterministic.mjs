import { makePool } from './lib.mjs';

/** Lost update, plus a statement whose parameter is random: replays see a different statement sequence. */
export default {
  name: 'lost update with random parameters',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (n) => {
      await pool.query('SELECT $1::text AS noise', [String(Math.random())]);
      const r = await pool.query('SELECT balance FROM accounts WHERE id = 1');
      await pool.query('UPDATE accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + n]);
    };
  },
  actors: { A: (deposit) => deposit(10), B: (deposit) => deposit(10) },
  invariants: [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }],
};
