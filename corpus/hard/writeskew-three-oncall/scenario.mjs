/*
 * MINIMAL PREEMPTIONS: 1.   (three actors, read committed transactions, write skew)
 *
 * Three doctors are on call. A doctor may go off call only if more than one is on call (count > 1), so the hospital
 * keeps at least one. Each request is BEGIN, SELECT count, UPDATE own row, COMMIT. The updates touch different rows,
 * so nobody ever blocks: the classic write skew.
 * Serial: A off (count 3), B off (count 2), C stays (count 1). Invariant (>= 1 on call) holds in every serial order.
 * Lower bound: 0 preemptions = serial = fine, so >= 1.
 * Schedule with exactly 1: A runs completely (2 left on call). B runs BEGIN and SELECT (count = 2, so it will go off).
 * Switch B -> C is the one preemption. C runs completely: count = 2, goes off, 1 left. C finishing is a free switch
 * back to B, whose UPDATE (decided on count = 2) takes the last doctor off call: 0 on call.
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'write skew with three doctors going off call',
  tables: ['ws3_doctors'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query("INSERT INTO ws3_doctors (name, on_call) VALUES ('ann', true), ('bob', true), ('cy', true)");
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 3);
    return (name) =>
      inTxn(pool, async (c) => {
        const r = await c.query('SELECT count(*)::int AS n FROM ws3_doctors WHERE on_call');
        if (r.rows[0].n <= 1) return 'stay';
        await c.query('UPDATE ws3_doctors SET on_call = false WHERE name = $1', [name]);
        return 'off';
      });
  },
  actors: {
    A: (req) => req('ann'),
    B: (req) => req('bob'),
    C: (req) => req('cy'),
  },
  invariants: [{ name: 'someone stays on call', sql: 'SELECT count(*) >= 1 AS ok FROM ws3_doctors WHERE on_call' }],
};
