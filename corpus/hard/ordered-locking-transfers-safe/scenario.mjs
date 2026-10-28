/*
 * SAFE: opposite transfers that lock both rows in id order (no deadlock possible).
 *
 * transfer(from, to, 10): BEGIN; SELECT ... WHERE id IN (from, to) ORDER BY id FOR UPDATE (takes both locks in a fixed
 * order, in one statement); two relative UPDATEs; INSERT the transfer record; COMMIT. A moves 1 -> 2, B moves 2 -> 1.
 * The second transaction blocks on its first lock statement while holding nothing, so no cycle can form. Both
 * transfers are always recorded, balances end 100/100.
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'opposite transfers with ordered row locks',
  tables: ['dl2_accounts', 'dl2_transfers'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO dl2_accounts (id, balance) VALUES (1, 100), (2, 100)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return (from, to) =>
      inTxn(pool, async (c) => {
        await c.query('SELECT id FROM dl2_accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE', [from, to]);
        await c.query('UPDATE dl2_accounts SET balance = balance - 10 WHERE id = $1', [from]);
        await c.query('UPDATE dl2_accounts SET balance = balance + 10 WHERE id = $1', [to]);
        await c.query('INSERT INTO dl2_transfers (src, dst, amount) VALUES ($1, $2, 10)', [from, to]);
        return 'moved';
      });
  },
  actors: { A: (transfer) => transfer(1, 2), B: (transfer) => transfer(2, 1) },
  invariants: [
    { name: 'both transfers recorded', sql: 'SELECT count(*) = 2 AS ok FROM dl2_transfers' },
    { name: 'money is conserved', sql: 'SELECT sum(balance) = 200 AS ok FROM dl2_accounts' },
  ],
};
