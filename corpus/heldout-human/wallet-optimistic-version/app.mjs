import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export async function debit(walletId, amount) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { rows } = await pool.query('SELECT balance, version FROM wallets WHERE id = $1', [walletId]);
    const { balance, version } = rows[0];
    if (balance < amount) return { ok: false };
    const r = await pool.query(
      'UPDATE wallets SET balance = $1, version = version + 1 WHERE id = $2 AND version = $3',
      [balance - amount, walletId, version]);
    if (r.rowCount === 1) return { ok: true };
  }
  return { ok: false, retriesExhausted: true };
}
