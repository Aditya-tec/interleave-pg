import { makePool } from './lib.mjs';

export const name = 'lost update (read-modify-write)';
export function build({ safe = false, invariants = true } = {}) {
  return {
    name: safe ? 'lost update (atomic increment)' : name,
    tables: ['accounts'],
    schema: 'sql/accounts.sql',
    seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
    setup: async ({ dsn }) => {
      const pool = await makePool(dsn);
      return async (n) => {
        if (safe) {
          await pool.query('UPDATE accounts SET balance = balance + $1 WHERE id = 1', [n]);
        } else {
          const r = await pool.query('SELECT balance FROM accounts WHERE id = 1');
          await pool.query('UPDATE accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + n]);
        }
      };
    },
    actors: { A: (deposit) => deposit(10), B: (deposit) => deposit(10) },
    invariants: invariants ? [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }] : [],
  };
}
export default build();
