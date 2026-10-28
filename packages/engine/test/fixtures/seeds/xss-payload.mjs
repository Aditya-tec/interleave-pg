import { makePool } from './lib.mjs';

/** A real lost update whose data, SQL parameters, scenario name and invariant name all contain HTML. */
export default {
  name: '<script>alert("scenario name")</script> lost update',
  tables: ['xss_wallet', 'xss_note'],
  schema: 'sql/xss.sql',
  seed: async (db) => { await db.query('INSERT INTO xss_wallet VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (n) => {
      const r = await pool.query('SELECT balance FROM xss_wallet WHERE id = 1');
      await pool.query('INSERT INTO xss_note (body) VALUES ($1)', ["'><img src=x onerror=alert(1)>"]);
      await pool.query('UPDATE xss_wallet SET balance = $1 WHERE id = 1', [r.rows[0].balance + n]);
    };
  },
  actors: { A: (deposit) => deposit(10), B: (deposit) => deposit(10) },
  invariants: [{ name: 'both deposits counted', sql: 'SELECT balance = 120 AS ok FROM xss_wallet WHERE id = 1' }],
  options: { ignoreColumns: ['id'] },
};
