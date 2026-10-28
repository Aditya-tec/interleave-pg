### Set `heldout`: 15 scenarios

| Metric | Value | Gate |
|---|---|---|
| Recall | 9 of 9 in-scope buggy hit (0 mismatches, 0 misses) | PASS |
| False positives | 0 of 6 in-scope safe flagged (0 safe errors) | PASS |
| Confirmation | 17 confirmed, 0 unconfirmed | PASS |
| Schedules explored | median 36, p95 126 | reported |
| Sample | small sample: 15 scenarios (fewer than 20); quote the counts, not rates | n/a |
| Runtime | median 1.11 s, p95 12.12 s (local, this machine) | PASS / PASS (official: CI job) |

| Scenario | Expected | Class | Driver | Outcome | Schedules | Preemptions (derived / observed) | Runtime | Notes |
|---|---|---|---|---|---|---|---|---|
| audit-log-uuid-pg | safe | benign-control | pg | clean | 6 | - / - | 0.28 s |  |
| giftcard-redeem-atomic-pg | safe | coupon | pg | clean | 4 | - / - | 0.19 s |  |
| giftcard-redeem-pg | buggy | coupon | pg | hit | 62 | - / 1 | 2.45 s |  |
| inventory-reserve-pg | buggy | oversell | pg | hit | 38 | - / 1 | 1.43 s |  |
| job-claim-skiplocked-pg | safe | queue-claim | pg | clean | 90 | - / - | 1.71 s |  |
| meeting-room-3actors-pg | buggy | phantom-booking | pg | hit | 66 | - / 1 | 1.11 s |  |
| payment-webhook-insertfirst-pg | safe | webhook-duplicate | pg | clean | 36 | - / - | 2.22 s |  |
| payment-webhook-pg | buggy | webhook-duplicate | pg | hit | 14 | - / 1 | 0.53 s |  |
| rate-limit-drizzle | buggy | lost-update | drizzle | hit | 14 | - / 1 | 1.06 s |  |
| stock-adjust-savepoint-pg | buggy | lost-update | pg | hit | 126 | - / 1 | 4.26 s |  |
| ticket-purchase-forupdate-knex | safe | queue-claim | knex | clean | 36 | - / - | 1.90 s |  |
| ticket-purchase-knex | buggy | queue-claim | knex | hit | 14 | - / 1 | 0.46 s |  |
| username-claim-pg-txn | buggy | check-then-insert | pg | hit | 44 | - / 1 | 0.76 s |  |
| username-claim-unique-handled-drizzle | safe | check-then-insert | drizzle | clean | 6 | - / - | 0.23 s |  |
| wallet-transfer-order-pg | buggy | deadlock | pg | hit | 72 | - / 1 | 12.12 s |  |
