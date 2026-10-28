import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export async function runJob(jobId) {
  const { rows } = await pool.query('SELECT status FROM jobs WHERE id = $1', [jobId]);
  if (rows[0].status !== 'pending') return { skipped: true };
  await pool.query('INSERT INTO outbox (job_id, body) VALUES ($1, $2)', [jobId, 'hello']);
  await pool.query("UPDATE jobs SET status = 'sent' WHERE id = $1", [jobId]);
  return { sent: true };
}
