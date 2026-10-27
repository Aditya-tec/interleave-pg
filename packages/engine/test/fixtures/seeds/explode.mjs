import { makePool } from './lib.mjs';

/** 3 actors x 5 statements: far too many interleavings to enumerate; used to test the budgets. */
export default {
  name: 'state explosion',
  tables: ['scratch'],
  schema: 'sql/scratch.sql',
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async () => {
      for (let i = 0; i < 5; i++) await pool.query('SELECT 1');
    };
  },
  actors: { A: (run) => run(), B: (run) => run(), C: (run) => run() },
  invariants: [],
};
