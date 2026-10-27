import { makePool } from './lib.mjs';

/** Correct code that writes a fresh uuid and a timestamp on every run: the serial oracle must NOT flag it. */
export default {
  name: 'benign nondeterminism (uuid + timestamp)',
  tables: ['events', 'counters'],
  schema: 'sql/events.sql',
  seed: async (db) => { await db.query('INSERT INTO counters VALUES (1, 0)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (who) => {
      await pool.query('UPDATE counters SET n = n + 1 WHERE id = 1');
      await pool.query('INSERT INTO events (actor, created_at) VALUES ($1, now())', [who]);
    };
  },
  actors: { A: (record) => record('A'), B: (record) => record('B') },
  invariants: [{ name: 'both increments counted', sql: 'SELECT n = 2 AS ok FROM counters WHERE id = 1' }],
  options: { ignoreColumns: ['id', 'created_at'] },
};
