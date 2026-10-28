import pg from 'pg';

/**
 * Same signup as the backstop scenario, but inside a transaction whose error path never rolls back: the actor
 * rejected by the UNIQUE constraint leaves its transaction open. That is not a clean rejection, so the oracle must
 * keep comparing it as an ordinary result (and the run warns about the open transaction).
 */
export default {
  name: 'signup (UNIQUE backstop, transaction left open on error)',
  tables: ['members'],
  schema: 'sql/members-unique.sql',
  setup: async ({ dsn }) => {
    const connect = async () => { const c = new pg.Client({ connectionString: dsn }); await c.connect(); return c; };
    const [a, b] = [await connect(), await connect()];
    const signup = (c) => async () => {
      await c.query('BEGIN');
      const r = await c.query("SELECT count(*)::int AS n FROM members WHERE email = 'a@example.com'");
      if (r.rows[0].n === 0) await c.query("INSERT INTO members (email) VALUES ('a@example.com')");
      await c.query('COMMIT');
    };
    return { A: signup(a), B: signup(b) };
  },
  actors: { A: (s) => s.A(), B: (s) => s.B() },
  invariants: [],
};
