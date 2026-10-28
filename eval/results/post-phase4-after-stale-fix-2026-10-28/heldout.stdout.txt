### Set `heldout`: 15 scenarios

| Metric | Value | Gate |
|---|---|---|
| Recall | 9 of 9 in-scope buggy hit (0 mismatches, 0 misses) | PASS |
| False positives | 0 of 6 in-scope safe flagged (0 safe errors) | PASS |
| Confirmation | 17 confirmed, 0 unconfirmed | PASS |
| Schedules explored | median 36, p95 126 | reported |
| Sample | small sample: 15 scenarios (fewer than 20); quote the counts, not rates | n/a |
| Runtime | median 1.32 s, p95 11.46 s (local, this machine) | PASS / PASS (official: CI job) |

| Scenario | Expected | Class | Driver | Outcome | Schedules | Preemptions (derived / observed) | Runtime | Notes |
|---|---|---|---|---|---|---|---|---|
| audit-log-uuid-pg | safe | benign-control | pg | clean | 6 | - / - | 0.25 s |  |
| giftcard-redeem-atomic-pg | safe | coupon | pg | clean | 4 | - / - | 0.18 s |  |
| giftcard-redeem-pg | buggy | coupon | pg | hit | 62 | - / 1 | 2.76 s |  |
| inventory-reserve-pg | buggy | oversell | pg | hit | 38 | - / 1 | 1.32 s |  |
| job-claim-skiplocked-pg | safe | queue-claim | pg | clean | 90 | - / - | 1.35 s |  |
| meeting-room-3actors-pg | buggy | phantom-booking | pg | hit | 66 | - / 1 | 1.36 s |  |
| payment-webhook-insertfirst-pg | safe | webhook-duplicate | pg | clean | 36 | - / - | 1.43 s |  |
| payment-webhook-pg | buggy | webhook-duplicate | pg | hit | 14 | - / 1 | 0.34 s |  |
| rate-limit-drizzle | buggy | lost-update | drizzle | hit | 14 | - / 1 | 0.76 s |  |
| stock-adjust-savepoint-pg | buggy | lost-update | pg | hit | 126 | - / 1 | 3.93 s |  |
| ticket-purchase-forupdate-knex | safe | queue-claim | knex | clean | 36 | - / - | 1.68 s |  |
| ticket-purchase-knex | buggy | queue-claim | knex | hit | 14 | - / 1 | 0.36 s |  |
| username-claim-pg-txn | buggy | check-then-insert | pg | hit | 44 | - / 1 | 0.58 s |  |
| username-claim-unique-handled-drizzle | safe | check-then-insert | drizzle | clean | 6 | - / - | 0.20 s |  |
| wallet-transfer-order-pg | buggy | deadlock | pg | hit | 72 | - / 1 | 11.46 s |  |
