import { inTxn, makePool } from '../../_lib/lib.mjs';

// Reserve units against what is on hand: checks "available" in one statement and adds to "reserved" in another.
export default {
  name: 'inventory reservation (check available, then reserve)',
  tables: ['stock'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO stock VALUES ('widget', 5, 0)"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return (qty) =>
      inTxn(pool, async (c) => {
        const r = await c.query("SELECT on_hand, reserved FROM stock WHERE sku = 'widget'");
        const { on_hand: onHand, reserved } = r.rows[0];
        if (onHand - reserved >= qty) {
          await c.query("UPDATE stock SET reserved = reserved + $1 WHERE sku = 'widget'", [qty]);
          return 'reserved';
        }
        return 'insufficient';
      });
  },
  actors: { A: (reserve) => reserve(3), B: (reserve) => reserve(3) },
  invariants: [{ name: 'reserved never exceeds on-hand', sql: "SELECT reserved <= on_hand AS ok FROM stock WHERE sku = 'widget'" }],
};
