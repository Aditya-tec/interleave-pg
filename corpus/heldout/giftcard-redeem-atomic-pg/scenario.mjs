import { makePool } from '../../_lib/lib.mjs';

// Same business rule as giftcard-redeem-pg, with the check and the deduction in one statement.
export default {
  name: 'gift card redemption (conditional UPDATE)',
  tables: ['redemptions', 'gift_cards'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO gift_cards VALUES ('GC-1', 100)"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (amount) => {
      const paid = await pool.query("UPDATE gift_cards SET balance = balance - $1 WHERE code = 'GC-1' AND balance >= $1 RETURNING balance", [amount]);
      if (paid.rowCount === 0) return 'declined';
      await pool.query("INSERT INTO redemptions (code, amount) VALUES ('GC-1', $1)", [amount]);
      return 'redeemed';
    };
  },
  actors: { A: (redeem) => redeem(100), B: (redeem) => redeem(100) },
  invariants: [
    { name: 'gift card never overdrawn', sql: "SELECT balance >= 0 AS ok FROM gift_cards WHERE code = 'GC-1'" },
    { name: 'redeemed total equals what left the card', sql: "SELECT (SELECT coalesce(sum(amount), 0) FROM redemptions) = 100 - (SELECT balance FROM gift_cards WHERE code = 'GC-1') AS ok" },
  ],
};
