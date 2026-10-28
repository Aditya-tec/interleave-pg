/*
 * HONEST LIMIT (scope: out): an actor waits on something that is not the database.
 *
 * Actor A reads a row, then waits 8 seconds on a timer (stands in for an HTTP call that was not stubbed), then writes.
 * The engine schedules only database statements; an actor that is RUNNING without reaching a gate for 3 s is reported
 * as stalled (spec 4.3, LIMITATIONS: "Non-database waits (timers, HTTP) trigger a stall error after 3 s; stub them").
 * Expected: an explicit "actor ... stalled outside the database; stub external calls" error, not a clean report.
 * Minimal preemptions: not applicable.
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'actor sleeps on a real timer between statements',
  tables: ['lim2_t'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO lim2_t (id, n) VALUES (1, 0)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return {
      slow: async () => {
        const r = await pool.query('SELECT n FROM lim2_t WHERE id = 1');
        await new Promise((resolve) => setTimeout(resolve, 8000)); // not the database, and not stubbed
        await pool.query('UPDATE lim2_t SET n = $1 WHERE id = 1', [r.rows[0].n + 1]);
        return 'ok';
      },
      fast: async () => {
        await pool.query('UPDATE lim2_t SET n = n + 1 WHERE id = 1');
        return 'ok';
      },
    };
  },
  actors: { A: (s) => s.slow(), B: (s) => s.fast() },
  invariants: [{ name: 'both increments counted', sql: 'SELECT n = 2 AS ok FROM lim2_t WHERE id = 1' }],
};
