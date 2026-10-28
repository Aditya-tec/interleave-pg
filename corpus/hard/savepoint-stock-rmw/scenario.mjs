/*
 * MINIMAL PREEMPTIONS: 1.   (long transaction with SAVEPOINT / ROLLBACK TO)
 *
 * placeOrder(buyer): one transaction, two lines (widget x2, gizmo x2), each line inside its own savepoint:
 *   BEGIN; per line: SAVEPOINT l<i>; SELECT qty; if qty < wanted: ROLLBACK TO SAVEPOINT l<i> (skip the line)
 *   else UPDATE stock SET qty = <read - wanted> (absolute), INSERT order line, RELEASE SAVEPOINT l<i>; COMMIT.
 * Stock is 3 of each, so serially the first buyer gets both lines and the second gets none (rolled back to savepoint).
 * Bug: the stock write is an absolute value derived from an unlocked read.
 * Violation: A.BEGIN, A.SAVEPOINT l0, A.SELECT widget (3) | (preempt A) B runs completely and takes both lines |
 * (B done, free) A.UPDATE widget = 1 (overwrites B's 1), A.INSERT, RELEASE, then gizmo: A reads 1 < 2, ROLLBACK TO,
 * COMMIT. Widgets: stock 1 plus 4 sold is not 3. 1 preemption; 0 is serial so the minimum is 1.
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

const LINES = [
  { sku: 'widget', qty: 2 },
  { sku: 'gizmo', qty: 2 },
];

export default {
  name: 'order with savepoint per line, stock updated from a stale read',
  tables: ['sp1_stock', 'sp1_orders'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query("INSERT INTO sp1_stock (sku, qty, initial) VALUES ('widget', 3, 3), ('gizmo', 3, 3)");
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return (buyer) =>
      inTxn(pool, async (c) => {
        let filled = 0;
        for (let i = 0; i < LINES.length; i++) {
          const { sku, qty } = LINES[i];
          await c.query(`SAVEPOINT l${i}`);
          const r = await c.query('SELECT qty FROM sp1_stock WHERE sku = $1', [sku]);
          if (r.rows[0].qty < qty) {
            await c.query(`ROLLBACK TO SAVEPOINT l${i}`);
            continue;
          }
          await c.query('UPDATE sp1_stock SET qty = $1 WHERE sku = $2', [r.rows[0].qty - qty, sku]);
          await c.query('INSERT INTO sp1_orders (buyer, sku, qty) VALUES ($1, $2, $3)', [buyer, sku, qty]);
          await c.query(`RELEASE SAVEPOINT l${i}`);
          filled++;
        }
        return filled;
      });
  },
  actors: { A: (order) => order('ann'), B: (order) => order('bob') },
  invariants: [
    {
      name: 'stock plus sold equals initial',
      sql: `SELECT NOT EXISTS (
              SELECT 1 FROM sp1_stock s
              WHERE s.qty < 0 OR s.qty + coalesce((SELECT sum(o.qty) FROM sp1_orders o WHERE o.sku = s.sku), 0) <> s.initial
            ) AS ok`,
    },
  ],
};
