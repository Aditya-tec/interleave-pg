import { makePool } from './lib.mjs';

/** A safe increment whose actors also issue LISTEN, which interleave-pg cannot gate. */
export default {
  name: 'strict: LISTEN inside an actor',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (n) => {
      await pool.query('LISTEN interleave_strict_test');
      await pool.query('UPDATE accounts SET balance = balance + $1 WHERE id = 1', [n]);
    };
  },
  actors: { A: (deposit) => deposit(10), B: (deposit) => deposit(10) },
  invariants: [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }],
};
