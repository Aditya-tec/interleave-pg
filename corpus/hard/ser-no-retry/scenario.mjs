/*
 * SAFE in terms of data, but the loser gets an error: SERIALIZABLE without a retry loop.
 *
 * Two doctors on call; a doctor may go off call only if more than one is on call. Each request runs in
 * BEGIN ISOLATION LEVEL SERIALIZABLE (helper inTxn) and is NOT retried. Under the write skew schedules the database
 * aborts one transaction with SQLSTATE 40001 (serialization_failure) and the actor rejects with that code; the data
 * stays correct (exactly one doctor on call).
 * Expected classification: CLEAN. DECISIONS/spec 4.6 and 8.12: 40001 is a retriable abort, an outcome and not an engine
 * error; the remaining actor is compared with its serial run and the invariant holds. A tool that reports a finding
 * here would be treating "the user sees an error" as a bug, which the documented oracle does not do.
 * (The app-level shortcoming - no retry - is real, but it is not visible to the invariant or to the serial oracle.)
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'serializable write skew without retry',
  tables: ['ser1_doctors'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query("INSERT INTO ser1_doctors (name, on_call) VALUES ('ann', true), ('bob', true)");
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return (name) =>
      inTxn(
        pool,
        async (c) => {
          const r = await c.query('SELECT count(*)::int AS n FROM ser1_doctors WHERE on_call');
          if (r.rows[0].n <= 1) return 'stay';
          await c.query('UPDATE ser1_doctors SET on_call = false WHERE name = $1', [name]);
          return 'off';
        },
        'SERIALIZABLE',
      );
  },
  actors: { A: (req) => req('ann'), B: (req) => req('bob') },
  invariants: [{ name: 'someone stays on call', sql: 'SELECT count(*) >= 1 AS ok FROM ser1_doctors WHERE on_call' }],
};
