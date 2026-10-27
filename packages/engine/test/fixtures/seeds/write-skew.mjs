import { makePool, inTxn } from './lib.mjs';

/** On-call doctors: a doctor may go off call only if at least two are on call. Plain BEGIN (isolation comes from the session). */
export function build({ safe = false } = {}) {
  return {
    name: safe ? 'write skew (SELECT ... FOR UPDATE)' : 'write skew (on-call doctors)',
    tables: ['doctors'],
    schema: 'sql/doctors.sql',
    seed: async (db) => { await db.query('INSERT INTO doctors VALUES (1, true), (2, true)'); },
    setup: async ({ dsn }) => {
      const pool = await makePool(dsn);
      return (me) =>
        inTxn(pool, async (c) => {
          const r = safe
            ? await c.query('SELECT id FROM doctors WHERE on_call FOR UPDATE')
            : await c.query('SELECT id FROM doctors WHERE on_call');
          if (r.rows.length >= 2) await c.query('UPDATE doctors SET on_call = false WHERE id = $1', [me]);
        });
    },
    actors: { A: (goOff) => goOff(1), B: (goOff) => goOff(2) },
    invariants: [{ name: 'at least one doctor on call', sql: 'SELECT count(*) >= 1 AS ok FROM doctors WHERE on_call' }],
  };
}
export default build();
