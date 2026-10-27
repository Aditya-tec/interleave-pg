import pg from 'pg';

/** SELECT ... FOR UPDATE: the second actor blocks until the first commits. Correct code. */
export default {
  name: 'for update blocking',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const pool = new pg.Pool({ connectionString: dsn, max: 4 });
    await pool.query('SELECT 1');
    return async (n) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await c.query('SELECT balance FROM accounts WHERE id = 1 FOR UPDATE');
        await c.query('UPDATE accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + n]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    };
  },
  actors: { A: (deposit) => deposit(10), B: (deposit) => deposit(10) },
  invariants: [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }],
};
