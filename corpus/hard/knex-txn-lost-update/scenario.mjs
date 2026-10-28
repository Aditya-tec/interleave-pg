/*
 * MINIMAL PREEMPTIONS: 1.   (knex.transaction does not make read-modify-write safe under READ COMMITTED)
 *
 * deposit(10) = knex.transaction: SELECT balance, UPDATE balance = read + 10. Statements per actor: BEGIN, SELECT,
 * UPDATE, COMMIT. Bug: the SELECT takes no lock, the UPDATE writes an absolute value.
 * Serial 120. Violation: A.BEGIN, A.SELECT | (preempt A, UPDATE pending) B runs completely (balance 110) |
 * (B done, free) A.UPDATE writes 110, A.COMMIT. Final 110, a lost deposit. 1 preemption; 0 is serial, so min is 1.
 */
import { makeKnex } from '../../_lib/lib-knex.mjs';

export default {
  name: 'knex transaction: deposit read-modify-write',
  tables: ['kx1_wallets'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO kx1_wallets (id, balance) VALUES (1, 100)');
  },
  setup: async ({ dsn }) => {
    const knex = await makeKnex(dsn);
    return () =>
      knex.transaction(async (trx) => {
        const row = await trx('kx1_wallets').where({ id: 1 }).first('balance');
        await trx('kx1_wallets').where({ id: 1 }).update({ balance: row.balance + 10 });
        return 'deposited';
      });
  },
  actors: { A: (deposit) => deposit(), B: (deposit) => deposit() },
  invariants: [{ name: 'both deposits counted', sql: 'SELECT balance = 120 AS ok FROM kx1_wallets WHERE id = 1' }],
};
