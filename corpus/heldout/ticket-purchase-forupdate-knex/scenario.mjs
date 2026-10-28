import { makeKnex } from '../../_lib/lib-knex.mjs';

// Same as ticket-purchase-knex, but the seat is picked and taken inside one transaction with a row lock.
export default {
  name: 'ticket purchase (transaction with FOR UPDATE)',
  tables: ['purchases', 'seats'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO seats VALUES (1, NULL)'); },
  setup: async ({ dsn }) => {
    const knex = await makeKnex(dsn);
    return (buyer) =>
      knex.transaction(async (trx) => {
        const seat = await trx('seats').whereNull('buyer').orderBy('id').forUpdate().first();
        if (!seat) return 'sold out';
        await trx('seats').where({ id: seat.id }).update({ buyer });
        await trx('purchases').insert({ seat_id: seat.id, buyer });
        return seat.id;
      });
  },
  actors: { A: (buy) => buy('ann'), B: (buy) => buy('bob') },
  invariants: [{ name: 'each seat sold at most once', sql: 'SELECT NOT EXISTS (SELECT 1 FROM purchases GROUP BY seat_id HAVING count(*) > 1) AS ok' }],
};
