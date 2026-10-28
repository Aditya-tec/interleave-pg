import pg from 'pg';

// Captured at import time, before any session installs the hook: this stands in for a driver (such as Prisma's
// query engine) whose statements never pass through the app's `pg` package.
const rawQuery = pg.Client.prototype.query;

export default {
  name: 'driver that bypasses the pg hook',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const client = new pg.Client({ connectionString: dsn });
    await client.connect();
    const q = (sql, values) => rawQuery.call(client, sql, values);
    return async (n) => {
      const r = await q('SELECT balance FROM accounts WHERE id = 1');
      await q('UPDATE accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + n]);
    };
  },
  actors: { A: (deposit) => deposit(10), B: (deposit) => deposit(10) },
  invariants: [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }],
};
