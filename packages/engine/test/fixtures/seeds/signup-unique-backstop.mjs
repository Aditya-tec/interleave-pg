import { makePool } from './lib.mjs';

/**
 * CORRECT code: pre-check, then INSERT, with a UNIQUE constraint as the backstop. In the race the second INSERT
 * gets 23505 and the request is rejected; the database state is exactly what a serial run produces.
 * Phase 2's oracle flagged this because serial B is a no-op ("ok") while concurrent B is "db:23505".
 */
export default {
  name: 'signup (pre-check + UNIQUE backstop)',
  tables: ['members'],
  schema: 'sql/members-unique.sql',
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (email) => {
      const r = await pool.query('SELECT count(*)::int AS n FROM members WHERE email = $1', [email]);
      if (r.rows[0].n === 0) await pool.query('INSERT INTO members (email) VALUES ($1)', [email]);
    };
  },
  actors: { A: (signup) => signup('a@example.com'), B: (signup) => signup('a@example.com') },
  invariants: [{ name: 'at most one member per email', sql: "SELECT count(*) <= 1 AS ok FROM members WHERE email = 'a@example.com'" }],
};
