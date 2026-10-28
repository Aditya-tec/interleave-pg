# Hard set (Phase 3b): an adversarial dev set

**Label: adversarial dev set.** It is neither held-out nor independent of an agent. It was written to find what the engine gets wrong, from the documentation only. The earlier held-out sets (`corpus/heldout`, `corpus/heldout-human`) are public and count as development data from now on (HELDOUT.md); any future headline claim needs a new held-out set.

## Authoring, honestly

* **Who wrote it.** A fresh subagent in its own context, given a prompt that allowed it to read only `corpus/heldout-human/README.md` (with `_template/` and `_example-retried-job/`), `corpus/hard/README.md`, anything under `docs/`, the three tiny helper modules in `corpus/_lib/`, and the public API docs of pg, knex and drizzle-orm. It was forbidden from reading `packages/engine/{src,test,dist,scripts}`, `eval/`, `corpus/dev`, `corpus/heldout`, and any other human scenario, and from running any exploration, `run`, replay or metrics. The only engine-related command it was allowed to run was the serial single-user check (`corpus-unit.test.ts -t "hard/"`).
* **What I could not enforce.** The subagent had the same file tools as I do, so the prohibition rests on its own report, not on a sandbox. Its report lists every file it read and states it touched none of the prohibited paths. Two things it disclosed that are worth knowing: a `corpus/_lib/*.mjs` glob also printed the first ~2 KB of `corpus/_lib/families.mjs` (the dev corpus's code; it says it did not use it), and `docs/DECISIONS.md`, `docs/LIMITATIONS.md` and `docs/phase-1/2-report.md` excerpts told it some of the tool's documented wording and behaviour (allowed: they are documentation).
* **Not independent at the orchestration level.** I (the agent that wrote the engine) wrote `corpus/hard/README.md` and the harness changes below. I did not read or alter the scenarios' logic, but I read their `expected.json` files before the run to check they were complete.
* **Harness changes made after the scenarios were written and before the first run** (all in `eval/engine-metrics.ts`, tested in `metrics.test.ts`): `judgeLimit` judges the honest-limit fields `message`, `notice`, `warning`, `stoppedBy`; the report shows the author's derived minimal preemption count next to the observed one; and, after reading the authored `limit-state-explosion/expected.json` (which uses `message` for the wording "exhaustive within bound: no", which is printed report text, not an error), `message` may also match the printed report text when the run ends without an error. The scenario files and every `expected.json` are unchanged by me.
* **Serial sanity check** (the only run on these files before the freeze): 28 of 28 in-scope scenarios passed (A then B and B then A, every invariant holding); the 4 honest-limit scenarios are skipped by that check.

## The set

32 scenarios: 14 buggy and 14 safe in scope, plus 4 honest limits (`scope: out`). Each directory has `scenario.mjs` (starting with a comment that derives the minimal preemption count or the safety argument), `schema.sql` and `expected.json`. Tree hash of `corpus/hard/` (scenario directories plus the three helper modules; 99 files), `node eval/hash-heldout.mjs --set hard`:

`e22311635d40c8716df7c1a27cc0f985e295e88be6cc0157fcba0040b8a6d21b`

Committed and pushed before the first engine run (commit id recorded below, after the freeze).

Freeze commit (set, hash and harness, before any engine run on the set): `16d214df386d11578fc327ee38f186cabc4f206e`, pushed to origin/main.

## FIRST RUN (unmodified engine; this is the table to quote)

One run, Postgres 17.11, Node v22.16.0, engine commit `6d9b3f3a88b0aab29f6526462de3bafd98980006`, started 2026-10-28 12:21 (+0530), after the freeze commit. Raw outputs: `eval/results/hard-2026-10-28/` (`hard.json`, `hard.md`, `hard.stdout.txt`, `hard.stderr.txt`).

In scope: 14/14 buggy scenarios hit (0 mismatches, 0 misses); 0/14 safe scenarios flagged; 27 confirmed findings, 0 unconfirmed; schedules explored median 36 (p95 552); runtime median 1.05 s, p95 20.43 s (local, 12 cores). Honest limits: 4 of 4 behaved as their `expected.json` required.

| Scenario | Driver | Expected | Actual | Result | Confirmations | Schedules | Preemptions derived / observed | Runtime |
|---|---|---|---|---|---|---|---|---|
| advisory-early-unlock | pg | buggy, must fail "both deposits counted" | VIOLATION:both deposits counted; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 26 | 1 / 1 | 1.08 s |
| advisory-key-mismatch | pg | buggy, must fail "deposit and withdrawal both applied" | VIOLATION:deposit and withdrawal both applied; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 82 | 1 / 1 | 2.61 s |
| advisory-xact-lock-safe | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 36 | - / - | 1.41 s |
| cas-retry-loop-safe | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 6 | - / - | 0.15 s |
| check-constraint-withdraw-safe | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 6 | - / - | 0.17 s |
| claim-backoff-both-yield | pg | buggy, must fail "somebody holds the lease" | VIOLATION:somebody holds the lease; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 12 | 2 / 2 | 0.29 s |
| claim-precheck-deep-yield | pg | buggy, must fail "somebody holds the lease" | VIOLATION:somebody holds the lease; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 16 | 3 / 3 | 0.32 s |
| deadlock-opposite-order | pg | buggy, must fail "both transfers recorded" | VIOLATION:both transfers recorded | match (hit) | 1 confirmed (each 3/3), 0 unconfirmed | 52 | 1 / 1 | 9.20 s |
| deferred-unique-commit-safe | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 44 | - / - | 1.05 s |
| drizzle-atomic-update-safe | drizzle | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 24 | - / - | 1.24 s |
| drizzle-txn-oversell | drizzle | buggy, must fail "bookings never exceed capacity" | VIOLATION:bookings never exceed capacity; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 90 | 1 / 1 | 1.40 s |
| knex-txn-forupdate-safe | knex | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 24 | - / - | 1.01 s |
| knex-txn-lost-update | knex | buggy, must fail "both deposits counted" | VIOLATION:both deposits counted; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 38 | 1 / 1 | 1.29 s |
| ordered-locking-transfers-safe | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 50 | - / - | 2.04 s |
| queue-claim-select-update | pg | buggy, must fail "a job is claimed at most once" | VIOLATION:a job is claimed at most once; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 18 | 1 / 1 | 0.35 s |
| queue-claim-skip-locked | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 90 | - / - | 1.25 s |
| quota-three-actors | pg | buggy, must fail "grants never exceed the cap" | VIOLATION:grants never exceed the cap; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 552 | 1 / 1 | 7.12 s |
| retry-stale-balance | pg | buggy, must fail "both deposits counted" | VIOLATION:both deposits counted; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 6 | 1 / 1 | 0.19 s |
| savepoint-dup-guard-safe | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 62 | - / - | 1.94 s |
| savepoint-stock-rmw | pg | buggy, must fail "stock plus sold equals initial" | VIOLATION:stock plus sold equals initial; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 516 | 1 / 1 | 22.83 s |
| ser-no-retry | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 44 | - / - | 0.51 s |
| ser-with-retry | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 44 | - / - | 0.58 s |
| unique-check-then-insert-safe | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 6 | - / - | 0.17 s |
| upsert-branch-dup-rows | pg | buggy, must fail "one counter row per page" | VIOLATION:one counter row per page; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 6 | 1 / 1 | 0.17 s |
| upsert-branch-safe | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 6 | - / - | 0.14 s |
| webhook-dedupe-first-safe | pg | safe, no finding | no finding | match (clean) | 0 confirmed (each 3/3), 0 unconfirmed | 24 | - / - | 0.85 s |
| webhook-effect-before-dedupe | pg | buggy, must fail "the payment is credited once" | VIOLATION:the payment is credited once; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 82 | 1 / 1 | 2.23 s |
| writeskew-three-oncall | pg | buggy, must fail "someone stays on call" | VIOLATION:someone stays on call; ANOMALY:serial-equivalence | match (hit) | 2 confirmed (each 3/3), 0 unconfirmed | 1752 | 1 / 1 | 20.43 s |
| limit-nondeterministic-race | pg | limit:  warning /nondeterministic scenario/ | ANOMALY:serial-equivalence; VIOLATION:both deposits counted | honest limit behaved correctly | 2 confirmed (each 3/3), 0 unconfirmed | 18 | - / 1 | 0.38 s |
| limit-promise-all | pg | limit: message /parallel statements (within|inside) one actor/ | UnsupportedError: parallel statements within one actor ("A"): interleave-pg cannot explore | honest limit behaved correctly | 0 confirmed (each 3/3), 0 unconfirmed | - | - / - | 0.08 s |
| limit-state-explosion | pg | limit: message /exhaustive within bound: no/ stop by schedule-budget or time-budget | no finding, stopped by schedule-budget | honest limit behaved correctly | 0 confirmed (each 3/3), 0 unconfirmed | 2000 | - / - | 39.05 s |
| limit-timer-wait | pg | limit: message /stalled/ | StallError: actor "A" stalled outside the database; stub external calls in the scenario | honest limit behaved correctly | 0 confirmed (each 3/3), 0 unconfirmed | - | - / - | 5.14 s |

Derived minimal preemption counts (written by the author before any run, by reasoning, including the 2- and the 3-preemption scenarios) equalled the observed first-finding preemption count in **14 of 14** buggy scenarios.

## AFTER FIXES

**No engine change was made.** The first run had no miss, no mismatch, no false positive and no unconfirmed finding, and I found no engine bug while analysing it, so this table is identical to the first-run table above. (I did not touch the engine, the harness or any expectation after the run.)

## Analysis, scenario by scenario

There was no miss, mismatch or false positive to analyse. Instead, every doubt the author wrote down in advance, and what happened:

| Author's doubt (written before the run) | What the run showed |
|---|---|
| `claim-precheck-deep-yield` needs exactly 3 preemptions, the default bound: an off-by-one in the bound would miss it | Found, CONFIRMED 3/3, first seen at schedule #12 with 3 preemptions (probe: with `--max-preemptions 2` it is not found, and the report says the search was exhaustive only within bound 2) |
| `claim-backoff-both-yield` / `...deep-yield`: the outcome is also non-serial, so an extra `serial-equivalence` ANOMALY may appear next to the named invariant | The named invariant was found in both; the extra ANOMALY does not affect a hit |
| `deadlock-opposite-order`: unsure the tool reports a finding at all, since 40P01 is a retriable outcome | Reported: the invariant "both transfers recorded" is violated in the final state and is CONFIRMED 3/3 (1 preemption, as derived). 9.2 s because each deadlocking schedule waits for `deadlock_timeout` (300 ms) |
| `deferred-unique-commit-safe`: the 23505 comes from COMMIT, then the helper sends ROLLBACK; the tool might treat it as a transaction left open and keep the actor in the comparison (a false positive) | Clean, no finding. The informational note "actor X rejected by constraint ..." was printed |
| `unique-check-then-insert-safe`, `check-constraint-withdraw-safe` | Clean (the first also prints the informational note; 23514 for the CHECK is an ordinary result that the app handles) |
| `ser-no-retry`: a stricter tool might call a user-visible 40001 a finding | Clean, as the author expected. See design limit 3 below |
| `limit-state-explosion`: `stoppedBy` listed as an array | Judged as "either value accepted". It stopped by the schedule budget after 2000 schedules in 39 s, printed "exhaustive within bound: no" and "it is not exhaustive", exit 0 |
| `limit-nondeterministic-race`: the finding may stay unconfirmed | It was CONFIRMED 3/3 (the invariant still fails in every replay) and carried the "nondeterministic scenario: the statement sequence (SQL + parameters) differed between the original run and a replay" warning |

## Engine bugs found and fixed

None.

## Design limits found (documented in LIMITATIONS.md, not fixed)

1. **The preemption bound is a hard edge.** The 3-preemption scenario is found at the default bound 3 and not at bound 2; a bug needing 4 would not be found by default. Every report states the bound and "exhaustive within bound".
2. **Random values stored in tables make the serial oracle flag even serial schedules.** In `limit-nondeterministic-race` an ANOMALY is "first seen at schedule #1 with 0 preemptions": the rows contain random ids and timestamps, so no serial reference outcome ever equals another run's snapshot. The tool does print the nondeterminism warning on that finding, but a finding at 0 preemptions is a sign of nondeterministic data, not of a race, and the report does not say so. (Suggested for Phase 4: flag a 0-preemption ANOMALY as "oracle unreliable for this scenario".)
3. **A SERIALIZABLE transaction without retry is reported clean.** 40001 is a retriable abort by design (spec 4.6 and 8.12), the final state is serial and the invariant holds, so nothing is flagged, even though a user sees an error. Unlike a 23505 rejection, a 40001/40P01 abort prints no informational note. (Suggested for Phase 4: the same "if the app does not handle this, users see an error" note for aborts.) The isolation matrix also cannot help here because the scenario sets its own `BEGIN ISOLATION LEVEL`.
4. **Cost grows fast with actors.** The 3-actor write skew takes 1,752 schedules (20 s) and the 3-actor savepoint scenario 516 (23 s); four actors with six statements each stop at the 2000-schedule budget after 39 s and are reported as non-exhaustive.

## Honest limits (updated)

| Item | Where | Behaviour | Required | Result |
|---|---|---|---|---|
| Driver that bypasses `pg` (Prisma-like stub) | dev | exit 2, "interleave-pg cannot see database calls that do not go through the app's pg package ..." | message | behaved correctly |
| Parallel statements in one actor | dev and hard (`limit-promise-all`) | exit 2, "UnsupportedError: parallel statements within one actor (\"A\") ..." | message | behaved correctly (both) |
| Lock held outside the database (Redis-style stub) | dev | findings reported, each carrying "This run cannot see locks held outside the database ..." | notice | behaved correctly |
| Non-database wait that stalls | hard (`limit-timer-wait`) | exit 2, "StallError: actor \"A\" stalled outside the database; stub external calls in the scenario" after 5.1 s | message | behaved correctly |
| Random ids and `Date.now()` in statements | hard (`limit-nondeterministic-race`) | the real race is reported (CONFIRMED) with the "nondeterministic scenario" warning on each finding; also see design limit 2 | warning | behaved correctly |
| State explosion (4 actors x 6 statements) | hard (`limit-state-explosion`) | budget stop after 2000 schedules (39 s), "exhaustive within bound: no", "not exhaustive", exit 0 | stoppedBy | behaved correctly |
| Bug deeper than the preemption bound | probe on `claim-precheck-deep-yield` with bound 2 | not found, reported as exhaustive within bound 2 only | n/a (design limit 1) | by design |
| SERIALIZABLE aborts the user would see | hard (`ser-no-retry`) | clean, no note | n/a (design limit 3) | by design |

## CI

Push run for the freeze commit `16d214d` (the set, the hash and the harness; runs the 28 in-scope scenarios of this set in the serial unit harness on 8 jobs): see the link in the final section. The hard set itself is not executed by CI (it is an adversarial dev set whose purpose is to be run by hand and analysed); the dev-set gates in CI are unchanged.

## Final section: CI links

* Freeze commit `16d214d` (hard set, hash and harness; the 28 in-scope scenarios run in the serial unit harness, 8 jobs, Postgres 15 to 18 x Node 20 and 22): https://github.com/Aditya-tec/interleave-pg/actions/runs/40646363442 (success).
* The commit that adds the results and these documents is pushed after this text; its run is the next link in `git log` / the Actions tab (documentation only, no code change).
* Post-hoc probes on the hard set (analysis only, engine unchanged): `eval/results/hard-2026-10-28/probes.txt`.
