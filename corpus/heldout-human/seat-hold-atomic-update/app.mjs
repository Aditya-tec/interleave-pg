import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export async function bookSeat(seatId, user) {
  const peek = await pool.query('SELECT holder FROM seats WHERE id = $1', [seatId]);
  if (peek.rows[0].holder) return { booked: false };
  const r = await pool.query('UPDATE seats SET holder = $1 WHERE id = $2 AND holder IS NULL', [user, seatId]);
  return { booked: r.rowCount === 1 };
}
