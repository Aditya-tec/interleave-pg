import { makePool } from '../../_lib/lib.mjs';

// A payment-succeeded webhook delivered twice (the provider retries). Status is checked, then flipped, then the ledger is credited.
export default {
  name: 'payment webhook delivered twice',
  tables: ['ledger', 'payments'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO payments VALUES ('pay_1', 'pending')"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async () => {
      const p = await pool.query("SELECT status FROM payments WHERE id = 'pay_1'");
      if (p.rows[0].status !== 'pending') return 'ignored';
      await pool.query("UPDATE payments SET status = 'paid' WHERE id = 'pay_1'");
      await pool.query("INSERT INTO ledger (payment_id, amount) VALUES ('pay_1', 50)");
      return 'credited';
    };
  },
  actors: { A: (deliver) => deliver(), B: (deliver) => deliver() },
  invariants: [{ name: 'one ledger credit per payment', sql: "SELECT count(*) <= 1 AS ok FROM ledger WHERE payment_id = 'pay_1'" }],
};
