import { makePool } from './lib.mjs';

/** Actor A holds a row lock inside a transaction and sleeps for a few seconds: long enough to interrupt. */
export default {
  name: 'slow transaction',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => ({ pool: await makePool(dsn) }),
  actors: {
    A: async ({ pool }) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('UPDATE accounts SET balance = balance + 1 WHERE id = 1');
        await c.query('SELECT pg_sleep(4.5) /* interleave-slow */');
        await c.query('COMMIT');
      } finally {
        c.release();
      }
    },
    B: async ({ pool }) => { await pool.query('SELECT balance FROM accounts WHERE id = 1'); },
  },
  invariants: [{ name: 'balance is 101', sql: 'SELECT balance = 101 AS ok FROM accounts WHERE id = 1' }],
};
