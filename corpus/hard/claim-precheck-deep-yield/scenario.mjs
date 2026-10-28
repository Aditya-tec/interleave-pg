/*
 * MINIMAL PREEMPTIONS: 3.
 *
 * Same lease protocol as claim-backoff-both-yield, with a cheap pre-check in front (four autocommit statements):
 *   pre: SELECT count of the other claims; if > 0 give up at once without inserting ('backoff')
 *   ins: INSERT own claim
 *   chk: SELECT count of the other claims; if > 0:
 *   del: DELETE own claim, 'backoff'; else 'holder'.
 * Bug (nobody holds the lease) needs both actors to pass `pre` (pre_A < ins_B and pre_B < ins_A) AND both to see
 * each other at `chk` (ins_B < chk_A < del_B, ins_A < chk_B < del_A).
 * With 2 preemptions the schedule shape is X1 Y1 X2 Y2 (X1 = a prefix of X, Y1 a prefix of Y, X2 = all the rest of X,
 * then Y2). pre_Y < ins_X forces ins_X out of X1, so X1 = [pre_X]; X2 then runs ins, chk, del without interruption
 * and finishes before the chk of Y, so Y chk sees nothing (X deleted) and Y holds. So 2 preemptions are not enough.
 * With 3: A.pre | (preempt) B.pre, B.ins | (preempt, B still has chk,del) A.ins, A.chk sees B | (preempt, A has del)
 * B.chk sees A, B.del | (B done, free) A.del. Both gone: 3 preemptions. (Brute-forced on my own abstract model: 3.)
 * Serial orders are fine: the first actor holds, the second is stopped by the pre-check.
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'lease acquisition with pre-check, both back off late',
  tables: ['lease3_claims'],
  schema: 'schema.sql',
  seed: async () => {},
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    const others = (me) => pool.query('SELECT count(*)::int AS n FROM lease3_claims WHERE actor <> $1', [me]);
    return async (me) => {
      if ((await others(me)).rows[0].n > 0) return 'backoff';
      await pool.query('INSERT INTO lease3_claims (actor) VALUES ($1)', [me]);
      if ((await others(me)).rows[0].n > 0) {
        await pool.query('DELETE FROM lease3_claims WHERE actor = $1', [me]);
        return 'backoff';
      }
      return 'holder';
    };
  },
  actors: {
    A: (acquire) => acquire('A'),
    B: (acquire) => acquire('B'),
  },
  invariants: [{ name: 'somebody holds the lease', sql: 'SELECT count(*) >= 1 AS ok FROM lease3_claims' }],
};
