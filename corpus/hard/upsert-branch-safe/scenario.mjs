/*
 * SAFE: branching hit counter whose both branches are atomic.
 *
 * hit(): SELECT n; if a row exists UPDATE n = n + 1 (relative), else INSERT ... ON CONFLICT (page) DO UPDATE SET
 * n = hits6_counters.n + 1. The statement sequence depends on what the SELECT saw, but whichever branch runs, the
 * increment is atomic, so the final n is 2 and both return 'counted' in every schedule.
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'hit counter: branches that are each atomic',
  tables: ['hits6_counters'],
  schema: 'schema.sql',
  seed: async () => {},
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async () => {
      const r = await pool.query("SELECT n FROM hits6_counters WHERE page = 'home'");
      if (r.rows.length > 0) {
        await pool.query("UPDATE hits6_counters SET n = n + 1 WHERE page = 'home'");
      } else {
        await pool.query(
          "INSERT INTO hits6_counters (page, n) VALUES ('home', 1) ON CONFLICT (page) DO UPDATE SET n = hits6_counters.n + 1",
        );
      }
      return 'counted';
    };
  },
  actors: { A: (hit) => hit(), B: (hit) => hit() },
  invariants: [{ name: 'both hits counted', sql: "SELECT n = 2 AS ok FROM hits6_counters WHERE page = 'home'" }],
};
