### Set `heldout`: 15 scenarios

| Metric | Value | Gate |
|---|---|---|
| Recall | 100.0% (9/9 in-scope buggy; 0 mismatch, 0 miss) | PASS |
| False-positive rate | 0.0% (0/6 in-scope safe; 0 safe errors) | PASS |
| Confirmation rate | 100.0% (17 confirmed, 0 unconfirmed) | PASS |
| Schedules explored | median 36, p95 126 | reported |
| Runtime | median 0.92 s, p95 11.77 s (local, this machine) | PASS / PASS (official: CI job) |

| Scenario | Expected | Class | Driver | Outcome | Schedules | Runtime | Notes |
|---|---|---|---|---|---|---|---|
| audit-log-uuid-pg | safe | benign-control | pg | clean | 6 | 0.24 s |  |
| giftcard-redeem-atomic-pg | safe | coupon | pg | clean | 4 | 0.15 s |  |
| giftcard-redeem-pg | buggy | coupon | pg | hit | 62 | 2.52 s |  |
| inventory-reserve-pg | buggy | oversell | pg | hit | 38 | 1.47 s |  |
| job-claim-skiplocked-pg | safe | queue-claim | pg | clean | 90 | 1.62 s |  |
| meeting-room-3actors-pg | buggy | phantom-booking | pg | hit | 66 | 0.90 s |  |
| payment-webhook-insertfirst-pg | safe | webhook-duplicate | pg | clean | 36 | 1.64 s |  |
| payment-webhook-pg | buggy | webhook-duplicate | pg | hit | 14 | 0.39 s |  |
| rate-limit-drizzle | buggy | lost-update | drizzle | hit | 14 | 0.92 s |  |
| stock-adjust-savepoint-pg | buggy | lost-update | pg | hit | 126 | 4.35 s |  |
| ticket-purchase-forupdate-knex | safe | queue-claim | knex | clean | 36 | 1.82 s |  |
| ticket-purchase-knex | buggy | queue-claim | knex | hit | 14 | 0.39 s |  |
| username-claim-pg-txn | buggy | check-then-insert | pg | hit | 44 | 0.69 s |  |
| username-claim-unique-handled-drizzle | safe | check-then-insert | drizzle | clean | 6 | 0.21 s |  |
| wallet-transfer-order-pg | buggy | deadlock | pg | hit | 72 | 11.77 s |  |
