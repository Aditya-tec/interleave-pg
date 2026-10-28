import knexFactory from 'knex';

export async function makeKnex(dsn) {
  const knex = knexFactory({ client: 'pg', connection: dsn, pool: { min: 0, max: 4 } });
  await Promise.all([knex.raw('select pg_sleep(0.05)'), knex.raw('select pg_sleep(0.05)')]);
  return knex;
}
