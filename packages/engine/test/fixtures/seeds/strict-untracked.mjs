import { AsyncResource } from 'node:async_hooks';
import { makePool } from './lib.mjs';

/**
 * A statement run in the async context captured in setup() (before any actor exists) is issued "outside any actor".
 * Real code does this with connection-pool callbacks, queues and timers created at start-up.
 */
export default {
  name: 'strict: statements outside any actor',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    const startup = new AsyncResource('startup');
    return async (n) => {
      await startup.runInAsyncScope(() => pool.query('SELECT 1'));
      await pool.query('UPDATE accounts SET balance = balance + $1 WHERE id = 1', [n]);
    };
  },
  actors: { A: (deposit) => deposit(10), B: (deposit) => deposit(10) },
  invariants: [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }],
};
