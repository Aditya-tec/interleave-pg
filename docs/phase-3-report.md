# Phase 3 report: corpus, engine metrics, hard gates

Environment: Windows 11 (12 logical cores), Node v22.16.0, Postgres 17.11 in Docker Desktop for local numbers; GitHub Actions `ubuntu-latest` (4 vCPU) for the official runtime gate and the version matrix. Repository: https://github.com/Aditya-tec/interleave-pg (public). Every command in the evidence section at the end was run in this session and is pasted unedited; the numbers for the three corpus sets are in [ENGINE_RESULTS.md](ENGINE_RESULTS.md), the measurement protocol in [METRICS.md](METRICS.md) and [HELDOUT.md](HELDOUT.md).

**Result: all hard gates passed; none was loosened.** The headline numbers to quote are the held-out ones: externally authored (independent of the engine author) 3 of 3 buggy found, 0 of 2 safe flagged, n = 5; agent-written (not independent) 9 of 9 and 0 of 6, n = 15. Dev-set numbers (54 scenarios) are the weakest evidence and are always labelled DEV.

## Gate table

| Hard gate | DEV (tuning allowed) | HELD-OUT agent-written (NOT independent) | HELD-OUT externally authored (independent; counts, n = 5) | Result |
|---|---|---|---|---|
| Recall >= 90% on in-scope buggy | 29/29 | 9/9 | 3/3 | PASS |
| Zero false positives on in-scope safe | 0/22 | 0/6 | 0/2 | PASS |
| 100% of reported violations confirmed 3/3 | 59 confirmed, 0 unconfirmed | 17 confirmed, 0 unconfirmed | 7 confirmed, 0 unconfirmed | PASS |
| Median runtime <= 10 s | CI official job (pg17, node22, 3 runs): 251, 265, 300 ms. Local: 0.51 s | local: 0.92 s | local: 0.53 s | PASS |
| p95 runtime <= 60 s | CI official job (3 runs): 6,177, 6,210, 6,219 ms. Local: 6.82 s | local: 11.77 s | local: 0.91 s | PASS |
| Out-of-scope items say "cannot see / unsupported" | 3/3 (see ENGINE_RESULTS.md, honest limits) | n/a | n/a | PASS |

Held-out numbers come from one local run on Postgres 17.11 at engine commit `53701d6` after the freeze record (`a5d0c86`); the cross-version CI run reproduced them exactly on Postgres 15, 16, 17 and 18.

## Task by task

### 1. Serial-oracle false positive (done first)

**The failing example.** `signup-unique-backstop.mjs`: correct code. Each of two concurrent requests checks whether the e-mail exists, then INSERTs it, and the table has a UNIQUE constraint as the backstop. The state after any schedule is right (one row).

**Why the old behaviour flagged it.** The serial-equivalence oracle compared each actor's normalized result as part of the outcome. In both serial orders the second signup sees the first row and returns without inserting, so its result is `ok`. In the schedule where both pre-checks run before either INSERT, the second INSERT fails with `23505`, so its result is `db:23505`. Final database states are identical, but the per-actor results differ, so the outcome matched no serial outcome and was reported as a CONFIRMED ANOMALY. The failing test, run before the fix, ended with `AssertionError: expected [ Array(1) ] to deeply equal []` (one finding on correct code); the other new tests failed because the helper `rejectedActors` and the report field `notes` did not exist.

**The rule, and the reasoning (no blind special-casing).** Only 23505 (unique_violation) and 23P01 (exclusion_violation) are database rejections, next to the existing 40001 and 40P01. A rejected actor is left out of the per-actor comparison, but the remaining actors are compared against their own serial runs **and the database snapshot is always compared**. So the oracle stops using the *error* as evidence and keeps using the *state*. Other class-23 errors (23502, 23503, 23514) stay ordinary results because there the database did not prevent a duplicate; it reports an inconsistency the app has to answer for. An informational note ("actor X rejected by constraint Y; if the app does not handle this, users see an error") is printed. A constraint-rejected actor that left its transaction open did not roll back cleanly and stays in the comparison.

**Tests that pin it:** correct UNIQUE-backstop code is not flagged (`signup-unique-backstop`); a buggy variant that also hits 23505 is still caught, by state (`coupon-unique-partial`: the rejected actor already decremented the stock, `remaining = -1`, CONFIRMED VIOLATION and ANOMALY); an FK violation (23503) is NOT suppressed (`fk-violation`, CONFIRMED ANOMALY); a leaked transaction after a constraint rejection is still a finding (`leaky-constraint`); the rule table itself is unit-tested (`rejectedActors`). The external `webhook-credit-before-dedupe` scenario (the constraint fires after the credit) was found and confirmed in the held-out run.

### 2. Deadlock timing

* **Victim independence, by test** (`deadlock-victim.test.ts`): the same seed explored with victim A (`deadlock_timeout` 300 ms) and with victim B (10 ms: the second waiter's timer fires first) gives the same explored count, the same findings (kind, invariant, status, confirmation, first schedule index, preemptions, occurrences) and the same exit code. The test passed without normalisation, so none was added; a deadlock is simply an outcome of the retriable-abort class.
* **Configurable:** `init-db --deadlock-timeout <10ms..10s>` (validated; nothing else reaches SQL), default 300 ms; `doctor` reports the value.
* **Effect on runtime and stability** (`scripts/deadlock-timeout-effect.mjs`, output in `docs/deadlock-timeout-effect.txt`): exploring the deadlock seed takes 1.9 s at 50 ms, 3.8 s at 100 ms, 4.0 s at 150 ms, 4.9 s at 200 ms, 6.8 s at 300 ms, 10.5 s at 500 ms (34 schedules in every case). Under full CPU load the victim was stable at 150 ms and above and not at 100 ms and below. I kept 300 ms: one sample on one machine is thin margin for shared runners, and the cost is only the deadlock scenarios (about 6.7 s locally; the slowest corpus scenario on the CI runner was 11 s).
* **Runtime target:** on a 4-vCPU runner the dev set has median 251 to 300 ms and p95 6.2 s (limits 10 s and 60 s).

### 3. Corpus

`corpus/dev`: 51 in-scope scenarios (29 buggy, 22 safe) plus 3 honest-limit scenarios. Spec minimums were 40 variants, 24 buggy, 16 safe. Drivers (in-scope): raw `pg` 31, knex 11 (7 buggy, 4 safe), Drizzle on pg 9 (6 buggy, 3 safe); `drizzle-orm@0.45.4` is the only new dependency (dev only, exact pin; `npm view` and the lockfile integrity entry were shown before installing, one new lockfile entry, no install scripts). Bug classes: lost update, check-then-insert, oversell, coupon / gift-card double redeem, idempotency-key race, duplicate webhook, write skew (two shapes), overlapping booking (phantom), transfer deadlock, queue double-claim, and 3-actor scale checks. Fix patterns: atomic conditional UPDATE, `SELECT ... FOR UPDATE`, unique constraint + `ON CONFLICT`, unique constraint with handled violation, `SERIALIZABLE` + retry on 40001, `pg_advisory_xact_lock`, consistent lock ordering, `SKIP LOCKED` claim. Controls that must not trip: uuid + timestamp (pg and knex), the SERIALIZABLE retry wrapper, plain `n = n + 1`. Every scenario has `expected.json` (written before it was ever run) and runs cleanly in the single-user unit harness (`corpus-unit.test.ts`).

Out of scope, said out loud: a Prisma-like stub that bypasses the hook (exit 2, "interleave-pg cannot see database calls that do not go through the app's pg package"), parallel statements inside one actor (exit 2, `UnsupportedError`), and a Redis-style lock stubbed out (the DB race is reported, and every finding carries "This run cannot see locks held outside the database. If such a lock serializes these actors in production, this race may not occur there.").

### 4. Dev / held-out split

15 agent-written held-out scenarios and 5 externally authored ones, hashes recorded and verified (`docs/HELDOUT.md`): `4daa9bdf...78a66` (agent-written), `d092e960...cfd0e` (human, adapted), `0488bfc6...1379d` (human, as supplied). The human scenarios were committed untouched first (`12e48fd`), then adapted mechanically in a separate commit (`c240cc0`; schema `DROP`s and `expected.json` field names; diff in HELDOUT.md). The held-out sets ran once. **Disclosed in HELDOUT.md:** an automated test of mine explored the human set on CI about 25 seconds before the official local run of it; nothing was used or changed, and the CI outputs agree with the local ones.

### 5. Postgres matrix

Supported majors per postgresql.org/support/versioning (checked 2026-10-28): 18 (18.6), 17 (17.11), 16 (16.15), 15 (15.19), 14 (14.24, final release 2026-11-12); 19 is at release candidate 1. CI runs 15, 16, 17, 18 x Node 20, 22 (14 untested, as agreed). Runs: first matrix run https://github.com/Aditya-tec/interleave-pg/actions/runs/40633773987 (8 of 8 jobs green: 290 tests, 0 skipped, determinism 5/5, dev gates); designated-job reruns of https://github.com/Aditya-tec/interleave-pg/actions/runs/40634541084 (attempts 1 to 3, runtime gate); cross-version held-out run https://github.com/Aditya-tec/interleave-pg/actions/runs/40642683696 (8 of 8 green: 310 tests, 0 skipped, determinism 5/5, dev gates and both held-out sets); push run https://github.com/Aditya-tec/interleave-pg/actions/runs/40642666755 (green). **Version-specific differences: none** in outcome or schedule count on any scenario of any set. The earlier dispatch run https://github.com/Aditya-tec/interleave-pg/actions/runs/40642184146 failed on all 8 jobs because of the test bug described in HELDOUT.md (a test assertion, not a billing or quota message); it was fixed in a test-only commit and re-dispatched.

CI now also cancels superseded runs and runs the full matrix only on `main` and manual dispatch (Node 22 + Postgres 17 elsewhere), and fails the job on any skipped, failed or todo test.

### 6. Metrics

`eval/engine-metrics.ts` (compiled with `tsc -p eval`; `npm run metrics -- --set dev|heldout|heldout-human`), `eval/check-gates.mjs`, and `docs/METRICS.md` (definitions committed before the first measurement and never edited). Dev and held-out are reported separately everywhere. Results and per-scenario tables: ENGINE_RESULTS.md. The script picks up any directory with `scenario.mjs` and `expected.json` under `corpus/heldout-human/` with no code change (proved with a dummy scenario, removed afterwards; also asserted by a test).

### 7. Security review of `--allow-dir` / `--json`

Rules (spec section 6 updated): paths must lie inside the working directory or an `--allow-dir` as written, and nothing on the way below that root, final component included, may be a symlink or directory junction; real path re-checked; an allowed directory must exist, be a real directory (not a link), and not be a filesystem or drive root or the home directory; `--json` needs a `.json` name, refuses directories, refuses to overwrite any existing file that does not parse as an interleave-pg report (so `package.json`, scenarios, notes are untouched), and writes through a temp file renamed into place in the same directory. Tests (`safe-paths.test.ts`, `replay.test.ts`): traversal, absolute paths, junction escape, symlinked file, symlink that stays inside the tree, root and home as allow-dir, non-report overwrite attempts, extension rule, atomic write leaves no temp file. On Windows, creating a symbolic link can be refused for lack of privilege; the tests then return early for that case locally (directory junctions need no privilege and are always exercised). On the Linux CI jobs every link case runs, and CI fails on any skipped test.

## Deviations, incidents and things I got wrong (all kept in the open)

* **CI explored the human held-out set before the official local run** (see HELDOUT.md, with timestamps). No effect on any number or any file, but the protocol was not followed to the letter.
* **Two extra CI reruns** were triggered right before the Actions-minutes message arrived (they produced the second and third runtime samples). After that message nothing was pushed or triggered until the repository was confirmed public.
* The first cross-version dispatch failed on all jobs for the test bug above; one test-only fix and a re-dispatch.
* Phase 1 / 2 tests changed on purpose, each recorded in DECISIONS.md: "run without --schedule explores", "parallel statements abort the run". The `deadlock_timeout` expectation in the init-db test was already 300 ms from Phase 2.
* A schema-isolation clash was found while adapting the human scenarios and logged in LIMITATIONS.md for Phase 4; no engine change was made.

## Limitations found (all also in `docs/LIMITATIONS.md`)

* Bounded exploration only (at most 3 preemptions by default); "exhaustive within bound" never means all interleavings.
* The serial oracle is a heuristic: only 23505 and 23P01 are treated as rejections; other integrity errors are outcomes.
* Schema isolation between scenarios sharing one database (Phase 4).
* All scenarios are small; no evidence about large real applications.
* The dev and agent-written held-out sets share an author with the engine and are not independent; the independent set has five scenarios.
* Only raw `pg`, knex and Drizzle-on-pg are covered; Prisma, `pg-native`, multi-process apps, locks outside the database, parallel statements and LISTEN/NOTIFY are out of scope in v1.
* Postgres 14, macOS and Node versions other than 20 and 22 were not tested.
* The metrics script does not record preemption counts, prints percentages at n = 5, and `minPreemptions` in the human `expected.json` was therefore not checked.

---

# Evidence (raw command output)

Windows 11, Node v22.16.0, Postgres 17.11 (Docker Desktop). Commands run from `packages/engine` unless stated. Output pasted unedited except for `cut`/`grep` filters shown in the command.

#### Build and the whole suite
```
$ npx tsc -p tsconfig.build.json && npx vitest run 2>&1 | grep -E '^ +(×|↓)|Tests |Test Files'
 Test Files  18 passed (18)
      Tests  310 passed (310)
[exit code: 0]
```

#### Task 1: the oracle (unit tests and scenario tests)
```
$ npx vitest run test/oracles.test.ts test/explore.test.ts -t 'database rejections|Phase 3' --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/explore.test.ts > Phase 3: constraint rejections are judged by state, not by the error > correct code with a UNIQUE backstop is not flagged, and the rejection is reported as an informational note 223ms
 ✓ test/explore.test.ts > Phase 3: constraint rejections are judged by state, not by the error > a buggy variant that also hits 23505 is still caught (violation and anomaly), by state 510ms
 ✓ test/explore.test.ts > Phase 3: constraint rejections are judged by state, not by the error > a foreign-key violation (23503) is NOT suppressed 215ms
 ✓ test/explore.test.ts > Phase 3: constraint rejections are judged by state, not by the error > a constraint-rejected actor that left its transaction open is still a finding 1048ms
 ✓ test/oracles.test.ts > which errors are database rejections (not part of the outcome) > 40001, 40P01, 23505 and 23P01 are rejections 2ms
 ✓ test/oracles.test.ts > which errors are database rejections (not part of the outcome) > other integrity errors (23502, 23503, 23514) and other codes stay ordinary results 1ms
 ✓ test/oracles.test.ts > which errors are database rejections (not part of the outcome) > a constraint-rejected actor that left its transaction open is not a clean rejection 0ms
 ✓ test/oracles.test.ts > which errors are database rejections (not part of the outcome) > serial comparison excludes a constraint-rejected actor but still compares the snapshot 0ms
      Tests  8 passed | 50 skipped (58)
[exit code: 0]
```

#### Task 1: correct UNIQUE-backstop code is not flagged, and the rejection is reported as a note
```
$ node dist/cli.js run test/fixtures/seeds/signup-unique-backstop.mjs
Scenario: signup (pre-check + UNIQUE backstop)
Target:   127.0.0.1:5433/interleave_test   isolation: default
Strategy: iterative context bounding (0, 1, 2 ... preemptions), DFS
Oracles:  invariants, serial-equivalence
note: actor A rejected by constraint "members_email_key"; if the app does not handle this, users see an error
note: actor B rejected by constraint "members_email_key"; if the app does not handle this, users see an error

No violations found in 6 schedules (preemption bound 3, exhaustive within bound: yes)
Coverage: explored 6 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

#### Task 1: a buggy variant that also hits 23505 is still caught, by state
```
$ node dist/cli.js run test/fixtures/seeds/coupon-unique-partial.mjs | grep -E 'CONFIRMED|note:|Coverage'
CONFIRMED (3/3) VIOLATION: remaining stock never negative
CONFIRMED (3/3) ANOMALY: serial-equivalence - the outcome matches no serial execution of the actors
note: actor A rejected by constraint "redemptions_code_user_id_key"; if the app does not handle this, users see an error
note: actor B rejected by constraint "redemptions_code_user_id_key"; if the app does not handle this, users see an error
Coverage: explored 14 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

#### Task 1: a foreign-key violation (23503) is NOT suppressed
```
$ node dist/cli.js run test/fixtures/seeds/fk-violation.mjs | grep -E 'CONFIRMED|note:|Coverage'
CONFIRMED (3/3) ANOMALY: serial-equivalence - the outcome matches no serial execution of the actors
Coverage: explored 3 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

#### Task 2: no finding depends on which actor is the deadlock victim
```
$ npx vitest run test/deadlock-victim.test.ts test/controller-determinism.test.ts --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/controller-determinism.test.ts > runnable sets are a pure function of the schedule (blocked actors) > (i) while the blocker is paused at its gate the blocked actor stays not-runnable and the blocker is scheduled 117ms
 ✓ test/controller-determinism.test.ts > runnable sets are a pure function of the schedule (blocked actors) > (ii) once the blocker commits, the blocked actor is runnable at the very next decision, every time 2128ms
 ✓ test/controller-determinism.test.ts > runnable sets are a pure function of the schedule (blocked actors) > a deadlock does not stall the controller 369ms
 ✓ test/controller-determinism.test.ts > deadlock victim is stable > the first blocked actor is always the one Postgres aborts (40P01), run after run 12779ms
 ✓ test/controller-determinism.test.ts > controller unit test with a fake database (slow wake-up of a blocked statement) > waits for a blocked statement whose blocker has released, so the runnable set does not depend on wake-up speed 192ms
 ✓ test/deadlock-victim.test.ts > no finding depends on WHICH actor Postgres picks as the deadlock victim > victim A (300 ms) and victim B (10 ms, the second waiter times out first) give the same findings, counts and exit code 9078ms
 ✓ test/deadlock-victim.test.ts > no finding depends on WHICH actor Postgres picks as the deadlock victim > the safe (lock-ordered) variant is clean whichever way the timer falls 2698ms
      Tests  7 passed (7)
[exit code: 0]
```

#### Task 2: deadlock_timeout is configurable (init-db option, doctor)
```
$ npx vitest run test/initdb.test.ts --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '; node dist/cli.js doctor
 ✓ test/initdb.test.ts > init-db > creates the database, marker table and low deadlock_timeout; is idempotent 126ms
 ✓ test/initdb.test.ts > init-db > refuses names without the interleave_ prefix and remote hosts 1ms
 ✓ test/initdb.test.ts > init-db > rejects hostile names 1ms
 ✓ test/initdb.test.ts > configurable deadlock_timeout > init-db applies a custom value and the default is 300ms 133ms
 ✓ test/initdb.test.ts > configurable deadlock_timeout > rejects values that are not a bounded duration (no SQL is built from them) 1ms
      Tests  5 passed (5)
[ok] Node 22.16.0 (need >= 20)
[ok] pg resolves from C:\Users\kalam\Desktop\aditya-claude-skill\raceproof\packages\engine
[ok] target 127.0.0.1:5433/interleave_test is local and has the interleave-pg marker table
[ok] Postgres 17.11 (Debian 17.11-1.pgdg13+2) (tested range 14-18)
[ok] deadlock_timeout is 300ms (init-db default 300ms; below about 100ms the deadlock victim can vary under CPU load)
[exit code: 0]
```

#### Task 2: what deadlock_timeout costs and buys (scripts/deadlock-timeout-effect.mjs, run earlier in this session)
```
$ cat ../../docs/deadlock-timeout-effect.txt
deadlock_timeout | explore time (idle) | explored | victims over 40 forced deadlocks, idle | victims over 40, all cores busy
50ms             |   1853 ms          |  34      | {"A":40}           | {"B":40}
100ms            |   3782 ms          |  34      | {"A":40}           | {"A":39,"B":1}
150ms            |   4004 ms          |  34      | {"A":40}           | {"A":40}
200ms            |   4896 ms          |  34      | {"A":40}           | {"A":40}
300ms            |   6844 ms          |  34      | {"A":40}           | {"A":40}
500ms            |  10494 ms          |  34      | {"A":40}           | {"A":40}
[exit code: 0]
```

#### Task 3: corpus composition (dev set)
```
$ node -e "const j=require('../../eval/results/dev-final-local.json'); const c={}; for(const r of j.rows){ const k=(r.scope==='out'?'out-of-scope':r.expect)+' / '+r.driver; c[k]=(c[k]||0)+1 } console.log(JSON.stringify(c,null,1)); const cl={}; for(const r of j.rows.filter(r=>r.scope==='in')){ cl[r.class]=(cl[r.class]||0)+1 } console.log(JSON.stringify(cl,null,1)); console.log('scenarios:',j.rows.length)"
{
 "safe / knex": 4,
 "safe / pg": 15,
 "buggy / knex": 7,
 "buggy / pg": 16,
 "buggy / drizzle": 6,
 "safe / drizzle": 3,
 "out-of-scope / pg": 2,
 "out-of-scope / stub": 1
}
{
 "benign-control": 2,
 "phantom-booking": 4,
 "retry-wrapper-control": 1,
 "coupon": 4,
 "check-then-insert": 8,
 "deadlock": 3,
 "idempotency-key": 3,
 "lost-update": 9,
 "oversell": 7,
 "queue-claim": 2,
 "webhook-duplicate": 3,
 "write-skew": 5
}
scenarios: 54
[exit code: 0]
```

#### Task 3: single-user (serial) unit harness over every in-scope corpus scenario
```
$ npx vitest run test/corpus-unit.test.ts 2>&1 | grep -E '^ +(×|↓)|Tests |Test Files'
 Test Files  1 passed (1)
      Tests  72 passed (72)
[exit code: 0]
```

#### Task 3: out-of-scope items say what they cannot see
```
$ npx vitest run test/out-of-scope.test.ts --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '; node dist/cli.js run ../../corpus/dev/limits-prisma-stub/scenario.mjs; node dist/cli.js run ../../corpus/dev/limits-parallel-statements/scenario.mjs
 ✓ test/out-of-scope.test.ts > things the tool cannot see are said out loud > a driver that bypasses the hook: explicit "cannot see" error, never a clean report 67ms
 ✓ test/out-of-scope.test.ts > things the tool cannot see are said out loud > the same through the CLI: exit 2 and the message on stderr 521ms
 ✓ test/out-of-scope.test.ts > things the tool cannot see are said out loud > parallel statements inside one actor abort the run with UnsupportedError 690ms
 ✓ test/out-of-scope.test.ts > things the tool cannot see are said out loud > every finding carries the notice about locks held outside the database, in the text and in report.json 246ms
      Tests  4 passed (4)
NoStatementsError: no statements intercepted: pg resolution mismatch? interleave-pg cannot see database calls that do not go through the app's pg package (for example Prisma's query engine, or a second copy of pg), so it cannot say anything about this code
UnsupportedError: parallel statements within one actor ("A"): interleave-pg cannot explore code that has two statements in flight at once, so it cannot say anything about this scenario
[exit code: 2]
```

#### Task 7: --allow-dir / --json hardening (symlinks and junctions, traversal, overwrite rules, roots, home, atomic write)
```
$ npx vitest run test/safe-paths.test.ts test/replay.test.ts --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > accepts a well-formed report and returns only the fields it needs 2ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: wrong tool 1ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: no violations array 0ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: schedule entry with shell characters 0ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: schedule entry that is not a string 0ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: schedule far too long 1ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: bad fingerprint 0ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: bad kind 0ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: bad isolation 0ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: scenarioFile is not a string 0ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects: too many violations 0ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > rejects non-JSON and oversize input 1ms
 ✓ test/replay.test.ts > S10: saved reports are untrusted input (schema validation, in process) > does not pollute prototypes through __proto__ keys and never evaluates anything 0ms
 ✓ test/replay.test.ts > S10: path checks > resolves paths inside the working directory and refuses everything else 2ms
 ✓ test/replay.test.ts > replay command > re-runs the saved schedule 3 times: reproduced 3/3, exit 1 1420ms
 ✓ test/replay.test.ts > replay command > --violation selects a finding; an unknown id is a usage error (exit 2) 1056ms
 ✓ test/replay.test.ts > replay command > after a fix the same schedule is not reproduced (exit 0), and the wording does not claim a proof 640ms
 ✓ test/replay.test.ts > replay command > refuses a report outside the working directory unless --allow-dir names it 926ms
 ✓ test/replay.test.ts > replay command > refuses a scenario path that escapes the directory (exit 2) 966ms
 ✓ test/replay.test.ts > replay command > rejects malformed and oversize files (exit 2) without running anything 911ms
 ✓ test/replay.test.ts > replay command > replay goes through the guard too (exit 3) 505ms
 ✓ test/safe-paths.test.ts > --allow-dir values > refuses a filesystem or drive root and the home directory 2ms
 ✓ test/safe-paths.test.ts > --allow-dir values > refuses a directory that does not exist or is a file 1ms
 ✓ test/safe-paths.test.ts > --allow-dir values > accepts an ordinary directory and returns its real path 1ms
 ✓ test/safe-paths.test.ts > --allow-dir values > refuses a symlinked directory as an allowed directory 1ms
 ✓ test/safe-paths.test.ts > writing a report (--json) > writes atomically (temp file + rename in the same directory) and leaves no temp file behind 4ms
 ✓ test/safe-paths.test.ts > writing a report (--json) > overwrites an existing interleave-pg report 3ms
 ✓ test/safe-paths.test.ts > writing a report (--json) > refuses to overwrite a file that is not an interleave-pg report (source files, package.json, notes) 10ms
 ✓ test/safe-paths.test.ts > writing a report (--json) > requires a .json extension (cannot be aimed at .mjs, .ts, .sql ...) 1ms
 ✓ test/safe-paths.test.ts > writing a report (--json) > refuses a directory as the target 2ms
 ✓ test/safe-paths.test.ts > writing a report (--json) > refuses traversal and absolute paths outside the allowed directories 1ms
 ✓ test/safe-paths.test.ts > writing a report (--json) > an explicitly allowed directory works; its siblings do not 3ms
 ✓ test/safe-paths.test.ts > writing a report (--json) > refuses a symlinked (junction) directory that points outside, and a symlinked file 4ms
 ✓ test/safe-paths.test.ts > writing a report (--json) > a symlink inside the allowed tree that stays inside it is still refused (no symlinks at all) 1ms
 ✓ test/safe-paths.test.ts > reading with resolveInside > still rejects traversal for reads 0ms
 ✓ test/safe-paths.test.ts > through the CLI > --allow-dir refuses a root and the home directory (exit 2) 900ms
 ✓ test/safe-paths.test.ts > through the CLI > --json will not overwrite package.json (exit 2) and leaves it untouched 428ms
 ✓ test/safe-paths.test.ts > through the CLI > --json refuses a scenario file as the target 393ms
      Tests  38 passed (38)
[exit code: 0]
```

#### Metrics definitions and the heldout-human pickup test
```
$ npx vitest run test/metrics.test.ts --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/metrics.test.ts > metrics definitions (docs/METRICS.md) > percentiles use the nearest-rank method 2ms
 ✓ test/metrics.test.ts > metrics definitions (docs/METRICS.md) > a mismatch is not a hit, and it counts against recall 1ms
 ✓ test/metrics.test.ts > metrics definitions (docs/METRICS.md) > out-of-scope scenarios are excluded from every rate and from the runtime percentiles 0ms
 ✓ test/metrics.test.ts > metrics definitions (docs/METRICS.md) > only a confirmed finding on a safe scenario is a false positive; an unconfirmed one fails the confirmation gate instead 0ms
 ✓ test/metrics.test.ts > metrics definitions (docs/METRICS.md) > gates are judged on the numbers, never loosened 0ms
 ✓ test/metrics.test.ts > heldout-human is picked up with no code change > a dummy scenario dropped into the directory is discovered, run and reported 842ms
      Tests  6 passed (6)
[exit code: 0]
```
