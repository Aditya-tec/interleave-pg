/*
 * SAFE: FOR UPDATE SKIP LOCKED queue claim.
 *
 * claim(): BEGIN; SELECT id ... WHERE status = 'new' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED; if none return null;
 * UPDATE status = 'running'; INSERT claim row; COMMIT. Two jobs, two workers.
 * A worker either locks job 1, or finds it locked (skips to job 2), or finds it already 'running' (re-check after the
 * lock wait, skips to job 2). The two workers never get the same job, and each always gets one. Outcomes: {A:1,B:2} or
 * {A:2,B:1}, both equal to a serial order. Note that the schedule changes WHICH job a worker returns (spec section 8.8:
 * legitimate differences); the multiset of outcomes is always a serial one.
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'queue claim with FOR UPDATE SKIP LOCKED',
  tables: ['qs_jobs', 'qs_claims'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query("INSERT INTO qs_jobs (id, status) VALUES (1, 'new'), (2, 'new')");
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return (worker) =>
      inTxn(pool, async (c) => {
        const r = await c.query("SELECT id FROM qs_jobs WHERE status = 'new' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
        if (r.rows.length === 0) return null;
        const id = r.rows[0].id;
        await c.query("UPDATE qs_jobs SET status = 'running' WHERE id = $1", [id]);
        await c.query('INSERT INTO qs_claims (job_id, worker) VALUES ($1, $2)', [id, worker]);
        return id;
      });
  },
  actors: { A: (claim) => claim('A'), B: (claim) => claim('B') },
  invariants: [
    { name: 'a job is claimed at most once', sql: 'SELECT NOT EXISTS (SELECT 1 FROM qs_claims GROUP BY job_id HAVING count(*) > 1) AS ok' },
    { name: 'every worker got a job', sql: 'SELECT count(*) = 2 AS ok FROM qs_claims' },
  ],
};
