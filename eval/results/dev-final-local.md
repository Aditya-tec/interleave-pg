### Set `dev`: 54 scenarios

| Metric | Value | Gate |
|---|---|---|
| Recall | 100.0% (29/29 in-scope buggy; 0 mismatch, 0 miss) | PASS |
| False-positive rate | 0.0% (0/22 in-scope safe; 0 safe errors) | PASS |
| Confirmation rate | 100.0% (59 confirmed, 0 unconfirmed) | PASS |
| Schedules explored | median 14, p95 54 | reported |
| Runtime | median 0.51 s, p95 6.82 s (local, this machine) | PASS / PASS (official: CI job) |

| Scenario | Expected | Class | Driver | Outcome | Schedules | Runtime | Notes |
|---|---|---|---|---|---|---|---|
| benign-knex | safe | benign-control | knex | clean | 6 | 0.89 s |  |
| benign-pg | safe | benign-control | pg | clean | 6 | 0.24 s |  |
| booking-knex-none | buggy | phantom-booking | knex | hit | 6 | 0.33 s |  |
| booking-pg-advisory | safe | phantom-booking | pg | clean | 36 | 1.60 s |  |
| booking-pg-none | buggy | phantom-booking | pg | hit | 6 | 0.26 s |  |
| booking-pg-txn-3actors | buggy | phantom-booking | pg | hit | 1482 | 24.29 s |  |
| counter-pg-serializable-retry | safe | retry-wrapper-control | pg | clean | 38 | 1.46 s |  |
| coupon-drizzle-none | buggy | coupon | drizzle | hit | 14 | 0.55 s |  |
| coupon-knex-none | buggy | coupon | knex | hit | 14 | 0.52 s |  |
| coupon-pg-atomic | safe | coupon | pg | clean | 4 | 0.17 s |  |
| coupon-pg-none | buggy | coupon | pg | hit | 14 | 0.43 s |  |
| cti-drizzle-none | buggy | check-then-insert | drizzle | hit | 6 | 0.24 s |  |
| cti-drizzle-onconflict | safe | check-then-insert | drizzle | clean | 2 | 0.13 s |  |
| cti-knex-none | buggy | check-then-insert | knex | hit | 6 | 0.31 s |  |
| cti-knex-onconflict | safe | check-then-insert | knex | clean | 2 | 0.14 s |  |
| cti-pg-none | buggy | check-then-insert | pg | hit | 6 | 0.28 s |  |
| cti-pg-onconflict | safe | check-then-insert | pg | clean | 2 | 0.14 s |  |
| cti-pg-txn | buggy | check-then-insert | pg | hit | 44 | 0.93 s |  |
| cti-pg-unique-handled | safe | check-then-insert | pg | clean | 6 | 0.23 s |  |
| deadlock-knex-none | buggy | deadlock | knex | hit | 34 | 6.95 s |  |
| deadlock-pg-lockorder | safe | deadlock | pg | clean | 24 | 1.07 s |  |
| deadlock-pg-none | buggy | deadlock | pg | hit | 34 | 6.82 s |  |
| idem-drizzle-none | buggy | idempotency-key | drizzle | hit | 18 | 0.93 s |  |
| idem-pg-insertfirst | safe | idempotency-key | pg | clean | 24 | 1.03 s |  |
| idem-pg-none | buggy | idempotency-key | pg | hit | 18 | 0.85 s |  |
| limits-parallel-statements | unsupported (out of scope) | limit-parallel-statements | pg | limit-ok | - | 0.12 s | UnsupportedError: parallel statements within one actor ("A"): interleave-pg cannot explore code that has two statements in flight at once, so it cannot say anyt |
| limits-prisma-stub | unsupported (out of scope) | limit-bypassing-driver | stub | limit-ok | - | 0.05 s | NoStatementsError: no statements intercepted: pg resolution mismatch? interleave-pg cannot see database calls that do not go through the app's pg package (for e |
| limits-redis-lock | unsupported (out of scope) | limit-external-lock | pg | limit-ok | 14 | 0.47 s |  |
| lost-update-drizzle-increment | safe | lost-update | drizzle | clean | 2 | 0.14 s |  |
| lost-update-drizzle-rmw | buggy | lost-update | drizzle | hit | 6 | 0.29 s |  |
| lost-update-knex-increment | safe | lost-update | knex | clean | 2 | 0.15 s |  |
| lost-update-knex-rmw | buggy | lost-update | knex | hit | 6 | 0.31 s |  |
| lost-update-pg-3actors | buggy | lost-update | pg | hit | 90 | 1.99 s |  |
| lost-update-pg-atomic | safe | lost-update | pg | clean | 2 | 0.13 s |  |
| lost-update-pg-forupdate | safe | lost-update | pg | clean | 24 | 1.10 s |  |
| lost-update-pg-rmw | buggy | lost-update | pg | hit | 6 | 0.23 s |  |
| lost-update-pg-txn | buggy | lost-update | pg | hit | 38 | 1.93 s |  |
| oversell-drizzle-atomic | safe | oversell | drizzle | clean | 4 | 0.17 s |  |
| oversell-drizzle-relative | buggy | oversell | drizzle | hit | 14 | 0.52 s |  |
| oversell-knex-atomic | safe | oversell | knex | clean | 4 | 0.19 s |  |
| oversell-knex-relative | buggy | oversell | knex | hit | 14 | 0.50 s |  |
| oversell-pg-absolute | buggy | oversell | pg | hit | 14 | 0.48 s |  |
| oversell-pg-atomic | safe | oversell | pg | clean | 4 | 0.18 s |  |
| oversell-pg-relative | buggy | oversell | pg | hit | 14 | 0.44 s |  |
| queue-pg-none | buggy | queue-claim | pg | hit | 14 | 0.41 s |  |
| queue-pg-skiplocked | safe | queue-claim | pg | clean | 54 | 0.95 s |  |
| webhook-knex-none | buggy | webhook-duplicate | knex | hit | 18 | 0.51 s |  |
| webhook-pg-insertfirst | safe | webhook-duplicate | pg | clean | 24 | 1.49 s |  |
| webhook-pg-none | buggy | webhook-duplicate | pg | hit | 18 | 0.66 s |  |
| writeskew-drizzle-doctors | buggy | write-skew | drizzle | hit | 44 | 0.78 s |  |
| writeskew-pg-doctors | buggy | write-skew | pg | hit | 44 | 0.56 s |  |
| writeskew-pg-forupdate | safe | write-skew | pg | clean | 24 | 0.85 s |  |
| writeskew-pg-funds | buggy | write-skew | pg | hit | 44 | 0.57 s |  |
| writeskew-pg-serializable-retry | safe | write-skew | pg | clean | 44 | 0.56 s |  |
