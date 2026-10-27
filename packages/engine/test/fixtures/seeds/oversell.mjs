import { makePool } from './lib.mjs';

export function build({ safe = false } = {}) {
  return {
    name: safe ? 'oversell (atomic conditional update)' : 'oversell (check then decrement)',
    tables: ['orders', 'products'],
    schema: 'sql/shop.sql',
    seed: async (db) => { await db.query('INSERT INTO products VALUES (1, 1)'); },
    setup: async ({ dsn }) => {
      const pool = await makePool(dsn);
      return async () => {
        if (safe) {
          const u = await pool.query('UPDATE products SET stock = stock - 1 WHERE id = 1 AND stock >= 1');
          if (u.rowCount === 1) await pool.query('INSERT INTO orders (product_id) VALUES (1)');
          return;
        }
        const r = await pool.query('SELECT stock FROM products WHERE id = 1');
        if (r.rows[0].stock >= 1) {
          await pool.query('UPDATE products SET stock = stock - 1 WHERE id = 1');
          await pool.query('INSERT INTO orders (product_id) VALUES (1)');
        }
      };
    },
    actors: { A: (buy) => buy(), B: (buy) => buy() },
    invariants: [
      { name: 'stock never negative', sql: 'SELECT stock >= 0 AS ok FROM products WHERE id = 1' },
      { name: 'orders never exceed initial stock', sql: 'SELECT count(*) <= 1 AS ok FROM orders' },
    ],
  };
}
export default build();
