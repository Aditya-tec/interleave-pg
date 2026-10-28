/*
 * MINIMAL PREEMPTIONS: 1.   (deadlock; the app does not retry the victim)
 *
 * transfer(from, to, 10) in a transaction: UPDATE from -10; UPDATE to +10; INSERT a transfer record; COMMIT.
 * A moves 1 -> 2, B moves 2 -> 1: opposite lock order. Postgres aborts one of them (40P01) and the code lets the error
 * escape, so only one transfer record exists. The rule broken: both requested transfers must be recorded.
 * Violation: A.BEGIN, A.UPDATE row 1 | (preempt A, still has statements) B.BEGIN, B.UPDATE row 2, B.UPDATE row 1
 * (blocks, free switch) -> A.UPDATE row 2 blocks -> deadlock, one victim. 0 preemptions is serial (no overlap), so
 * the minimum is 1.
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'transfers in opposite order deadlock and are not retried',
  tables: ['dl1_accounts', 'dl1_transfers'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO dl1_accounts (id, balance) VALUES (1, 100), (2, 100)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return (from, to) =>
      inTxn(pool, async (c) => {
        await c.query('UPDATE dl1_accounts SET balance = balance - 10 WHERE id = $1', [from]);
        await c.query('UPDATE dl1_accounts SET balance = balance + 10 WHERE id = $1', [to]);
        await c.query('INSERT INTO dl1_transfers (src, dst, amount) VALUES ($1, $2, 10)', [from, to]);
        return 'moved';
      });
  },
  actors: { A: (transfer) => transfer(1, 2), B: (transfer) => transfer(2, 1) },
  invariants: [{ name: 'both transfers recorded', sql: 'SELECT count(*) = 2 AS ok FROM dl1_transfers' }],
};
