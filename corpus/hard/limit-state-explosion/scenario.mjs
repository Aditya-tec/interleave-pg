/*
 * HONEST LIMIT (scope: out): state explosion. Four actors, six autocommit statements each (24 statements).
 *
 * Every statement is an atomic relative increment of one shared counter, so the code is correct and every schedule
 * ends at 24. The number of schedules within just 1..3 preemptions is far above the default 2000 schedules (and the
 * serial reference runs need 24 orders), so the search cannot finish: it must stop by the schedule budget or the time
 * budget (120 s) and its coverage statement must say "exhaustive within bound: no" together with the reason it
 * stopped, never a bare "no violations".
 * Minimal preemptions: not applicable (safe code).
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'four actors with six statements each',
  tables: ['lim4_t'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO lim4_t (id, n) VALUES (1, 0)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 4);
    return async () => {
      for (let i = 0; i < 6; i++) await pool.query('UPDATE lim4_t SET n = n + 1 WHERE id = 1');
      return 'ok';
    };
  },
  actors: { A: (run) => run(), B: (run) => run(), C: (run) => run(), D: (run) => run() },
  invariants: [{ name: 'all increments counted', sql: 'SELECT n = 24 AS ok FROM lim4_t WHERE id = 1' }],
};
