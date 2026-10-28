import { makePool } from './lib.mjs';

/** A real lost update whose rows also contain a fresh random id on every run: no serial reference can ever match. */
export default {
  name: 'lost update with random data in the tables',
  tables: ['nd_wallet', 'nd_audit'],
  schema: 'sql/nd-random.sql',
  seed: async (db) => { await db.query('INSERT INTO nd_wallet VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (n) => {
      const r = await pool.query('SELECT balance FROM nd_wallet WHERE id = 1');
      await pool.query('INSERT INTO nd_audit (token) VALUES ($1)', [Math.random().toString(36)]);
      await pool.query('UPDATE nd_wallet SET balance = $1 WHERE id = 1', [r.rows[0].balance + n]);
    };
  },
  actors: { A: (deposit) => deposit(10), B: (deposit) => deposit(10) },
  invariants: [{ name: 'both deposits counted', sql: 'SELECT balance = 120 AS ok FROM nd_wallet WHERE id = 1' }],
};
