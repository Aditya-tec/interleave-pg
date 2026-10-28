/*
 * SAFE: the transaction-level advisory lock covers read and write.
 *
 * deposit(10): BEGIN; SELECT pg_advisory_xact_lock(7003); SELECT balance; UPDATE balance = read + 10; COMMIT.
 * The lock is held until COMMIT/ROLLBACK, both actors use the same key. The second actor's lock statement blocks
 * (free switch) until the first commits; its SELECT then sees the committed balance. Only serial-equivalent outcomes
 * exist: 120. The blocked statement is visible in pg_blocking_pids (advisory locks are ordinary heavyweight locks).
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'deposit under pg_advisory_xact_lock',
  tables: ['adv3_accounts'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO adv3_accounts (id, balance) VALUES (1, 100)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return () =>
      inTxn(pool, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(7003)');
        const r = await c.query('SELECT balance FROM adv3_accounts WHERE id = 1');
        await c.query('UPDATE adv3_accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + 10]);
        return 'deposited';
      });
  },
  actors: { A: (deposit) => deposit(), B: (deposit) => deposit() },
  invariants: [{ name: 'both deposits counted', sql: 'SELECT balance = 120 AS ok FROM adv3_accounts WHERE id = 1' }],
};
