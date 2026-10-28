/*
 * HONEST LIMIT (scope: out): parallel statements inside one actor.
 *
 * Actor A fires a read and a write at the same time with Promise.all (two pool clients, two statements in flight at
 * once). Spec 4.2 / 8.1 / DECISIONS: this is unsupported and must abort the run with an explicit UnsupportedError
 * ("parallel statements within one actor"), not produce a clean report. There is a real race hiding in it (the pair
 * runs in no defined order), which the tool cannot explore.
 * Minimal preemptions: not applicable (the scenario cannot be explored).
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'Promise.all of two statements inside one actor',
  tables: ['lim1_t'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO lim1_t (id, n) VALUES (1, 0)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 3);
    return {
      pair: async () => {
        const [r] = await Promise.all([
          pool.query('SELECT n FROM lim1_t WHERE id = 1'),
          pool.query('UPDATE lim1_t SET n = n + 1 WHERE id = 1'),
        ]);
        return r.rows[0].n;
      },
      plain: async () => {
        await pool.query('UPDATE lim1_t SET n = n + 1 WHERE id = 1');
        return 'ok';
      },
    };
  },
  actors: { A: (s) => s.pair(), B: (s) => s.plain() },
  invariants: [{ name: 'counter at least 2', sql: 'SELECT n >= 2 AS ok FROM lim1_t WHERE id = 1' }],
};
