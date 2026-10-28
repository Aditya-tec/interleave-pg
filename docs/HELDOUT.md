# Held-out set: what it is, and proof it was fixed before it was measured

The held-out set is `corpus/heldout/` (15 scenarios, all written fresh, in different domains from the dev set and without using `corpus/_lib/families.mjs`) plus whatever the project owner places in `corpus/heldout-human/`. The engine is never tuned against either. The official held-out numbers come from **one** local run on Postgres 17, made after the project owner confirms `corpus/heldout-human/` is complete. A later CI run on other Postgres versions is a separate report of version differences (see `docs/phase-3-report.md`).

## The set

| Scenario | Expected | Class | Driver |
|---|---|---|---|
| inventory-reserve-pg | buggy | oversell | pg |
| giftcard-redeem-pg | buggy | coupon / gift card | pg |
| ticket-purchase-knex | buggy | queue claim (double sale) | knex |
| rate-limit-drizzle | buggy | lost update / check-then-act | drizzle |
| username-claim-pg-txn | buggy | check-then-insert | pg |
| payment-webhook-pg | buggy | webhook duplicate | pg |
| meeting-room-3actors-pg | buggy | overlapping booking, 3 actors | pg |
| wallet-transfer-order-pg | buggy | deadlock | pg |
| stock-adjust-savepoint-pg | buggy | lost update through a savepoint | pg |
| giftcard-redeem-atomic-pg | safe | atomic conditional UPDATE | pg |
| ticket-purchase-forupdate-knex | safe | transaction + FOR UPDATE | knex |
| payment-webhook-insertfirst-pg | safe | event id inserted first (unique) | pg |
| username-claim-unique-handled-drizzle | safe | UNIQUE constraint + handled violation | drizzle |
| job-claim-skiplocked-pg | safe | FOR UPDATE SKIP LOCKED | pg |
| audit-log-uuid-pg | safe | benign nondeterminism (uuid, timestamp) | pg |

9 buggy and 6 safe; 11 use raw `pg`, 2 knex (one buggy, one safe) and 2 Drizzle (one buggy, one safe).

Each directory holds `scenario.mjs`, `schema.sql` and `expected.json`. Every `expected.json` was written together with its scenario, before any exploration run of the set, and is not edited after a result is seen.

## What was run on these files before the hash was recorded (full disclosure)

* Only the **single-user check** (`test/corpus-unit.test.ts`: the actors run one after another, A then B and B then A, with every invariant required to hold) was run on the held-out scenarios, to make sure none of them is itself broken. That check executes serial schedules through the engine's runner; it does not explore interleavings and produced no finding. All 15 passed on the first run, so no held-out file was edited afterwards.
* No exploration, no `engine-metrics` run, no CLI `run` was made on any file under `corpus/heldout/`.

## The hash

The tree hash is the sha256 of the sorted list of `sha256  path` lines for every file under `corpus/heldout/` and the three shared helper modules those scenarios import (`corpus/_lib/lib.mjs`, `lib-knex.mjs`, `lib-drizzle.mjs`), with line endings normalised to LF. Recompute it with `node eval/hash-heldout.mjs`; the final run checks it with `node eval/hash-heldout.mjs --verify <hash>` and refuses to run if it differs.

| | |
|---|---|
| Tree sha256 | `4daa9bdf0c9074a99e7a5e47abf42baed360dbbc95a12305089d60655ce78a66` |
| Files hashed | 48 |
| Git commit that introduced the set | `7e78038d374af1d76acb205c2168809e287f312c` |

The commit is pushed to `origin` before the final run, so GitHub's push time is an independent timestamp.

## Procedure for the final run

1. The project owner confirms `corpus/heldout-human/` is complete (their scenarios committed; the hash of that directory is appended to this file at that point).
2. `node eval/hash-heldout.mjs --verify 4daa9bdf0c9074a99e7a5e47abf42baed360dbbc95a12305089d60655ce78a66`
3. `INTERLEAVE_DSN=... node eval/engine-metrics.js --set heldout --out ...` and the same for `heldout-human`, once, on Postgres 17 locally.
4. The numbers are published as they come (`docs/ENGINE_RESULTS.md`), separately from the dev numbers. No engine change follows.
