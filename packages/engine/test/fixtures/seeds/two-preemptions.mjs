import { makePool } from './lib.mjs';

/** Synthetic: violated only by strictly alternating schedules, so it needs exactly 2 preemptions. */
export default {
  name: 'needs exactly two preemptions',
  tables: ['log'],
  schema: 'sql/log.sql',
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return (first, second) =>
      pool.query('INSERT INTO log (tag) VALUES ($1)', [first]).then(() => pool.query('INSERT INTO log (tag) VALUES ($1)', [second]));
  },
  actors: { A: (write) => write('a1', 'a2'), B: (write) => write('b1', 'b2') },
  invariants: [
    {
      name: 'log is never strictly alternating',
      sql: "SELECT coalesce(string_agg(tag, ',' ORDER BY seq) NOT IN ('a1,b1,a2,b2', 'b1,a1,b2,a2'), true) AS ok FROM log",
    },
  ],
};
