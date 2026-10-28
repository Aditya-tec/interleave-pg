import { inTxn, makePool } from '../../_lib/lib.mjs';

// The provider's event id is recorded first (unique), in the same transaction as the effect.
export default {
  name: 'payment webhook (event id inserted first)',
  tables: ['ledger', 'webhook_events', 'payments'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO payments VALUES ('pay_1', 'pending')"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return () =>
      inTxn(pool, async (c) => {
        const first = await c.query("INSERT INTO webhook_events (event_id) VALUES ('evt_900') ON CONFLICT (event_id) DO NOTHING RETURNING event_id");
        if (first.rowCount === 0) return 'duplicate delivery ignored';
        await c.query("UPDATE payments SET status = 'paid' WHERE id = 'pay_1'");
        await c.query("INSERT INTO ledger (payment_id, amount) VALUES ('pay_1', 50)");
        return 'credited';
      });
  },
  actors: { A: (deliver) => deliver(), B: (deliver) => deliver() },
  invariants: [{ name: 'one ledger credit per payment', sql: "SELECT count(*) <= 1 AS ok FROM ledger WHERE payment_id = 'pay_1'" }],
};
