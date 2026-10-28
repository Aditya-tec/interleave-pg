/*
 * MINIMAL PREEMPTIONS: 2.
 *
 * Symmetric "claim, look for the other, back off if seen" lease acquisition, three autocommit statements per actor:
 * INSERT own claim; SELECT count of the other claims; if > 0 then DELETE own claim and give up ('backoff').
 * It can never let both in, but it can let NOBODY in: both see each other and both step back.
 * Invariant: after both finish somebody holds the lease (a claim row remains). Every serial order satisfies it.
 *
 * Why 2 and not 1. Both must see the other claim: ins_B < chk_A < del_B and ins_A < chk_B < del_A.
 * With one preemption the schedule is [X prefix][Y entirely][X rest]. Y runs to the end without interruption, so if Y
 * saw the claim of X it backs off and removes its own claim BEFORE the check of X, so X sees nothing and holds. If the
 * prefix of X is empty (serial) or has the check, there is no overlap. So 1 preemption never gives "both back off".
 * With 2: B.ins | (preempt B, B still has chk,del) A.ins, A.chk (sees B; A still has del) | (preempt A) B.chk (sees A),
 * B.del | (B done, free) A.del. Both back off: 2 preemptions. (Also brute-forced on my own abstract model: minimum 2.)
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'lease acquisition where both claimants back off',
  tables: ['lease2_claims'],
  schema: 'schema.sql',
  seed: async () => {},
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async (me) => {
      await pool.query('INSERT INTO lease2_claims (actor) VALUES ($1)', [me]);
      const r = await pool.query('SELECT count(*)::int AS n FROM lease2_claims WHERE actor <> $1', [me]);
      if (r.rows[0].n > 0) {
        await pool.query('DELETE FROM lease2_claims WHERE actor = $1', [me]);
        return 'backoff';
      }
      return 'holder';
    };
  },
  actors: {
    A: (acquire) => acquire('A'),
    B: (acquire) => acquire('B'),
  },
  invariants: [{ name: 'somebody holds the lease', sql: 'SELECT count(*) >= 1 AS ok FROM lease2_claims' }],
};
