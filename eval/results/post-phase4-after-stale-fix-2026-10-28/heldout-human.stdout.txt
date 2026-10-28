### Set `heldout-human`: 5 scenarios

| Metric | Value | Gate |
|---|---|---|
| Recall | 3 of 3 in-scope buggy hit (0 mismatches, 0 misses) | PASS |
| False positives | 0 of 2 in-scope safe flagged (0 safe errors) | PASS |
| Confirmation | 7 confirmed, 0 unconfirmed | PASS |
| Schedules explored | median 14, p95 18 | reported |
| Sample | small sample: 5 scenarios (fewer than 20); quote the counts, not rates | n/a |
| Runtime | median 0.44 s, p95 0.86 s (local, this machine) | PASS / PASS (official: CI job) |

| Scenario | Expected | Class | Driver | Outcome | Schedules | Preemptions (derived / observed) | Runtime | Notes |
|---|---|---|---|---|---|---|---|---|
| leave-balance-overdraw | buggy | lost-update | pg | hit | 14 | 1 / 1 | 0.44 s |  |
| retried-job-double-send | buggy | check-then-insert | pg | hit | 18 | 1 / 1 | 0.86 s |  |
| seat-hold-atomic-update | safe |  | pg | clean | 6 | - / - | 0.12 s |  |
| wallet-optimistic-version | safe |  | pg | clean | 6 | - / - | 0.13 s |  |
| webhook-credit-before-dedupe | buggy | idempotency-race | pg | hit | 18 | 1 / 1 | 0.57 s |  |
