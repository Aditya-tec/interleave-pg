/*
 * SAFE (database-enforced): racy balance check, CHECK (balance >= 0) as the backstop.
 *
 * withdraw(80): SELECT balance; if balance >= 80, UPDATE balance = balance - 80 (relative, so no lost update). Both
 * actors can pass the pre-check on balance 100, but the second UPDATE would make it -60 and fails with SQLSTATE 23514
 * (check_violation, chk7_nonneg). The code catches exactly that code and returns 'insufficient'. Results are always
 * {ok, insufficient} and the balance is 20, identical to either serial order.
 * The tool SHOULD report clean. 23514 is an ordinary error code in the outcome (not a "database rejection" in the
 * DECISIONS sense), but here it is caught by the app, so no actor error is visible.
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'withdraw with a CHECK constraint backstop',
  tables: ['chk7_accounts'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO chk7_accounts (id, balance) VALUES (1, 100)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async () => {
      const r = await pool.query('SELECT balance FROM chk7_accounts WHERE id = 1');
      if (r.rows[0].balance < 80) return 'insufficient';
      try {
        await pool.query('UPDATE chk7_accounts SET balance = balance - 80 WHERE id = 1');
        return 'ok';
      } catch (e) {
        if (e.code === '23514') return 'insufficient';
        throw e;
      }
    };
  },
  actors: { A: (withdraw) => withdraw(), B: (withdraw) => withdraw() },
  invariants: [{ name: 'balance never negative', sql: 'SELECT balance >= 0 AS ok FROM chk7_accounts WHERE id = 1' }],
};
