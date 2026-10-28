import { makePool } from '../../_lib/lib.mjs';

// Correct code that writes a random uuid and a timestamp for every page view.
export default {
  name: 'page counter with an audit trail (uuid + timestamp)',
  tables: ['audit', 'hits'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO hits VALUES ('/home', 0)"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async () => {
      await pool.query("UPDATE hits SET n = n + 1 WHERE page = '/home'");
      await pool.query("INSERT INTO audit (page, seen_at) VALUES ('/home', now())");
    };
  },
  actors: { A: (view) => view(), B: (view) => view() },
  invariants: [{ name: 'both views counted', sql: "SELECT n = 2 AS ok FROM hits WHERE page = '/home'" }],
  options: { ignoreColumns: ['id', 'seen_at'] },
};
