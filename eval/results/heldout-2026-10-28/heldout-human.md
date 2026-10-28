### Set `heldout-human`: 5 scenarios

| Metric | Value | Gate |
|---|---|---|
| Recall | 100.0% (3/3 in-scope buggy; 0 mismatch, 0 miss) | PASS |
| False-positive rate | 0.0% (0/2 in-scope safe; 0 safe errors) | PASS |
| Confirmation rate | 100.0% (7 confirmed, 0 unconfirmed) | PASS |
| Schedules explored | median 14, p95 18 | reported |
| Runtime | median 0.53 s, p95 0.91 s (local, this machine) | PASS / PASS (official: CI job) |

| Scenario | Expected | Class | Driver | Outcome | Schedules | Runtime | Notes |
|---|---|---|---|---|---|---|---|
| leave-balance-overdraw | buggy | lost-update | pg | hit | 14 | 0.53 s |  |
| retried-job-double-send | buggy | check-then-insert | pg | hit | 18 | 0.91 s |  |
| seat-hold-atomic-update | safe |  | pg | clean | 6 | 0.42 s |  |
| wallet-optimistic-version | safe |  | pg | clean | 6 | 0.28 s |  |
| webhook-credit-before-dedupe | buggy | idempotency-race | pg | hit | 18 | 0.90 s |  |
