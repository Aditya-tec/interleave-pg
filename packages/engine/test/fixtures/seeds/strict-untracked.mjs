import { makePool } from './lib.mjs';

/** A timer started in setup() (outside any actor) keeps querying while the actors run: untracked statements. */
export default {
  name: 'strict: statements outside any actor',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    const timer = setInterval(() => { pool.query('SELECT 1').catch(() => {}); }, 1);
    timer.unref();
    return async (n) => {
      await new Promise((r) => setTimeout(r, 30)); // lets the timer fire while the actors run
      await pool.query('UPDATE accounts SET balance = balance + $1 WHERE id = 1', [n]);
    };
  },
  actors: { A: (deposit) => deposit(10), B: (deposit) => deposit(10) },
  invariants: [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }],
};
