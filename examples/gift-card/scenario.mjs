import pg from 'pg';
import { redeem } from './app.mjs';

// Two customers redeem 60 from the same gift card that holds 100 at the same moment.
// At most one of them may succeed. Run it with no schedule: interleave-pg tries the interleavings itself.
export function build(redeemFn) {
  return {
    name: 'gift card: two concurrent redemptions',
    tables: ['gift_cards'],
    schema: 'schema.sql',
    seed: async (db) => { await db.query("INSERT INTO gift_cards VALUES ('GC-1', 100)"); },
    setup: async ({ dsn }) => {
      const pool = new pg.Pool({ connectionString: dsn, max: 4 });
      await Promise.all([pool.query('SELECT 1'), pool.query('SELECT 1')]); // open connections now, not inside an actor
      return pool;
    },
    actors: {
      A: (pool) => redeemFn(pool, 'GC-1', 60),
      B: (pool) => redeemFn(pool, 'GC-1', 60),
    },
    invariants: [
      {
        name: 'never redeem more than the card holds',
        js: ({ results }) => {
          const redeemed = results.filter((r) => r.status === 'fulfilled' && r.value?.ok).reduce((n, r) => n + r.value.amount, 0);
          return { ok: redeemed <= 100, detail: `${redeemed} redeemed from a card holding 100` };
        },
      },
    ],
  };
}

export default build(redeem);
