/*
 * MINIMAL PREEMPTIONS: 1.   (data-dependent control flow: the statement sequence changes with the schedule)
 *
 * Page-hit counter written as "if a row exists, UPDATE n = n + 1, else INSERT a first row". The table has no unique key
 * on page (a forgotten constraint). Autocommit statements: SELECT, then UPDATE or INSERT.
 * Serial: A inserts (n = 1), B sees the row and updates (n = 2): one row. If B's SELECT runs after A's INSERT the
 * second actor takes the UPDATE branch, otherwise the INSERT branch.
 * Bug: both SELECTs see no row, both INSERT: two rows for the page. Needs A.sel | (preempt A, INSERT pending) B.sel,
 * B.ins | (B done, free) A.ins. One preemption, and 0 is serial, so the minimum is 1.
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'hit counter: SELECT then INSERT-or-UPDATE without a unique key',
  tables: ['hits5_counters'],
  schema: 'schema.sql',
  seed: async () => {},
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async () => {
      const r = await pool.query("SELECT n FROM hits5_counters WHERE page = 'home'");
      if (r.rows.length > 0) {
        await pool.query("UPDATE hits5_counters SET n = n + 1 WHERE page = 'home'");
      } else {
        await pool.query("INSERT INTO hits5_counters (page, n) VALUES ('home', 1)");
      }
      return 'counted';
    };
  },
  actors: { A: (hit) => hit(), B: (hit) => hit() },
  invariants: [{ name: 'one counter row per page', sql: "SELECT count(*) <= 1 AS ok FROM hits5_counters WHERE page = 'home'" }],
};
