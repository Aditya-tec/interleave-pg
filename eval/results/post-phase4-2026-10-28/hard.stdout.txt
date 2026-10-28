### Set `hard`: 32 scenarios

| Metric | Value | Gate |
|---|---|---|
| Recall | 92.9% (13/14 in-scope buggy; 0 mismatch, 1 miss) | PASS |
| False-positive rate | 0.0% (0/14 in-scope safe; 0 safe errors) | PASS |
| Confirmation rate | 100.0% (25 confirmed, 0 unconfirmed) | PASS |
| Schedules explored | median 38, p95 552 | reported |
| Runtime | median 1.22 s, p95 31.33 s (local, this machine) | PASS / PASS (official: CI job) |

| Scenario | Expected | Class | Driver | Outcome | Schedules | Preemptions (derived / observed) | Runtime | Notes |
|---|---|---|---|---|---|---|---|---|
| advisory-early-unlock | buggy | advisory-lock-released-early | pg | hit | 26 | 1 / 1 | 1.16 s |  |
| advisory-key-mismatch | buggy | advisory-lock-key-mismatch | pg | hit | 82 | 1 / 1 | 2.50 s |  |
| advisory-xact-lock-safe | safe | lost-update-fixed-advisory-xact-lock | pg | clean | 36 | - / - | 2.03 s |  |
| cas-retry-loop-safe | safe | optimistic-lock-retry | pg | clean | 6 | - / - | 0.26 s |  |
| check-constraint-withdraw-safe | safe | db-enforced-check | pg | clean | 6 | - / - | 0.29 s |  |
| claim-backoff-both-yield | buggy | liveness-both-back-off | pg | hit | 12 | 2 / 2 | 0.34 s |  |
| claim-precheck-deep-yield | buggy | liveness-both-back-off-deep | pg | hit | 16 | 3 / 3 | 0.39 s |  |
| deadlock-opposite-order | buggy | deadlock-no-retry | pg | hit | 52 | 1 / 1 | 9.71 s |  |
| deferred-unique-commit-safe | safe | db-enforced-deferred-unique | pg | clean | 44 | - / - | 1.68 s |  |
| drizzle-atomic-update-safe | safe | capacity-fixed-atomic-update | drizzle | clean | 24 | - / - | 1.67 s |  |
| drizzle-txn-oversell | buggy | check-then-insert-capacity | drizzle | hit | 90 | 1 / 1 | 1.99 s |  |
| knex-txn-forupdate-safe | safe | lost-update-fixed-row-lock | knex | clean | 24 | - / - | 1.22 s |  |
| knex-txn-lost-update | buggy | lost-update | knex | hit | 38 | 1 / 1 | 1.47 s |  |
| limit-nondeterministic-race | buggy (out of scope) | nondeterministic-statements | pg | limit-ok | 18 | - / 1 | 0.39 s |  |
| limit-promise-all | unsupported (out of scope) | parallel-statements-in-one-actor | pg | limit-ok | - | - / - | 0.09 s | UnsupportedError: parallel statements within one actor ("A"): interleave-pg cannot explore code that has two statements in flight at once, so it cannot say anyt |
| limit-state-explosion | unsupported (out of scope) | state-explosion | pg | limit-ok | 2000 | - / - | 64.59 s |  |
| limit-timer-wait | unsupported (out of scope) | non-database-wait | pg | limit-ok | - | - / - | 5.22 s | StallError: actor "A" stalled outside the database; stub external calls in the scenario |
| ordered-locking-transfers-safe | safe | deadlock-fixed-lock-ordering | pg | clean | 50 | - / - | 2.41 s |  |
| queue-claim-select-update | buggy | queue-double-claim | pg | miss | - | 1 / - | 0.46 s | UnsupportedError: parallel statements within one actor ("A"): interleave-pg cannot explore code that has two statements in flight at once, so it cannot say anyt |
| queue-claim-skip-locked | safe | queue-claim-fixed-skip-locked | pg | clean | 90 | - / - | 1.70 s |  |
| quota-three-actors | buggy | quota-overrun-3-actors | pg | hit | 552 | 1 / 1 | 10.23 s |  |
| retry-stale-balance | buggy | lost-update-retry-loop | pg | hit | 6 | 1 / 1 | 0.28 s |  |
| savepoint-dup-guard-safe | safe | savepoint-handled-unique-violation | pg | clean | 62 | - / - | 2.08 s |  |
| savepoint-stock-rmw | buggy | lost-update-with-savepoints | pg | hit | 516 | 1 / 1 | 31.33 s |  |
| ser-no-retry | safe | serializable-no-retry | pg | clean | 44 | - / - | 0.90 s |  |
| ser-with-retry | safe | serializable-with-retry | pg | clean | 44 | - / - | 0.80 s |  |
| unique-check-then-insert-safe | safe | db-enforced-unique | pg | clean | 6 | - / - | 0.29 s |  |
| upsert-branch-dup-rows | buggy | check-then-insert-branching | pg | hit | 6 | 1 / 1 | 0.35 s |  |
| upsert-branch-safe | safe | upsert-branching | pg | clean | 6 | - / - | 0.35 s |  |
| webhook-dedupe-first-safe | safe | webhook-duplicate-fixed-dedupe-first | pg | clean | 24 | - / - | 1.01 s |  |
| webhook-effect-before-dedupe | buggy | webhook-duplicate | pg | hit | 82 | 1 / 1 | 3.01 s |  |
| writeskew-three-oncall | buggy | write-skew-3-actors | pg | hit | 1752 | 1 / 1 | 36.35 s |  |
