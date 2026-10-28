import { makePool } from '../../_lib/lib.mjs';

// A stock adjustment that wraps its write in a SAVEPOINT (so a failure can be undone), but still computes the new
// quantity from an earlier read: savepoints are ordinary statements, they do not make the read-then-write atomic.
export default {
  name: 'stock adjustment with a savepoint',
  tables: ['parts'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO parts VALUES (1, 10)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (delta) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await c.query('SELECT qty FROM parts WHERE id = 1');
        await c.query('SAVEPOINT adjust');
        try {
          await c.query('UPDATE parts SET qty = $1 WHERE id = 1', [r.rows[0].qty + delta]);
          await c.query('RELEASE SAVEPOINT adjust');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT adjust');
          throw e;
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    };
  },
  actors: { A: (adjust) => adjust(5), B: (adjust) => adjust(-3) },
  invariants: [{ name: 'both adjustments applied', sql: 'SELECT qty = 12 AS ok FROM parts WHERE id = 1' }],
};
