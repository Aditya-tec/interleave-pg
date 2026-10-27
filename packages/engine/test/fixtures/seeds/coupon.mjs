import { makePool } from './lib.mjs';

export function build({ safe = false } = {}) {
  return {
    name: safe ? 'coupon (atomic flag flip)' : 'coupon (read flag then set)',
    tables: ['redemptions', 'coupons'],
    schema: 'sql/coupons.sql',
    seed: async (db) => { await db.query("INSERT INTO coupons (code) VALUES ('SAVE10')"); },
    setup: async ({ dsn }) => {
      const pool = await makePool(dsn);
      return async () => {
        if (safe) {
          const u = await pool.query("UPDATE coupons SET used = true WHERE code = 'SAVE10' AND used = false");
          if (u.rowCount === 1) await pool.query("INSERT INTO redemptions (code) VALUES ('SAVE10')");
          return;
        }
        const r = await pool.query("SELECT used FROM coupons WHERE code = 'SAVE10'");
        if (!r.rows[0].used) {
          await pool.query("UPDATE coupons SET used = true WHERE code = 'SAVE10'");
          await pool.query("INSERT INTO redemptions (code) VALUES ('SAVE10')");
        }
      };
    },
    actors: { A: (redeem) => redeem(), B: (redeem) => redeem() },
    invariants: [{ name: 'coupon redeemed at most once', sql: 'SELECT count(*) <= 1 AS ok FROM redemptions' }],
  };
}
export default build();
