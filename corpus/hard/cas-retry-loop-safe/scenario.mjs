/*
 * SAFE: optimistic-lock retry loop done right.
 *
 * deposit(10): loop: SELECT balance, version; UPDATE balance = read + 10, version = version + 1 WHERE version = read;
 * if 0 rows were updated, start the whole loop body again (re-read both). A concurrent write bumps the version, so a
 * stale UPDATE matches nothing and is retried with fresh data. At most one retry with two actors. Result is 120 and both
 * return 'ok' in every schedule; the statement sequence differs between schedules (retry or not).
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'optimistic retry loop that re-reads everything',
  tables: ['cas2_accounts'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO cas2_accounts (id, balance, version) VALUES (1, 100, 0)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const r = await pool.query('SELECT balance, version FROM cas2_accounts WHERE id = 1');
        const { balance, version } = r.rows[0];
        const u = await pool.query(
          'UPDATE cas2_accounts SET balance = $1, version = version + 1 WHERE id = 1 AND version = $2',
          [balance + 10, version],
        );
        if (u.rowCount === 1) return 'ok';
      }
      return 'gave up';
    };
  },
  actors: { A: (deposit) => deposit(), B: (deposit) => deposit() },
  invariants: [{ name: 'both deposits counted', sql: 'SELECT balance = 120 AS ok FROM cas2_accounts WHERE id = 1' }],
};
