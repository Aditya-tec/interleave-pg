import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export async function requestLeave(employeeId, days) {
  const { rows } = await pool.query('SELECT days_left FROM leave_balances WHERE employee_id = $1', [employeeId]);
  const left = rows[0].days_left;
  if (left < days) return { approved: false };
  await pool.query('UPDATE leave_balances SET days_left = $1 WHERE employee_id = $2', [left - days, employeeId]);
  await pool.query('INSERT INTO leave_requests (employee_id, days) VALUES ($1, $2)', [employeeId, days]);
  return { approved: true };
}
