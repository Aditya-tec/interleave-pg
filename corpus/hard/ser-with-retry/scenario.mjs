/*
 * SAFE: SERIALIZABLE with a retry loop on 40001 (helper retrySerializable).
 *
 * Same write-skew-prone logic as ser-no-retry, but the request is re-run when the database aborts it with 40001. The
 * retried attempt sees the other doctor already off call and returns 'stay'. Sequence of statements depends on the
 * schedule (a retry adds BEGIN, SELECT, ... ), which the exploration has to follow. Final state always: one doctor on
 * call; results {off, stay} as in a serial order, no error escapes (at most one retry is needed with two actors).
 * Expected classification: CLEAN.
 */
import { makePool, retrySerializable } from '../../_lib/lib.mjs';

export default {
  name: 'serializable write skew with a retry loop',
  tables: ['ser2_doctors'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query("INSERT INTO ser2_doctors (name, on_call) VALUES ('ann', true), ('bob', true)");
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return (name) =>
      retrySerializable(pool, async (c) => {
        const r = await c.query('SELECT count(*)::int AS n FROM ser2_doctors WHERE on_call');
        if (r.rows[0].n <= 1) return 'stay';
        await c.query('UPDATE ser2_doctors SET on_call = false WHERE name = $1', [name]);
        return 'off';
      });
  },
  actors: { A: (req) => req('ann'), B: (req) => req('bob') },
  invariants: [{ name: 'someone stays on call', sql: 'SELECT count(*) >= 1 AS ok FROM ser2_doctors WHERE on_call' }],
};
