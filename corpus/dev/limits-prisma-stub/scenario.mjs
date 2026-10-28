import pg from 'pg';

// Stands in for Prisma (whose query engine does not go through the app's `pg` package): the original query
// function is captured at import time, before any session installs the hook, so the hook never sees a statement.
const rawQuery = pg.Client.prototype.query;

export default {
  name: 'limit: a driver that bypasses the pg package (Prisma-like stub)',
  tables: ['accounts'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const client = new pg.Client({ connectionString: dsn });
    await client.connect();
    const q = (sql, values) => rawQuery.call(client, sql, values);
    return async () => {
      const r = await q('SELECT balance FROM accounts WHERE id = 1');
      await q('UPDATE accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + 10]);
    };
  },
  actors: { A: (deposit) => deposit(), B: (deposit) => deposit() },
  invariants: [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }],
};
