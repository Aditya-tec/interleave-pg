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

---

# Human held-out set (`corpus/heldout-human/`)

**Authorship label used in every report:** these five scenarios were **externally authored, by someone other than the engine's author, and are independent of the engine author**. The 15 scenarios in `corpus/heldout/` were written by the same agent that wrote the engine and are **not independent of the engine's author**; the two sets are always reported separately and never merged.

| Scenario | Expected | Class (as authored) |
|---|---|---|
| leave-balance-overdraw | buggy | lost-update |
| retried-job-double-send | buggy | check-then-insert |
| webhook-credit-before-dedupe | buggy | idempotency-race (a UNIQUE constraint is hit too late; tests that the oracle does not hide the bug because a constraint error occurred) |
| seat-hold-atomic-update | safe | atomic conditional UPDATE after a peek (a tool that flags every SELECT-then-UPDATE would false-positive) |
| wallet-optimistic-version | safe | optimistic concurrency, version column + retry loop |

## Committed untouched, then adapted in a separate commit

* `12e48fd9f716468114bfc39e3bd471e96114b46b`: the five scenarios **byte for byte as supplied** (20 files: `schema.sql`, `app.mjs`, `scenario.mjs`, `expected.json` each). Tree hash of that state (same method as below, scenario directories only): `0488bfc6a6b280d63bbf07c58a49f1b5f660c9a826f43f972cd214d1f771379d`.
* `c240cc004d14136a6084661f8073afaf3c64d714`: the mechanical adaptations only (`git diff 12e48fd c240cc0 -- corpus/heldout-human`).

### Every adaptation

1. **`schema.sql`: `DROP TABLE IF EXISTS ... CASCADE;` lines prepended** (the `CREATE TABLE IF NOT EXISTS` lines are untouched, byte for byte). Needed because every corpus scenario shares one throwaway database and `IF NOT EXISTS` silently keeps a stale table with other columns: unadapted, three of the five failed their serial run with `column "credits" of relation "accounts" does not exist`, `column "holder" of relation "seats" does not exist` and `column "id" of relation "wallets" does not exist` (other scenarios own tables of the same names). This is the isolation rule from the README ("drop-then-create every table"). Added lines:
   * leave-balance-overdraw: `DROP TABLE IF EXISTS leave_requests CASCADE;` `DROP TABLE IF EXISTS leave_balances CASCADE;`
   * retried-job-double-send: `DROP TABLE IF EXISTS outbox CASCADE;` `DROP TABLE IF EXISTS jobs CASCADE;`
   * webhook-credit-before-dedupe: `DROP TABLE IF EXISTS webhook_events CASCADE;` `DROP TABLE IF EXISTS accounts CASCADE;`
   * seat-hold-atomic-update: `DROP TABLE IF EXISTS seats CASCADE;`
   * wallet-optimistic-version: `DROP TABLE IF EXISTS wallets CASCADE;`
2. **`expected.json`: field names mapped to this repo's format** (`docs/METRICS.md`): `verdict` to `expect`, `bugClass` to `class`, `mustFailInvariant` to `invariant`; added `id`, `scope: "in"`, `driver: "pg"`; kept `minPreemptions` and `notes` as extra fields (ignored by the metrics script); no `class`, `invariant` or `fix` are invented for the two safe scenarios. The author's file is preserved byte for byte as `expected.original.json` next to it. Invariant names, verdicts and notes are unchanged.

### Not adapted

`scenario.mjs` and `app.mjs` are untouched. `import { defineScenario } from 'interleave-pg'` resolves through the workspace link in `node_modules` to `packages/engine/dist` (so the engine must be built; `npm run build`, which every test and metrics command already does). `setup({ dsn })` already receives the dsn as they wrote it. No SQL in a handler, no invariant and no expectation was changed.

## Serial single-user sanity check (the only run made on these files)

`node eval/serial-check.mjs` runs each scenario's actors one after another (A then B, and B then A), with no exploration, and compares with the serial results the author listed. After the adaptations, on Postgres 17, all ten runs matched, with every invariant holding:

```
ok   leave-balance-overdraw A,B: first={"approved":true} second={"approved":false} balance 2: got 2; invariants violated: 0
ok   leave-balance-overdraw B,A: first={"approved":true} second={"approved":false} balance 2: got 2; invariants violated: 0
ok   retried-job-double-send A,B: first={"sent":true} second={"skipped":true} outbox rows 1: got 1; invariants violated: 0
ok   retried-job-double-send B,A: first={"sent":true} second={"skipped":true} outbox rows 1: got 1; invariants violated: 0
ok   webhook-credit-before-dedupe A,B: first={"applied":true} second={"duplicate":true} credits 10: got 10; invariants violated: 0
ok   webhook-credit-before-dedupe B,A: first={"applied":true} second={"duplicate":true} credits 10: got 10; invariants violated: 0
ok   seat-hold-atomic-update A,B: first={"booked":true} second={"booked":false} seat held: got 1; invariants violated: 0
ok   seat-hold-atomic-update B,A: first={"booked":true} second={"booked":false} seat held: got 1; invariants violated: 0
ok   wallet-optimistic-version A,B: first={"ok":true} second={"ok":false} balance 40: got 40; invariants violated: 0
ok   wallet-optimistic-version B,A: first={"ok":true} second={"ok":false} balance 40: got 40; invariants violated: 0
```

No exploration, metrics or CLI `run` was made on any of the five. (The unadapted files produced the three schema errors above, not a different serial result; that is why adaptation 1 exists.)

## Hash of `corpus/heldout-human/` (adapted state, scenario directories only)

`node eval/hash-heldout.mjs --set heldout-human` (the README, `_template/` and `_example-retried-job/` are not scenarios and are not hashed):

| | |
|---|---|
| Tree sha256 | `d092e96057751c45943bad8603b6f441c9cd343fa68a80da3808623bd30cfd0e` |
| Files hashed | 25 |

The final run verifies both hashes first: `node eval/hash-heldout.mjs --verify 4daa9bdf0c9074a99e7a5e47abf42baed360dbbc95a12305089d60655ce78a66` and `node eval/hash-heldout.mjs --set heldout-human --verify d092e96057751c45943bad8603b6f441c9cd343fa68a80da3808623bd30cfd0e`. If the project owner adds more human scenarios, the new hash is appended here before the run.

The final run still waits for the project owner's confirmation that `corpus/heldout-human/` is complete and that the repository is public.

---

# Freeze record for the final measurement (committed BEFORE the run)

| | |
|---|---|
| Engine commit (the code that will be measured) | `53701d6e0be83b685a42497258782b0ad42ac7e8` (pushed to `origin/main`; commits after it before the run change documentation only) |
| Node | v22.16.0 |
| Postgres | 17.11 (Debian 17.11-1.pgdg13+2), Docker Desktop, `127.0.0.1:5433`, `deadlock_timeout` 300 ms (init-db default) |
| Date and time of the freeze | 2026-10-28 11:38:03 +0530 |
| Machine | Windows 11, 12 logical cores (the official runtime gate is the CI measurement, not this machine) |
| Repository visibility | PUBLIC (`gh repo view Aditya-tec/interleave-pg --json visibility` returned `{"visibility":"PUBLIC"}`) |
| Working tree at the freeze | clean, equal to `origin/main` |

Hashes verified immediately before this record was written:

```
$ node eval/hash-heldout.mjs --verify 4daa9bdf0c9074a99e7a5e47abf42baed360dbbc95a12305089d60655ce78a66
held-out set unchanged (4daa9bdf0c9074a99e7a5e47abf42baed360dbbc95a12305089d60655ce78a66)
$ node eval/hash-heldout.mjs --set heldout-human --verify d092e96057751c45943bad8603b6f441c9cd343fa68a80da3808623bd30cfd0e
held-out set unchanged (d092e96057751c45943bad8603b6f441c9cd343fa68a80da3808623bd30cfd0e)
as-supplied human set in commit 12e48fd: tree sha256 0488bfc6a6b280d63bbf07c58a49f1b5f660c9a826f43f972cd214d1f771379d (matches)
```

## The exact commands that will be run (once)

Environment for all of them: `NODE_ENV=test`, `INTERLEAVE_DSN` = the local throwaway database `interleave_test` on `127.0.0.1:5433` (password not recorded here), `INTERLEAVE_ADMIN_DSN` = the maintenance database on the same server.

```
INTERLEAVE_DSN=<admin dsn> node packages/engine/dist/cli.js init-db --name interleave_test
npm run build
node node_modules/typescript/bin/tsc -p eval
node eval/hash-heldout.mjs --verify 4daa9bdf0c9074a99e7a5e47abf42baed360dbbc95a12305089d60655ce78a66
node eval/hash-heldout.mjs --set heldout-human --verify d092e96057751c45943bad8603b6f441c9cd343fa68a80da3808623bd30cfd0e
node eval/engine-metrics.js --set heldout       --out eval/results/heldout-2026-10-28/heldout.json       --md eval/results/heldout-2026-10-28/heldout.md
node eval/engine-metrics.js --set heldout-human --out eval/results/heldout-2026-10-28/heldout-human.json --md eval/results/heldout-2026-10-28/heldout-human.md
```

stdout and stderr of each metrics command are saved next to its JSON in `eval/results/heldout-2026-10-28/`. Rule: if a command fails for an environmental reason (Docker down, port in use) before producing any scenario result, it may be repeated on the same engine commit; once any scenario has produced a result, every result is reported and nothing is re-run.

---

# Disclosure: CI explored the human set before the official local run (unintended)

A test of mine (`packages/engine/test/metrics.test.ts`, "heldout-human is picked up with no code change") drops a dummy scenario into `corpus/heldout-human/` and runs the metrics script with `--set heldout-human`. Written when that directory held no scenarios, it was never restricted to the dummy. Once the five human scenarios were in the directory, **every CI test run explored all of them (plus the dummy)**, and the test failed its own assertion ("1 scenarios" expected, "6" found). I did not notice until the cross-version CI run failed.

What happened, in UTC on 2026-10-28:

| When | Event |
|---|---|
| 06:07:21 | push of the local commits triggered CI run 40641941250 (engine commit 53701d6); its test step ran on several Postgres/Node jobs |
| 06:08:34 to 06:09:04 | official local run of the agent-written held-out set |
| 06:08:48 to 06:08:51 | in run 40641941250 the dummy-pickup test explored `heldout-human` (5 scenarios + dummy) on pg 15/16 jobs |
| 06:09:13 to 06:09:16 | **official local run of the human set** (the numbers reported in `docs/ENGINE_RESULTS.md`) |
| later | runs 40642049613, 40642163300 and the dispatch run 40642184146 did the same; all failed on that assertion |

So the human set was explored by CI about 25 seconds before the official local run of it. Consequences, stated plainly:

* **Nothing was used.** I did not read those CI outputs until after the official numbers were produced and committed; no engine code, scenario or expectation changed between them (engine commit `53701d6`, held-out hashes verified unchanged before and after).
* **The official numbers are still the single local run** (`eval/results/heldout-2026-10-28/`). The CI runs are additional executions of the same engine on the same files; their summary lines (visible in the failing assertion output) agree with the local run (4 of 4 buggy scenarios flagged including the dummy, 0 of 2 safe flagged, 0 unconfirmed). They are not merged into any number.
* The agent-written set (`corpus/heldout`) was not explored by CI before the local run: that test only touches `heldout-human`.
* **Fix** (test only, no engine change): the test now passes `--only zz-dummy-scenario`, so a test can never explore the real human scenarios.
* The intended cross-version run of both held-out sets (workflow dispatch with `heldout=true`) was re-dispatched after this fix.

---

# Status change (Phase 3b): the sets above are now development data

`corpus/heldout` and `corpus/heldout-human` are public, were run once (results in `eval/results/heldout-2026-10-28/`), and from Phase 3b onward count as **development data**: they may be used to tune and debug the engine, and nothing measured on them again may be quoted as held-out. The numbers already published for them stay valid as the one-shot results they were. **Any future headline claim needs a new held-out set** written, hashed and run under the same protocol. The adversarial set `corpus/hard` (Phase 3b, see `corpus/hard/README.md` and `docs/HARD_SET_RESULTS.md`) is labelled an *adversarial dev set*: it is neither held-out nor independent of an agent.
