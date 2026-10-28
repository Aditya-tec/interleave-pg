/*
 * MINIMAL PREEMPTIONS: 1.   (three actors, autocommit pg statements)
 *
 * Three workers each try to take one slot from a quota of 2 (check used < cap, add a grant row, write used + 1 back).
 * Statements per actor: SELECT used,cap -> INSERT grant -> UPDATE used (absolute value read earlier).
 * The invariant breaks only if all three grant (cap is 2), so one of them must decide on a stale `used`.
 * Lower bound: every serial order (0 preemptions) grants exactly two, so at least 1 preemption is needed.
 * A schedule with exactly 1: A runs completely (used = 1); B runs SELECT (reads used = 1, decides to grant);
 * the switch B -> C is the ONE preemption (B is still at a gate); C runs completely (reads 1, grants, writes used = 2);
 * C finishing is a free switch back to B, which grants too and writes used = 2. Three grants, cap 2.
 * (The switch A -> B is free because A has finished.)
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'quota: three workers take slots from a quota of two',
  tables: ['q3_quota', 'q3_grants'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO q3_quota (id, used, cap) VALUES (1, 0, 2)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 3);
    return async (worker) => {
      const q = await pool.query('SELECT used, cap FROM q3_quota WHERE id = 1');
      const { used, cap } = q.rows[0];
      if (used >= cap) return 'denied';
      await pool.query('INSERT INTO q3_grants (worker) VALUES ($1)', [worker]);
      await pool.query('UPDATE q3_quota SET used = $1 WHERE id = 1', [used + 1]);
      return 'granted';
    };
  },
  actors: {
    A: (take) => take('A'),
    B: (take) => take('B'),
    C: (take) => take('C'),
  },
  invariants: [
    { name: 'grants never exceed the cap', sql: 'SELECT (SELECT count(*) FROM q3_grants) <= (SELECT cap FROM q3_quota WHERE id = 1) AS ok' },
  ],
};
