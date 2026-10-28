### Set `hard`: 32 scenarios

| Metric | Value | Gate |
|---|---|---|
| Recall | 100.0% (14/14 in-scope buggy; 0 mismatch, 0 miss) | PASS |
| False-positive rate | 0.0% (0/14 in-scope safe; 0 safe errors) | PASS |
| Confirmation rate | 100.0% (27 confirmed, 0 unconfirmed) | PASS |
| Schedules explored | median 36, p95 552 | reported |
| Runtime | median 1.08 s, p95 20.68 s (local, this machine) | PASS / PASS (official: CI job) |

| Scenario | Expected | Class | Driver | Outcome | Schedules | Preemptions (derived / observed) | Runtime | Notes |
|---|---|---|---|---|---|---|---|---|
| advisory-early-unlock | buggy | advisory-lock-released-early | pg | hit | 26 | 1 / 1 | 1.12 s |  |
| advisory-key-mismatch | buggy | advisory-lock-key-mismatch | pg | hit | 82 | 1 / 1 | 2.27 s |  |
| advisory-xact-lock-safe | safe | lost-update-fixed-advisory-xact-lock | pg | clean | 36 | - / - | 1.78 s |  |
| cas-retry-loop-safe | safe | optimistic-lock-retry | pg | clean | 6 | - / - | 0.17 s |  |
| check-constraint-withdraw-safe | safe | db-enforced-check | pg | clean | 6 | - / - | 0.18 s |  |
| claim-backoff-both-yield | buggy | liveness-both-back-off | pg | hit | 12 | 2 / 2 | 0.28 s |  |
| claim-precheck-deep-yield | buggy | liveness-both-back-off-deep | pg | hit | 16 | 3 / 3 | 0.35 s |  |
| deadlock-opposite-order | buggy | deadlock-no-retry | pg | hit | 52 | 1 / 1 | 9.18 s |  |
| deferred-unique-commit-safe | safe | db-enforced-deferred-unique | pg | clean | 44 | - / - | 1.08 s |  |
| drizzle-atomic-update-safe | safe | capacity-fixed-atomic-update | drizzle | clean | 24 | - / - | 1.28 s |  |
| drizzle-txn-oversell | buggy | check-then-insert-capacity | drizzle | hit | 90 | 1 / 1 | 1.55 s |  |
| knex-txn-forupdate-safe | safe | lost-update-fixed-row-lock | knex | clean | 24 | - / - | 1.07 s |  |
| knex-txn-lost-update | buggy | lost-update | knex | hit | 38 | 1 / 1 | 1.28 s |  |
| limit-nondeterministic-race | buggy (out of scope) | nondeterministic-statements | pg | limit-ok | 18 | - / 1 | 0.34 s |  |
| limit-promise-all | unsupported (out of scope) | parallel-statements-in-one-actor | pg | limit-ok | - | - / - | 0.09 s | UnsupportedError: parallel statements within one actor ("A"): interleave-pg cannot explore code that has two statements in flight at once, so it cannot say anyt |
| limit-state-explosion | unsupported (out of scope) | state-explosion | pg | limit-ok | 2000 | - / - | 41.71 s |  |
| limit-timer-wait | unsupported (out of scope) | non-database-wait | pg | limit-ok | - | - / - | 5.19 s | StallError: actor "A" stalled outside the database; stub external calls in the scenario |
| ordered-locking-transfers-safe | safe | deadlock-fixed-lock-ordering | pg | clean | 50 | - / - | 2.08 s |  |
| queue-claim-select-update | buggy | queue-double-claim | pg | hit | 18 | 1 / 1 | 0.39 s |  |
| queue-claim-skip-locked | safe | queue-claim-fixed-skip-locked | pg | clean | 90 | - / - | 1.45 s |  |
| quota-three-actors | buggy | quota-overrun-3-actors | pg | hit | 552 | 1 / 1 | 8.39 s |  |
| retry-stale-balance | buggy | lost-update-retry-loop | pg | hit | 6 | 1 / 1 | 0.22 s |  |
| savepoint-dup-guard-safe | safe | savepoint-handled-unique-violation | pg | clean | 62 | - / - | 1.98 s |  |
| savepoint-stock-rmw | buggy | lost-update-with-savepoints | pg | hit | 516 | 1 / 1 | 22.51 s |  |
| ser-no-retry | safe | serializable-no-retry | pg | clean | 44 | - / - | 0.59 s |  |
| ser-with-retry | safe | serializable-with-retry | pg | clean | 44 | - / - | 0.62 s |  |
| unique-check-then-insert-safe | safe | db-enforced-unique | pg | clean | 6 | - / - | 0.19 s |  |
| upsert-branch-dup-rows | buggy | check-then-insert-branching | pg | hit | 6 | 1 / 1 | 0.19 s |  |
| upsert-branch-safe | safe | upsert-branching | pg | clean | 6 | - / - | 0.16 s |  |
| webhook-dedupe-first-safe | safe | webhook-duplicate-fixed-dedupe-first | pg | clean | 24 | - / - | 0.88 s |  |
| webhook-effect-before-dedupe | buggy | webhook-duplicate | pg | hit | 82 | 1 / 1 | 2.24 s |  |
| writeskew-three-oncall | buggy | write-skew-3-actors | pg | hit | 1752 | 1 / 1 | 20.68 s |  |
