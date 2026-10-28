// WORKED EXAMPLE: a queue (BullMQ-style) re-delivers a job that looked stalled while the first worker was still running it,
// so the "send welcome e-mail" handler runs twice at the same time. Plain `pg`, no ORM.
//
// The e-mail itself is an external call, so it is stubbed as a row in `emails_sent` ("the e-mail went out").
// The handler checks `job_state.done`, sends, then marks the job done: the check and the mark are far apart.
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'retried queue job sends the welcome e-mail twice',
  tables: ['emails_sent', 'job_state'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query("INSERT INTO job_state (job_id) VALUES ('welcome-42')");
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    // The handler a worker runs for job 'welcome-42'.
    return async () => {
      const state = await pool.query("SELECT done FROM job_state WHERE job_id = 'welcome-42'");
      if (state.rows[0].done) return 'already done';
      await pool.query("INSERT INTO emails_sent (job_id, to_addr) VALUES ('welcome-42', 'new.user@example.com')"); // stands in for the SMTP call
      await pool.query("UPDATE job_state SET done = true WHERE job_id = 'welcome-42'");
      return 'sent';
    };
  },
  // The original delivery and the retry of the same job.
  actors: {
    A: (handler) => handler(),
    B: (handler) => handler(),
  },
  invariants: [{ name: 'the welcome e-mail is sent once', sql: "SELECT count(*) <= 1 AS ok FROM emails_sent WHERE job_id = 'welcome-42'" }],
};
