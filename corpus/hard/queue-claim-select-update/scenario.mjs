/*
 * MINIMAL PREEMPTIONS: 1.   (work queue, two workers, two jobs)
 *
 * claim(): SELECT the first job with status 'new'; UPDATE it to 'running' by id (no status guard); INSERT a claim row
 * (stands in for "start processing"). Autocommit statements. Serial: one worker gets job 1, the other job 2.
 * Bug: A.SELECT (job 1) | (preempt A, UPDATE pending) B runs completely (also job 1) | (B done, free) A.UPDATE, A.INSERT.
 * Job 1 claimed twice, job 2 never. Min 1 (0 is serial).
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'queue claim: select then update',
  tables: ['qc_jobs', 'qc_claims'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query("INSERT INTO qc_jobs (id, status) VALUES (1, 'new'), (2, 'new')");
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async (worker) => {
      const r = await pool.query("SELECT id FROM qc_jobs WHERE status = 'new' ORDER BY id LIMIT 1");
      if (r.rows.length === 0) return null;
      const id = r.rows[0].id;
      await pool.query("UPDATE qc_jobs SET status = 'running' WHERE id = $1", [id]);
      await pool.query('INSERT INTO qc_claims (job_id, worker) VALUES ($1, $2)', [id, worker]);
      return id;
    };
  },
  actors: { A: (claim) => claim('A'), B: (claim) => claim('B') },
  invariants: [
    { name: 'a job is claimed at most once', sql: 'SELECT NOT EXISTS (SELECT 1 FROM qc_claims GROUP BY job_id HAVING count(*) > 1) AS ok' },
  ],
};
