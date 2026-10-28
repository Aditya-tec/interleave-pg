import { inTxn, makePool } from '../../_lib/lib.mjs';

// The classic: read the balance, decide in application code, deduct.
export default {
  name: 'gift card redemption (read balance, then deduct)',
  tables: ['redemptions', 'gift_cards'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO gift_cards VALUES ('GC-1', 100)"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return (amount) =>
      inTxn(pool, async (c) => {
        const card = await c.query("SELECT balance FROM gift_cards WHERE code = 'GC-1'");
        if (card.rows[0].balance < amount) return 'declined';
        await c.query("UPDATE gift_cards SET balance = balance - $1 WHERE code = 'GC-1'", [amount]);
        await c.query("INSERT INTO redemptions (code, amount) VALUES ('GC-1', $1)", [amount]);
        return 'redeemed';
      });
  },
  actors: { A: (redeem) => redeem(100), B: (redeem) => redeem(100) },
  invariants: [{ name: 'gift card never overdrawn', sql: "SELECT balance >= 0 AS ok FROM gift_cards WHERE code = 'GC-1'" }],
};
