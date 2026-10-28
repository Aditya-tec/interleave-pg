import { makePool } from './lib.mjs';

/**
 * A foreign-key violation (23503) is NOT a database rejection the oracle may ignore: B checks that the customer
 * exists, A deletes the customer, B inserts an order and gets 23503. Serially B would simply see no customer.
 */
export default {
  name: 'order for a customer that is deleted concurrently (FK 23503)',
  tables: ['orders', 'customers'],
  schema: 'sql/fk.sql',
  seed: async (db) => { await db.query('INSERT INTO customers VALUES (1)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return {
      deleteCustomer: () => pool.query('DELETE FROM customers WHERE id = 1'),
      placeOrder: async () => {
        const r = await pool.query('SELECT count(*)::int AS n FROM customers WHERE id = 1');
        if (r.rows[0].n === 1) await pool.query('INSERT INTO orders (customer_id) VALUES (1)');
      },
    };
  },
  actors: { A: (s) => s.deleteCustomer(), B: (s) => s.placeOrder() },
  invariants: [],
};
