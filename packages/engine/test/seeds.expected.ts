/**
 * Expected exploration results for the Phase 2 seed scenarios.
 *
 * MINIMAL PREEMPTION COUNTS were derived by reasoning, and this comment was committed BEFORE the
 * exploration engine existed or any seed was run. A "preemption" is a switch away from an actor that
 * is still at its gate (runnable). Switches forced by an actor finishing or being blocked are free.
 * With 2 actors, 0 preemptions means a serial execution (A then B, or B then A).
 *
 *  lost-update        A: SELECT, UPDATE.  B: SELECT, UPDATE.  (write is an absolute value)
 *                     Bug needs both SELECTs before either UPDATE. Cheapest: A.SELECT, switch to B
 *                     (preemption 1; A is runnable), B runs both statements, A resumes after B finished
 *                     (free). => min 1.
 *  check-then-insert  A: SELECT count, INSERT.  B: same. Both counts must be read before either INSERT.
 *                     Same shape as above. => min 1.
 *  oversell           A: SELECT stock, UPDATE stock-1, INSERT order.  B: same. Both SELECTs must see
 *                     stock=1 before either UPDATE. A.SELECT, switch to B (1), B runs fully, A resumes
 *                     (free). => min 1.
 *  coupon             A: SELECT used, UPDATE used=true, INSERT redemption.  B: same. Same shape. => min 1.
 *  write-skew         A: BEGIN, SELECT on-call count, UPDATE self, COMMIT.  B: same.
 *                     Both counts must be read (2 on call) before either UPDATE. A.BEGIN, A.SELECT, switch
 *                     to B (1), B runs BEGIN..COMMIT, A resumes (free). => min 1.
 *  deadlock           A: BEGIN, U(1), U(2), COMMIT.  B: BEGIN, U(2), U(1), COMMIT.
 *                     A.BEGIN, A.U(1), switch to B (1), B.BEGIN, B.U(2), B.U(1) blocks on A, so A runs
 *                     next (free, because B is blocked, not runnable) and A.U(2) blocks on B: deadlock.
 *                     => min 1.
 *  two-preemptions    A: INSERT 'a1', INSERT 'a2'.  B: INSERT 'b1', INSERT 'b2'. The invariant is violated
 *                     only when the log order is strictly alternating (a1,b1,a2,b2 or b1,a1,b2,a2).
 *                     A,B,A,B has a switch away from a runnable A (1) and then away from a runnable B (2);
 *                     every schedule with fewer preemptions (AABB, BBAA, ABBA, BAAB) is not alternating.
 *                     => min 2. (Synthetic on purpose: it isolates the minimality guarantee.)
 *
 * Safe controls and the benign-nondeterminism control must report no violation and no anomaly.
 *
 * `firstViolationIndex` is the 1-based position of the first violating schedule in the deterministic
 * exploration order (iterative context bounding, DFS). It is pinned here after the first run; any drift
 * needs a reason recorded in docs/DECISIONS.md.
 */
export interface SeedExpectation {
  file: string;
  kind: 'buggy' | 'safe';
  /** Invariant that must fail (buggy only). */
  invariant?: string;
  minPreemptions?: number;
  /** Pinned after the first run (see above). */
  firstViolationIndex?: number;
  /** Pinned after the first run: total schedules explored with the options used by the tests. */
  explored?: number;
}

export const SEEDS: SeedExpectation[] = [
  { file: 'lost-update.mjs', kind: 'buggy', invariant: 'both deposits applied', minPreemptions: 1 },
  { file: 'check-then-insert.mjs', kind: 'buggy', invariant: 'at most one member per email', minPreemptions: 1 },
  { file: 'oversell.mjs', kind: 'buggy', invariant: 'stock never negative', minPreemptions: 1 },
  { file: 'coupon.mjs', kind: 'buggy', invariant: 'coupon redeemed at most once', minPreemptions: 1 },
  { file: 'write-skew.mjs', kind: 'buggy', invariant: 'at least one doctor on call', minPreemptions: 1 },
  { file: 'deadlock.mjs', kind: 'buggy', invariant: 'no actor aborted by a deadlock', minPreemptions: 1 },
  { file: 'two-preemptions.mjs', kind: 'buggy', invariant: 'log is never strictly alternating', minPreemptions: 2 },
  { file: 'lost-update-safe.mjs', kind: 'safe' },
  { file: 'check-then-insert-safe.mjs', kind: 'safe' },
  { file: 'oversell-safe.mjs', kind: 'safe' },
  { file: 'coupon-safe.mjs', kind: 'safe' },
  { file: 'write-skew-safe.mjs', kind: 'safe' },
  { file: 'deadlock-safe.mjs', kind: 'safe' },
  { file: 'benign-nondeterminism.mjs', kind: 'safe' },
];
