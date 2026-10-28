import { makePool } from './lib.mjs';

/** Three actors, correct code (atomic increment). */
export default {
  name: 'three actors, atomic increment',
  tables: ['ts_counter'],
  schema: 'sql/ts-counter.sql',
  seed: async (db) => { await db.query('INSERT INTO ts_counter VALUES (1, 0)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 3);
    return () => pool.query('UPDATE ts_counter SET n = n + 1 WHERE id = 1');
  },
  actors: { A: (bump) => bump(), B: (bump) => bump(), C: (bump) => bump() },
  invariants: [{ name: 'all three counted', sql: 'SELECT n = 3 AS ok FROM ts_counter WHERE id = 1' }],
};
