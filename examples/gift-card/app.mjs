// The "application code" under test: redeeming part of a gift card's balance.

/** BUGGY: reads the balance, decides in JavaScript, then writes a value computed from what it read. */
export async function redeem(pool, code, amount) {
  const { rows } = await pool.query('SELECT balance FROM gift_cards WHERE code = $1', [code]);
  if (rows[0].balance < amount) return { ok: false, reason: 'insufficient balance' };
  await pool.query('UPDATE gift_cards SET balance = $1 WHERE code = $2', [rows[0].balance - amount, code]);
  return { ok: true, amount };
}

/** FIXED: one statement checks and subtracts atomically; the row lock makes the second redemption see the new balance. */
export async function redeemFixed(pool, code, amount) {
  const { rowCount } = await pool.query('UPDATE gift_cards SET balance = balance - $1 WHERE code = $2 AND balance >= $1', [amount, code]);
  return rowCount === 1 ? { ok: true, amount } : { ok: false, reason: 'insufficient balance' };
}
