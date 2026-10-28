// Template for a held-out scenario. Copy this directory to corpus/heldout-human/<your-id>/ (no leading underscore)
// and fill in the TODOs. Nothing else needs to change: the metrics script picks the directory up by itself.
import { makePool } from '../../_lib/lib.mjs'; // or '../../_lib/lib-knex.mjs' / '../../_lib/lib-drizzle.mjs', or use `pg` directly

export default {
  // TODO: a short, human name for the report
  name: 'my scenario',

  // TODO: every table the scenario touches. They are emptied and re-seeded before every schedule.
  tables: ['my_table'],

  // schema.sql sits next to this file (path relative to this file).
  schema: 'schema.sql',

  // TODO: starting rows. `db.query(sql, values)` talks to the throwaway database.
  seed: async (db) => {
    await db.query('INSERT INTO my_table VALUES (1, 0)');
  },

  // Runs once. Create pools/clients here (use `dsn`), warm them up, and return whatever the actors need.
  // Stub anything that is not the database (HTTP, Redis, e-mail): the engine can only schedule database statements.
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    // TODO: the code under test, as a function of its inputs
    return async () => {
      const r = await pool.query('SELECT n FROM my_table WHERE id = 1');
      await pool.query('UPDATE my_table SET n = $1 WHERE id = 1', [r.rows[0].n + 1]);
    };
  },

  // 2 to 4 actors. Each one is a function of what setup returned and runs concurrently with the others.
  actors: {
    A: (handler) => handler(),
    B: (handler) => handler(),
  },

  // State the business rule, not the implementation. SQL returning a boolean `ok` as its first column, or a function.
  invariants: [{ name: 'both increments counted', sql: 'SELECT n = 2 AS ok FROM my_table WHERE id = 1' }],
};
