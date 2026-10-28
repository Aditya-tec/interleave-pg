import { makePool } from './lib.mjs';

/**
 * BUGGY even though a UNIQUE constraint rejects one of the actors: the stock is decremented BEFORE the
 * redemption row is inserted and nothing rolls it back, so the rejected actor leaves a partial effect behind
 * (remaining = -1). A rejection by the constraint must not hide this.
 */
export default {
  name: 'coupon (UNIQUE constraint, but partial effect not rolled back)',
  tables: ['redemptions', 'coupons'],
  schema: 'sql/coupons-unique.sql',
  seed: async (db) => { await db.query("INSERT INTO coupons VALUES ('SAVE10', 1)"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (user) => {
      const r = await pool.query("SELECT remaining FROM coupons WHERE code = 'SAVE10'");
      if (r.rows[0].remaining > 0) {
        await pool.query("UPDATE coupons SET remaining = remaining - 1 WHERE code = 'SAVE10'");
        await pool.query("INSERT INTO redemptions (code, user_id) VALUES ('SAVE10', $1)", [user]);
      }
    };
  },
  actors: { A: (redeem) => redeem(7), B: (redeem) => redeem(7) },
  invariants: [{ name: 'remaining stock never negative', sql: "SELECT remaining >= 0 AS ok FROM coupons WHERE code = 'SAVE10'" }],
};
