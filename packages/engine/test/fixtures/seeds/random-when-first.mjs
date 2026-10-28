import { makePool } from './lib.mjs';

/**
 * Deterministic when A runs first (A then B), random when B runs first: B stores a fresh token only if it finds the
 * table empty. The default serial order is clean; the other serial order (0 preemptions) is not reproducible.
 */
export default {
  name: 'randomness only when B runs first',
  tables: ['nd_tokens', 'nd_ctr'],
  schema: 'sql/nd-first.sql',
  seed: async (db) => { await db.query('INSERT INTO nd_ctr VALUES (1, 0)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return {
      a: async () => { await pool.query("INSERT INTO nd_tokens (token) VALUES ('fixed')"); },
      b: async () => {
        const r = await pool.query('SELECT count(*)::int AS n FROM nd_tokens');
        await pool.query('INSERT INTO nd_tokens (token) VALUES ($1)', [r.rows[0].n === 0 ? Math.random().toString(36) : 'fixed']);
      },
    };
  },
  actors: { A: (s) => s.a(), B: (s) => s.b() },
  invariants: [],
};
