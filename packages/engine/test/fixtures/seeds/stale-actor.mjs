import { makePool } from './lib.mjs';

let calls = 0;
/**
 * The first call of A waits on a real timer longer than the abort settle window (a stall in run 1), then writes. If that run was abandoned, the write
 * arrives while a LATER run is in progress. Later calls of A and B are slow but ordinary database work.
 */
export default {
  name: 'stale actor from an abandoned run',
  tables: ['accounts'],
  schema: 'sql/accounts.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
  setup: async ({ dsn }) => ({ pool: await makePool(dsn) }),
  actors: {
    A: async ({ pool }) => {
      if (calls++ === 0) {
        await pool.query('SELECT 1');
        await new Promise((r) => setTimeout(r, 3500));
        await pool.query('UPDATE accounts SET balance = balance + 1 WHERE id = 1');
        return 'late';
      }
      for (let i = 0; i < 8; i++) await pool.query('SELECT pg_sleep(0.3)');
      return 'ok';
    },
    B: async ({ pool }) => {
      for (let i = 0; i < 8; i++) await pool.query('SELECT pg_sleep(0.3)');
      return 'ok';
    },
  },
  invariants: [],
};
