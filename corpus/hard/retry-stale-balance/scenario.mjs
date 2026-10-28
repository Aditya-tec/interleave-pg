/*
 * MINIMAL PREEMPTIONS: 1.   (optimistic-lock retry loop; statement sequence depends on the schedule)
 *
 * deposit(10): read balance and version once; loop: UPDATE balance = read + 10, version = version + 1 WHERE version =
 * the one read; if 0 rows were updated, re-read ONLY the version (bug: the balance stays stale) and try again.
 * The version guard works, but the retry commits a stale balance, so the winner's deposit is overwritten.
 * Violation: A.SELECT (100, v0) | (preempt A, UPDATE pending) B runs completely (110, v1) | (B done, free) A.UPDATE
 * (version 0 no longer matches, 0 rows), A.SELECT version (1), A.UPDATE (balance 110, v1 matches) -> 110, not 120.
 * Min 1 (0 is serial). In schedules without overlap there is no retry branch at all.
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'optimistic retry loop re-reads the version but not the balance',
  tables: ['rt1_accounts'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO rt1_accounts (id, balance, version) VALUES (1, 100, 0)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async () => {
      const first = await pool.query('SELECT balance, version FROM rt1_accounts WHERE id = 1');
      const balance = first.rows[0].balance;
      let version = first.rows[0].version;
      for (let attempt = 0; attempt < 5; attempt++) {
        const u = await pool.query(
          'UPDATE rt1_accounts SET balance = $1, version = version + 1 WHERE id = 1 AND version = $2',
          [balance + 10, version],
        );
        if (u.rowCount === 1) return 'ok';
        version = (await pool.query('SELECT version FROM rt1_accounts WHERE id = 1')).rows[0].version;
      }
      return 'gave up';
    };
  },
  actors: { A: (deposit) => deposit(), B: (deposit) => deposit() },
  invariants: [{ name: 'both deposits counted', sql: 'SELECT balance = 120 AS ok FROM rt1_accounts WHERE id = 1' }],
};
