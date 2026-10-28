# Engine results (Phase 3)

> **NOTE added 2026-10-28 (after Phase 4): The numbers in this file predate the stale-statement fix.** Every number in this file is unchanged from when it was recorded.
>
> * **The bug.** The engine abandons a run when an actor stalls outside the database (for example a timer longer than the 3 s stall limit). The abandoned actor keeps running. If it later issued a statement through the patched `pg` client, that statement was executed under the *next* scenario's controller as if it belonged to that run, and run ids restarted at 1 in every session, so the engine could not tell it was stale. The result was a spurious `UnsupportedError: parallel statements within one actor` in an innocent scenario, or a stray write in its data.
> * **How it showed up.** The first post-Phase-4 run of the adversarial set missed `hard/queue-claim-select-update` right after the stall scenario `limit-timer-wait`. It happened in **1 of 3 full hard-set runs** (and in none of 40 runs of the scenario alone), so it depended on timing. The bug has been in the engine since Phase 3, so the recorded results were produced by an engine that could have it. They show no sign of it (every recorded outcome matched its expectation, and only a scenario that follows a stall scenario can be hit), but I cannot prove that no earlier run was luckily unaffected, so read them as "correct when recorded, timing-dependent in principle", not as a stability claim.
> * **The fix.** Commit `762fbf2`: run ids are unique per process and the hook rejects a statement from an earlier run (`StaleRunError`) without executing it. Regression test: `packages/engine/test/stale-actor.test.ts`. After the fix every set was rerun (`eval/results/post-phase4-after-stale-fix-2026-10-28/`) and the stability proof in `eval/results/stability-2026-10-28/` shows identical outcomes and schedule counts across repeated runs (see `docs/phase-4-report.md`).
> * **What the held-out freeze covered.** The engine freeze of the held-out protocol applied only to the one-shot held-out run recorded here; it was never a promise that the engine was bug-free. The post-fix runs are regression checks on data that is now development data, not new held-out results.

Definitions are in [METRICS.md](METRICS.md) (committed before the first measurement, not edited since). The held-out protocol, hashes, freeze record and one disclosed incident are in [HELDOUT.md](HELDOUT.md). Raw outputs: `eval/results/`.

**How to read the numbers.** Three sets are reported and never merged:

| Set | Who wrote it | Independent of the engine author? | May the engine be tuned on it? |
|---|---|---|---|
| **dev** (`corpus/dev`) | the engine's author (an AI agent) | no | yes |
| **held-out, agent-written** (`corpus/heldout`) | the same author, in different domains, committed with a recorded hash before the run | **no** | no |
| **held-out, externally authored** (`corpus/heldout-human`) | a person other than the engine's author | **yes** | no |

Rule applied to every claim below: where a held-out number is worse than a dev number, the held-out number is the one quoted. Here no held-out number was worse, which is itself a reason for caution (see "Threats to validity").

## Headline

* **Externally authored held-out set (independent), counts of 5:** 3 of 3 buggy scenarios were found and confirmed 3 of 3 (each on the invariant the author named); 2 of 2 safe scenarios produced no finding; 0 misses, 0 mismatches, 0 false positives, 0 unconfirmed findings. **n = 5. This is a very small sample; it shows the engine can handle five hand-picked external cases and says almost nothing about rates.**
* **Agent-written held-out set (not independent of the engine author), 15 scenarios:** 9 of 9 buggy found and confirmed on the expected invariant, 6 of 6 safe clean, 0 mismatches, 0 false positives, 0 unconfirmed.
* **Dev set (tuning allowed), 54 scenarios:** 29 of 29 in-scope buggy found, 22 of 22 safe clean, 59 confirmed findings and 0 unconfirmed; the 3 honest-limit scenarios produced the explicit message or notice required.
* Official runtime gate (CI job Postgres 17 / Node 22, standard 4-vCPU runner, dev set, 3 runs of one commit): median 251, 265 and 300 ms; p95 6,177, 6,210 and 6,219 ms. Limits: median 10 s, p95 60 s.
* Identical outcomes and identical schedule counts on every scenario of every set across Postgres 15, 16, 17, 18 x Node 20, 22 (54 dev scenarios x 8 jobs; 15 and 5 held-out scenarios x 8 jobs). Postgres 14 was not tested (end of life 2026-11-12).

## Hard gates

Numbers marked **DEV** may have been influenced by tuning; **HELD-OUT** numbers were produced once, after the freeze. Only HELD-OUT numbers may support a claim about unseen code.

| Gate (docs/METRICS.md) | DEV (54 scenarios) | HELD-OUT, agent-written (15) | HELD-OUT, externally authored (5, counts) | Result |
|---|---|---|---|---|
| Recall >= 90% on in-scope buggy | 29/29 | 9/9 | 3/3 | PASS |
| False positives = 0 on in-scope safe | 0/22 | 0/6 | 0/2 | PASS |
| 100% of reported violations confirmed (no unconfirmed finding) | 59 confirmed, 0 unconfirmed | 17 confirmed, 0 unconfirmed | 7 confirmed, 0 unconfirmed | PASS |
| Runtime median <= 10 s | CI (official, pg17/node22, 3 runs): 0.25 to 0.30 s; local: 0.51 s | local: 0.92 s | local: 0.53 s | PASS |
| Runtime p95 <= 60 s | CI (official, 3 runs): 6.18 to 6.22 s; local: 6.82 s | local: 11.77 s (CI jobs: 10.6 to 11.6 s) | local: 0.91 s | PASS |
| Out-of-scope items produce an explicit "cannot see / unsupported" message | 3/3 (honest limits below) | n/a | n/a | PASS |

No gate failed. Nothing was loosened, no expectation was edited after a result was seen, and no scenario was dropped.

## Dev set

Local run, Postgres 17.11, 2026-10-28 (`eval/results/dev-final-local.*`; the engine was not tuned for these results, but it could have been). Per bug class:

| Class | Buggy found | Safe clean |
|---|---|---|
| benign-control | 0/0 | 2/2 |
| check-then-insert | 4/4 | 4/4 |
| coupon | 3/3 | 1/1 |
| deadlock | 2/2 | 1/1 |
| idempotency-key | 2/2 | 1/1 |
| lost-update | 5/5 | 4/4 |
| oversell | 4/4 | 3/3 |
| phantom-booking | 3/3 | 1/1 |
| queue-claim | 1/1 | 1/1 |
| retry-wrapper-control | 0/0 | 1/1 |
| webhook-duplicate | 2/2 | 1/1 |
| write-skew | 3/3 | 2/2 |

Totals: 29/29 buggy found, 0/22 safe flagged, 59 confirmed and 0 unconfirmed findings, schedules explored median 14 (p95 54), runtime median 0.51 s (p95 6.82 s) on this machine.

Drivers (in-scope): drizzle/buggy 6, drizzle/safe 3, knex/buggy 7, knex/safe 4, pg/buggy 16, pg/safe 15. Full per-scenario table: `eval/results/dev-final-local.md`.

Official runtime measurement, dev set, designated CI job (Postgres 17.x, Node 22, `ubuntu-latest`), 3 attempts of run 40634541084 on one commit:

| Attempt | Median | p95 |
|---|---|---|
| 1 | 265 ms | 6,210 ms |
| 2 | 300 ms | 6,219 ms |
| 3 | 251 ms | 6,177 ms |

The slowest scenarios are the two deadlock ones (about 6.7 s locally, because every deadlocking schedule waits for `deadlock_timeout`, 300 ms) and the three-actor booking (about 22 s locally, 1,482 schedules).

## Held-out set, agent-written (NOT independent of the engine's author)

One local run, Postgres 17.11, engine commit `53701d6`, 2026-10-28 11:38 to 11:39 (+0530). Raw outputs: `eval/results/heldout-2026-10-28/heldout.*`.

| Scenario | Expected | Actual (confirmed findings) | Result | Confirmations | Schedules explored | Runtime |
|---|---|---|---|---|---|---|
| audit-log-uuid-pg | safe | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 6 | 0.24 s |
| giftcard-redeem-atomic-pg | safe | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 4 | 0.15 s |
| giftcard-redeem-pg | buggy (must fail "gift card never overdrawn") | VIOLATION:gift card never overdrawn; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 62 | 2.52 s |
| inventory-reserve-pg | buggy (must fail "reserved never exceeds on-hand") | VIOLATION:reserved never exceeds on-hand; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 38 | 1.47 s |
| job-claim-skiplocked-pg | safe | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 90 | 1.62 s |
| meeting-room-3actors-pg | buggy (must fail "no two reservations overlap") | VIOLATION:no two reservations overlap; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 66 | 0.90 s |
| payment-webhook-insertfirst-pg | safe | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 36 | 1.64 s |
| payment-webhook-pg | buggy (must fail "one ledger credit per payment") | VIOLATION:one ledger credit per payment; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 14 | 0.39 s |
| rate-limit-drizzle | buggy (must fail "allowed requests never exceed the quota") | VIOLATION:allowed requests never exceed the quota; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 14 | 0.92 s |
| stock-adjust-savepoint-pg | buggy (must fail "both adjustments applied") | VIOLATION:both adjustments applied; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 126 | 4.35 s |
| ticket-purchase-forupdate-knex | safe | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 36 | 1.82 s |
| ticket-purchase-knex | buggy (must fail "each seat sold at most once") | VIOLATION:each seat sold at most once; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 14 | 0.39 s |
| username-claim-pg-txn | buggy (must fail "usernames are unique") | VIOLATION:usernames are unique; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 44 | 0.69 s |
| username-claim-unique-handled-drizzle | safe | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 6 | 0.21 s |
| wallet-transfer-order-pg | buggy (must fail "no actor aborted by a deadlock") | VIOLATION:no actor aborted by a deadlock | match (hit) | 1 confirmed (each 3/3), 0 unconfirmed | 72 | 11.77 s |

## Held-out set, externally authored (independent of the engine author)

One local run, same engine commit, Postgres 17.11. Raw outputs: `eval/results/heldout-2026-10-28/heldout-human.*` (the script's own summary prints percentages; the counts below are the ones to quote at n = 5).

| Scenario | Expected | Actual (confirmed findings) | Result | Confirmations | Schedules explored | Runtime |
|---|---|---|---|---|---|---|
| leave-balance-overdraw | buggy (must fail "approved leave never exceeds the balance") | VIOLATION:approved leave never exceeds the balance; VIOLATION:balance plus approved leave equals the starting balance; ANOMALY:serial-equivalence | match (hit) | 3 confirmed (each 3/3), 0 unconfirmed | 14 | 0.53 s |
| retried-job-double-send | buggy (must fail "a job is sent at most once") | VIOLATION:a job is sent at most once; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 18 | 0.91 s |
| seat-hold-atomic-update | safe | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 6 | 0.42 s |
| wallet-optimistic-version | safe | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 6 | 0.28 s |
| webhook-credit-before-dedupe | buggy (must fail "a webhook event credits the account exactly once") | VIOLATION:a webhook event credits the account exactly once; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 18 | 0.90 s |

Counts: 3 of 3 buggy scenarios hit (0 mismatches, 0 misses); 0 of 2 safe scenarios flagged; 7 confirmed findings (each 3 of 3), 0 unconfirmed. **Sample size: 5 scenarios, 3 buggy and 2 safe, all written by one person, all raw `pg`.** The two safe scenarios were designed to catch a naive tool: `seat-hold-atomic-update` has the SELECT-then-UPDATE shape but a conditional write, and `wallet-optimistic-version` is a correct optimistic-concurrency retry loop. The buggy `webhook-credit-before-dedupe` has a UNIQUE constraint that fires too late: it is exactly the case the Phase 3 oracle change had to keep catching (the constraint rejection is excluded, the state is not).

The author listed a minimal preemption count of 1 for each buggy scenario. The metrics script does not record preemption counts and the set was run only once, so that figure was not checked.

## Misses, mismatches and false positives

None occurred in any set, so there is nothing to analyse one by one. Things that look like misses but are not, and that I checked in the data:

* Every buggy scenario that has hand-written invariants also produced a CONFIRMED `ANOMALY: serial-equivalence` finding alongside the `VIOLATION`; the metrics count a hit on the expected invariant name only. The deadlock scenarios (`wallet-transfer-order-pg` and the dev ones) produce only the `VIOLATION` (a deadlock-aborted actor is a retriable abort and does not make the outcome non-serial), as designed.
* The three dev out-of-scope scenarios are not misses: they are excluded from every rate (below).

## Honest limits (out-of-scope items; excluded from every rate)

| Scenario | What the tool did (dev run) | Required by its expected.json | Result |
|---|---|---|---|
| limits-parallel-statements | Exit 2, message: "UnsupportedError: parallel statements within one actor ("A"): interleave-pg cannot explore code that has two statements in flight at once, so it cannot say anything about..." | message matching /parallel statements within one actor/ | limit message present |
| limits-prisma-stub | Exit 2, message: "NoStatementsError: no statements intercepted: pg resolution mismatch? interleave-pg cannot see database calls that do not go through the app's pg package (for example Pri..." | message matching /cannot see database calls that do not go through the app's pg package/ | limit message present |
| limits-redis-lock | Reported 2 confirmed findings, each carrying the notice "This run cannot see locks held outside the database. If such a lock serializes these actors in production, this race may not occur there." | the notice on every confirmed finding | limit message present |

## Postgres versions (separate report; version differences only)

Workflow dispatch with `heldout=true`: https://github.com/Aditya-tec/interleave-pg/actions/runs/40642683696 (commit `0cff54b`, the engine code of `53701d6` plus test-only and documentation changes). Every job passed 310 tests with 0 skipped, the 5-iteration determinism check, the dev-set gates, and both held-out sets.

| Job | Result | Dev set (recall / FP) | Held-out agent-written (hits / FP) | Held-out human (hits / FP) |
|---|---|---|---|---|
| pg 15, node 20 | success | 100% / 0% | 9/9 / 0/6 | 3/3 / 0/2 |
| pg 15, node 22 | success | 100% / 0% | 9/9 / 0/6 | 3/3 / 0/2 |
| pg 16, node 20 | success | 100% / 0% | 9/9 / 0/6 | 3/3 / 0/2 |
| pg 16, node 22 | success | 100% / 0% | 9/9 / 0/6 | 3/3 / 0/2 |
| pg 17, node 20 | success | 100% / 0% | 9/9 / 0/6 | 3/3 / 0/2 |
| pg 17, node 22 | success | 100% / 0% | 9/9 / 0/6 | 3/3 / 0/2 |
| pg 18, node 20 | success | 100% / 0% | 9/9 / 0/6 | 3/3 / 0/2 |
| pg 18, node 22 | success | 100% / 0% | 9/9 / 0/6 | 3/3 / 0/2 |

**Version-specific differences found: none.** For each of the 15 agent-written and 5 human held-out scenarios, the outcome and the number of schedules explored were identical on all 8 jobs and identical to the official local run; the same is true of the 54 dev scenarios (compared from the logs of the first matrix run, 40633773987). Runtime differs by runner load only (held-out agent-written median 0.55 to 0.86 s, p95 10.6 to 11.6 s across jobs). The cross-version run did not change any official number.

## Threats to validity and what this does not show

* **No evidence about rates on real code.** 74 scenarios in total, 20 of them held out, all small: 2 to 3 actors, at most about 5 statements each, a handful of tables. The engine explores bounded schedules (at most 3 preemptions) and says so on every report.
* **Not independent.** The dev and agent-written held-out sets share an author with the engine; both came out perfect on the first measurement, so they do not discriminate between "the engine is good" and "the author writes scenarios the author's engine handles". Only the externally authored set is independent, and it has 5 scenarios.
* **The serial oracle is a heuristic.** Code that correctly relies on a non-retriable outcome difference (for example a "foreign key violation is the right answer" design) is flagged by design (the 23503 case); only 23505 and 23P01 are treated as rejections.
* **Out of scope in v1** and still true: Prisma and any driver that bypasses `pg`, multi-process apps, locks held outside the database, parallel statements inside one actor, LISTEN/NOTIFY.
* **A protocol incident, disclosed in HELDOUT.md:** a test of mine explored the human held-out set on CI about 25 seconds before the official local run of it. Nothing was used or changed; the CI numbers agree with the local ones.

## Findings logged for Phase 4 (no engine change was made after the freeze)

1. **Schema isolation between scenarios** (`docs/LIMITATIONS.md`): scenarios sharing one database keep stale tables through `CREATE TABLE IF NOT EXISTS`. The fix should isolate each run, not rely on authors writing DROPs.
2. The metrics script prints percentages for every set; at n = 5 only counts should be quoted. It should print counts for small sets.
3. The metrics test that proves `heldout-human` pickup now restricts itself with `--only`; a structural guard (a second corpus root for tests) would remove this class of mistake.
4. The metrics script does not record preemption counts, so an author-supplied `minPreemptions` cannot be checked after a single run.
