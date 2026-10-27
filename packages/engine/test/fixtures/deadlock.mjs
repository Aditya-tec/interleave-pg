import pg from 'pg';

/** Opposite lock order: A locks 1 then 2, B locks 2 then 1. */
export default {
  name: 'transfer deadlock',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100), (2, 100)'); },
  setup: async ({ dsn }) => {
    const pool = new pg.Pool({ connectionString: dsn, max: 4 });
    await pool.query('SELECT 1');
    return async (first, second) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('UPDATE accounts SET balance = balance - 1 WHERE id = $1', [first]);
        await c.query('UPDATE accounts SET balance = balance + 1 WHERE id = $1', [second]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    };
  },
  actors: { A: (t) => t(1, 2), B: (t) => t(2, 1) },
  invariants: [{ name: 'money conserved', sql: 'SELECT sum(balance) = 200 AS ok FROM accounts' }],
};
