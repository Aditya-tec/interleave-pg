/*
 * MINIMAL PREEMPTIONS: 1.   (two code paths take transaction-level advisory locks on different keys)
 *
 * deposit() locks key 1 (the account id); withdraw() locks hashtext('account:1'). Different keys never exclude each
 * other. Each path: BEGIN, lock, SELECT balance, UPDATE balance = read +/- n, COMMIT.
 * Serial: 100 + 50 - 30 = 120. Violation: A(deposit).BEGIN, lock, SELECT | (preempt A) B(withdraw) runs completely
 * (no blocking, other key; balance 70) | (B done, free) A.UPDATE writes 150. Min 1 (0 is serial).
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'advisory locks with mismatched keys',
  tables: ['adv2_accounts'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO adv2_accounts (id, balance) VALUES (1, 100)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    const change = (lockSql, delta) =>
      inTxn(pool, async (c) => {
        await c.query(lockSql);
        const r = await c.query('SELECT balance FROM adv2_accounts WHERE id = 1');
        await c.query('UPDATE adv2_accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + delta]);
        return 'done';
      });
    return {
      deposit: () => change('SELECT pg_advisory_xact_lock(1)', 50),
      withdraw: () => change("SELECT pg_advisory_xact_lock(hashtext('account:1'))", -30),
    };
  },
  actors: { A: (s) => s.deposit(), B: (s) => s.withdraw() },
  invariants: [{ name: 'deposit and withdrawal both applied', sql: 'SELECT balance = 120 AS ok FROM adv2_accounts WHERE id = 1' }],
};
