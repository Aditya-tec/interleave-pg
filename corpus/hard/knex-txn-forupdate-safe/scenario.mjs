/*
 * SAFE: no schedule can lose a deposit.
 *
 * deposit(10) = knex.transaction: SELECT balance ... FOR UPDATE, then UPDATE balance = read + 10. The row lock taken by
 * the SELECT is held until COMMIT, so a second deposit's SELECT FOR UPDATE blocks (a free switch) until the first one
 * has committed and then reads the new balance. The only overlap is "A holds the lock, B waits", which is equivalent to
 * the serial order A then B (or B then A). Result is always 120 and both actors return 'deposited'.
 */
import { makeKnex } from '../../_lib/lib-knex.mjs';

export default {
  name: 'knex transaction: deposit with SELECT FOR UPDATE',
  tables: ['kx2_wallets'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO kx2_wallets (id, balance) VALUES (1, 100)');
  },
  setup: async ({ dsn }) => {
    const knex = await makeKnex(dsn);
    return () =>
      knex.transaction(async (trx) => {
        const row = await trx('kx2_wallets').where({ id: 1 }).forUpdate().first('balance');
        await trx('kx2_wallets').where({ id: 1 }).update({ balance: row.balance + 10 });
        return 'deposited';
      });
  },
  actors: { A: (deposit) => deposit(), B: (deposit) => deposit() },
  invariants: [{ name: 'both deposits counted', sql: 'SELECT balance = 120 AS ok FROM kx2_wallets WHERE id = 1' }],
};
