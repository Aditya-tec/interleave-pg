import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export async function handleWebhook(eventId, accountId, amount) {
  const seen = await pool.query('SELECT 1 FROM webhook_events WHERE event_id = $1', [eventId]);
  if (seen.rowCount > 0) return { duplicate: true };
  await pool.query('UPDATE accounts SET credits = credits + $1 WHERE id = $2', [amount, accountId]);
  await pool.query('INSERT INTO webhook_events (event_id) VALUES ($1)', [eventId]);
  return { applied: true };
}
