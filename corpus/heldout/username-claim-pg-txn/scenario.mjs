import { inTxn, makePool } from '../../_lib/lib.mjs';

// "Is the name free?" then INSERT, inside a transaction (which does not make the two statements atomic).
export default {
  name: 'username claim in a transaction (no unique constraint)',
  tables: ['accounts'],
  schema: 'schema.sql',
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return (name) =>
      inTxn(pool, async (c) => {
        const taken = await c.query('SELECT 1 FROM accounts WHERE username = $1', [name]);
        if (taken.rowCount > 0) return 'taken';
        await c.query('INSERT INTO accounts (username) VALUES ($1)', [name]);
        return 'claimed';
      });
  },
  actors: { A: (claim) => claim('river'), B: (claim) => claim('river') },
  invariants: [{ name: 'usernames are unique', sql: 'SELECT NOT EXISTS (SELECT 1 FROM accounts GROUP BY username HAVING count(*) > 1) AS ok' }],
};
