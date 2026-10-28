import { inTxn, makePool } from '../../_lib/lib.mjs';

// Two workers, two pending jobs: each claims the next job that nobody else holds (FOR UPDATE SKIP LOCKED).
export default {
  name: 'job queue claim (SKIP LOCKED), two jobs',
  tables: ['claims', 'jobs'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO jobs VALUES (1, 'pending'), (2, 'pending')"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return (worker) =>
      inTxn(pool, async (c) => {
        const next = await c.query("SELECT id FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
        if (next.rowCount === 0) return null;
        const id = next.rows[0].id;
        await c.query("UPDATE jobs SET status = 'running' WHERE id = $1", [id]);
        await c.query('INSERT INTO claims (job_id, worker) VALUES ($1, $2)', [id, worker]);
        return id;
      });
  },
  actors: { A: (claim) => claim('worker-a'), B: (claim) => claim('worker-b') },
  invariants: [
    { name: 'a job is claimed by at most one worker', sql: 'SELECT NOT EXISTS (SELECT 1 FROM claims GROUP BY job_id HAVING count(*) > 1) AS ok' },
    { name: 'both workers got a job', sql: 'SELECT count(*) = 2 AS ok FROM claims' },
  ],
};
