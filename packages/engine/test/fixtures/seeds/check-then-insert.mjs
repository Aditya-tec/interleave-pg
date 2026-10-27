import { makePool } from './lib.mjs';

export function build({ safe = false } = {}) {
  return {
    name: safe ? 'check-then-insert (unique + ON CONFLICT)' : 'check-then-insert (no unique constraint)',
    tables: ['members'],
    schema: safe ? 'sql/members-unique.sql' : 'sql/members.sql',
    setup: async ({ dsn }) => {
      const pool = await makePool(dsn);
      return async (email) => {
        if (safe) {
          await pool.query('INSERT INTO members (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
          return;
        }
        const r = await pool.query('SELECT count(*)::int AS n FROM members WHERE email = $1', [email]);
        if (r.rows[0].n === 0) await pool.query('INSERT INTO members (email) VALUES ($1)', [email]);
      };
    },
    actors: { A: (join) => join('a@example.com'), B: (join) => join('a@example.com') },
    invariants: [{ name: 'at most one member per email', sql: "SELECT count(*) <= 1 AS ok FROM members WHERE email = 'a@example.com'" }],
  };
}
export default build();
