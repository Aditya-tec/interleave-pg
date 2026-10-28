import { makePool } from '../../_lib/lib.mjs';

// In production a Redis lock serializes these actors. The Redis call is stubbed (as the docs ask for external calls),
// so the engine cannot see the lock and reports the race the database alone allows.
const redis = {
  async set() { return 'OK'; },
  async del() { return 1; },
};

export default {
  name: 'limit: lock held in Redis, check-then-act in the database',
  tables: ['redemptions', 'coupons'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO coupons (code) VALUES ('SAVE10')"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async () => {
      await redis.set('lock:coupon:SAVE10', '1', 'NX', 'EX', 5);
      try {
        const r = await pool.query("SELECT used FROM coupons WHERE code = 'SAVE10'");
        if (!r.rows[0].used) {
          await pool.query("UPDATE coupons SET used = true WHERE code = 'SAVE10'");
          await pool.query("INSERT INTO redemptions (code) VALUES ('SAVE10')");
        }
      } finally {
        await redis.del('lock:coupon:SAVE10');
      }
    };
  },
  actors: { A: (redeem) => redeem(), B: (redeem) => redeem() },
  invariants: [{ name: 'coupon redeemed at most once', sql: 'SELECT count(*) <= 1 AS ok FROM redemptions' }],
};
