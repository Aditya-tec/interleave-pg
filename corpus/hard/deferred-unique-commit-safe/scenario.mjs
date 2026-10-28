/*
 * SAFE (database-enforced): DEFERRABLE INITIALLY DEFERRED unique constraint checked at COMMIT.
 *
 * assign(worker): BEGIN; SELECT count of assignments for task 1; if > 0 return 'taken'; INSERT assignment; COMMIT.
 * The check-then-insert is racy, and with a deferred constraint the duplicate is not even noticed by the INSERT: the
 * loser's COMMIT fails with SQLSTATE 23505 (unique_violation, def8_one_worker); the helper then sends ROLLBACK (a no-op
 * after a failed COMMIT) and the actor rejects with 23505. At most one assignment exists. The tool SHOULD report
 * clean (23505 is a database rejection per DECISIONS) with an informational note. Note the rejection is raised by the
 * COMMIT statement, not by the INSERT.
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'task assignment backed by a deferred unique constraint',
  tables: ['def8_assign'],
  schema: 'schema.sql',
  seed: async () => {},
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return (worker) =>
      inTxn(pool, async (c) => {
        const r = await c.query('SELECT count(*)::int AS n FROM def8_assign WHERE task = 1');
        if (r.rows[0].n > 0) return 'taken';
        await c.query('INSERT INTO def8_assign (task, worker) VALUES (1, $1)', [worker]);
        return 'assigned';
      });
  },
  actors: { A: (assign) => assign('ann'), B: (assign) => assign('bob') },
  invariants: [{ name: 'one worker per task', sql: 'SELECT count(*) <= 1 AS ok FROM def8_assign WHERE task = 1' }],
};
