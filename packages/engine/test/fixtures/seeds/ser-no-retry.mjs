import { makePool } from './lib.mjs';

/** Write skew under SERIALIZABLE with no retry loop: the database aborts one transaction with 40001 and the app lets it through. */
export default {
  name: 'serializable write skew, no retry',
  tables: ['sr_doctors'],
  schema: 'sql/sr-doctors.sql',
  seed: async (db) => { await db.query('INSERT INTO sr_doctors VALUES (1, true), (2, true)'); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return async (me) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const r = await c.query('SELECT id FROM sr_doctors WHERE on_call');
        if (r.rows.length >= 2) await c.query('UPDATE sr_doctors SET on_call = false WHERE id = $1', [me]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    };
  },
  actors: { A: (goOff) => goOff(1), B: (goOff) => goOff(2) },
  invariants: [{ name: 'someone stays on call', sql: 'SELECT count(*) >= 1 AS ok FROM sr_doctors WHERE on_call' }],
};
