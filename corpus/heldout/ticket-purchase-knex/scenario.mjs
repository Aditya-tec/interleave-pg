import { makeKnex } from '../../_lib/lib-knex.mjs';

// Pick the first free seat, then mark it sold and record the purchase.
export default {
  name: 'ticket purchase (find a free seat, then take it)',
  tables: ['purchases', 'seats'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO seats VALUES (1, NULL)'); },
  setup: async ({ dsn }) => {
    const knex = await makeKnex(dsn);
    return async (buyer) => {
      const seat = await knex('seats').whereNull('buyer').orderBy('id').first();
      if (!seat) return 'sold out';
      await knex('seats').where({ id: seat.id }).update({ buyer });
      await knex('purchases').insert({ seat_id: seat.id, buyer });
      return seat.id;
    };
  },
  actors: { A: (buy) => buy('ann'), B: (buy) => buy('bob') },
  invariants: [{ name: 'each seat sold at most once', sql: 'SELECT NOT EXISTS (SELECT 1 FROM purchases GROUP BY seat_id HAVING count(*) > 1) AS ok' }],
};
