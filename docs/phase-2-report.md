# Phase 2 report: exploration, oracles, replay, isolation

Environment: Windows 11, Node v22.16.0, Postgres 17.11 (Docker Desktop, 127.0.0.1:5433), pg 8.23.1. Every command below was run in this session; output is pasted unedited (the seed paths are relative to `packages/engine`). `INTERLEAVE_DSN` points at the local throwaway database `interleave_test`; the password is not shown.

## Build and full suite

#### Build
```
$ npx tsc -p tsconfig.build.json && echo build ok
build ok
[exit code: 0]
```

#### Full suite (every Phase 1 and Phase 2 test)
```
$ npx vitest run 2>&1 | grep -E '^ +(×|↓)|Tests |Test Files'
 Test Files  13 passed (13)
      Tests  199 passed (199)
[exit code: 0]
```

## AC2.1 Every seed bug class is found within its documented schedule count

The minimal preemption counts were derived by reasoning and committed in `test/seeds.expected.ts` (commit a2d9ac7) before any seed was run. The table pins the position of the first violating schedule and the total schedules explored (exact equality, asserted by `test/explore.test.ts`).

| Seed | Bug class | Derived min preemptions | Observed (first confirmed finding) | First violating schedule # | Schedules explored | Wall time (CLI, incl. node start) |
|---|---|---|---|---|---|---|
| lost-update.mjs | lost update | 1 | 1 (VIOLATION, 3/3) | 3 | 6 | 777 ms |
| check-then-insert.mjs | check-then-insert | 1 | 1 (VIOLATION, 3/3) | 3 | 6 | 817 ms |
| oversell.mjs | oversell | 1 | 1 (VIOLATION, 3/3) | 4 | 14 | 984 ms |
| coupon.mjs | coupon double redeem | 1 | 1 (VIOLATION, 3/3) | 4 | 14 | 915 ms |
| write-skew.mjs | write skew | 1 | 1 (VIOLATION, 3/3) | 3 | 44 | 1270 ms |
| deadlock.mjs | deadlock | 1 | 1 (VIOLATION, 3/3) | 4 | 34 | 7189 ms |
| two-preemptions.mjs | needs exactly 2 (synthetic) | 2 | 2 (VIOLATION, 3/3) | 5 | 6 | 732 ms |

Safe controls (must find nothing, exhaustively within the bound, exit 0):

| Seed | Findings | Schedules explored | Exhaustive within bound | Exit | Wall time |
|---|---|---|---|---|---|
| lost-update-safe.mjs | 0 | 2 | yes | 0 | 672 ms |
| check-then-insert-safe.mjs | 0 | 2 | yes | 0 | 670 ms |
| oversell-safe.mjs | 0 | 4 | yes | 0 | 702 ms |
| coupon-safe.mjs | 0 | 4 | yes | 0 | 703 ms |
| write-skew-safe.mjs | 0 | 24 | yes | 0 | 2058 ms |
| deadlock-safe.mjs | 0 | 24 | yes | 0 | 1503 ms |
| benign-nondeterminism.mjs | 0 | 6 | yes | 0 | 751 ms |

#### The asserting tests (exact pinned counts, minimal preemptions, 3/3 confirmation)
```
$ npx vitest run test/explore.test.ts -t 'AC2.1' --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > lost-update.mjs 351ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > check-then-insert.mjs 322ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > oversell.mjs 519ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > coupon.mjs 398ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > write-skew.mjs 701ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > deadlock.mjs 6703ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > two-preemptions.mjs 235ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > pinned explored-schedule counts for every seed 12037ms
      Tests  8 passed | 32 skipped (40)
[exit code: 0]
```

#### One full CLI output (lost update)
```
$ node dist/cli.js run test/fixtures/seeds/lost-update.mjs
Scenario: lost update (read-modify-write)
Target:   127.0.0.1:5433/interleave_test   isolation: default
Strategy: iterative context bounding (0, 1, 2 ... preemptions), DFS
Oracles:  invariants, serial-equivalence

CONFIRMED (3/3) VIOLATION: both deposits applied
  first seen at schedule #3 with 1 preemption; seen in 4 schedules in total
  schedule: B,A,A,B
   #  Actor Txn  SQL                                              Params          Result
   1  B     -    SELECT balance FROM accounts WHERE id = 1                        1 row {"balance":100}
   2  A     -    SELECT balance FROM accounts WHERE id = 1                        1 row {"balance":100}
   3  A     -    UPDATE accounts SET balance = $1 WHERE id = 1    [110]           UPDATE 1
   4  B     -    UPDATE accounts SET balance = $1 WHERE id = 1    [110]           UPDATE 1
  hint (heuristic): read-modify-write: B read "accounts" (step 1), A wrote it (step 3), then B wrote it from the stale read (step 4). Typical fix: do the update in one statement (UPDATE t SET n = n + $1), or SELECT ... FOR UPDATE inside a transaction

CONFIRMED (3/3) ANOMALY: serial-equivalence - the outcome matches no serial execution of the actors
  first seen at schedule #3 with 1 preemption; seen in 4 schedules in total
  schedule: B,A,A,B
   #  Actor Txn  SQL                                              Params          Result
   1  B     -    SELECT balance FROM accounts WHERE id = 1                        1 row {"balance":100}
   2  A     -    SELECT balance FROM accounts WHERE id = 1                        1 row {"balance":100}
   3  A     -    UPDATE accounts SET balance = $1 WHERE id = 1    [110]           UPDATE 1
   4  B     -    UPDATE accounts SET balance = $1 WHERE id = 1    [110]           UPDATE 1
  hint (heuristic): read-modify-write: B read "accounts" (step 1), A wrote it (step 3), then B wrote it from the stale read (step 4). Typical fix: do the update in one statement (UPDATE t SET n = n + $1), or SELECT ... FOR UPDATE inside a transaction

2 confirmed findings in 6 schedules explored.
Coverage: explored 6 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 1]
```

## AC2.2 The first reported schedule has the minimal number of preemptions

#### Bug that needs exactly 2 preemptions: found at 2, as the 5th schedule (after 2 with 0 and 2 with 1)
```
$ node dist/cli.js run test/fixtures/seeds/two-preemptions.mjs | sed -n '1,/^Coverage/p' | grep -E 'CONFIRMED|first seen|schedule:|Coverage'
CONFIRMED (3/3) VIOLATION: log is never strictly alternating
  first seen at schedule #5 with 2 preemptions; seen in 2 schedules in total
  schedule: A,B,A,B
Coverage: explored 6 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

#### With --max-preemptions 1 it is not found, and the output says exactly what was covered
```
$ node dist/cli.js run test/fixtures/seeds/two-preemptions.mjs --max-preemptions 1
Scenario: needs exactly two preemptions
Target:   127.0.0.1:5433/interleave_test   isolation: default
Strategy: iterative context bounding (0, 1, 2 ... preemptions), DFS
Oracles:  invariants, serial-equivalence

No violations found in 4 schedules (preemption bound 1, exhaustive within bound: yes)
Coverage: explored 4 schedules, preemption bound 1, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

#### Model test (no database): preemption counts are non-decreasing, ABAB needs 2
```
$ npx vitest run test/strategy.test.ts --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/strategy.test.ts > decide / preemption accounting > counts a switch away from a runnable actor, not a switch after it finished 3ms
 ✓ test/strategy.test.ts > decide / preemption accounting > default policy continues the current actor, else the lowest id 0ms
 ✓ test/strategy.test.ts > decide / preemption accounting > flags a prefix entry that is not runnable and falls back to the default policy 0ms
 ✓ test/strategy.test.ts > decide / preemption accounting > forcedChooser keeps Phase 1 semantics: skips finished actors, keeps entries for blocked ones 1ms
 ✓ test/strategy.test.ts > decide / preemption accounting > serialChooser runs actors in the given order 0ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > enumerates every schedule exactly once and reports exhaustive within the bound 1ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > explores in non-decreasing preemption order (0, then 1, then 2 ...) 1ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > AC2.2 model: the first schedule that violates a bug needing exactly 2 preemptions has exactly 2 0ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > a bound of 1 explores only schedules with at most 1 preemption and says so 1ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > is deterministic: identical order and counts on repeated runs 6ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > stops at maxSchedules with stoppedBy schedule-budget and exhaustive false 0ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > finishing exactly on the budget is "complete", not a budget stop 0ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > time budget uses the injected clock: stops before the run that starts past the budget 0ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > a time budget of 0 stops before the first schedule 0ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > rejects more than 4 actors 1ms
 ✓ test/strategy.test.ts > exploreRandom (seeded fallback) > same seed gives the same schedules, a different seed gives different ones 1ms
 ✓ test/strategy.test.ts > exploreRandom (seeded fallback) > runs exactly M schedules, reports distinct ones, and is never exhaustive 0ms
 ✓ test/strategy.test.ts > exploreRandom (seeded fallback) > honours the time budget through the clock 0ms
 ✓ test/strategy.test.ts > exploreRandom (seeded fallback) > mulberry32 is a pure function of the seed 0ms
      Tests  19 passed (19)
[exit code: 0]
```

## AC2.3 Confirmation: 3 replays, flaky findings never count

#### Deliberately flaky scenario: UNCONFIRMED, exit 4
```
$ node dist/cli.js run test/fixtures/seeds/flaky.mjs
Scenario: deliberately flaky
Target:   127.0.0.1:5433/interleave_test   isolation: default
Strategy: iterative context bounding (0, 1, 2 ... preemptions), DFS
Oracles:  invariants, serial-equivalence

UNCONFIRMED (flaky) [2/3 replays reproduced it; not counted as a finding] VIOLATION: flaky invariant - fails on odd evaluations
  first seen at schedule #1 with 0 preemptions; seen in 1 schedule in total
  schedule: A,B
   #  Actor Txn  SQL                                              Params          Result
   1  A     -    SELECT 1                                                         1 row {"?column?":1}
   2  B     -    SELECT 1                                                         1 row {"?column?":1}

Inconclusive: 1 finding could not be reproduced 3 of 3 times, so none is reported as a violation.
Coverage: explored 2 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 4]
```

#### A real bug: confirmed 3/3, and the nondeterminism warning appears only when the statement sequence changes between replays
```
$ npx vitest run test/explore.test.ts -t 'AC2.3|nondeterminism warning' --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > lost-update.mjs 273ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > check-then-insert.mjs 252ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > oversell.mjs 484ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > coupon.mjs 410ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > write-skew.mjs 751ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > deadlock.mjs 6755ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > two-preemptions.mjs 239ms
 ✓ test/explore.test.ts > AC2.1 / AC2.2 / AC2.3: every buggy seed is found, confirmed, and reported at its minimal preemption count > pinned explored-schedule counts for every seed 11925ms
 ✓ test/explore.test.ts > AC2.3 confirmation > a deliberately flaky scenario is UNCONFIRMED, exits 4 and never counts as a finding 159ms
 ✓ test/explore.test.ts > AC2.3 confirmation > a confirmed violation reports confirmed 3/3 241ms
 ✓ test/explore.test.ts > nondeterminism warning > warns when the statement sequence differs between the original run and a replay 419ms
 ✓ test/explore.test.ts > nondeterminism warning > does not warn for a deterministic scenario 268ms
      Tests  12 passed | 28 skipped (40)
[exit code: 0]
```

## AC2.4 Coverage statement always printed; never "no race conditions"

#### Clean run
```
$ node dist/cli.js run test/fixtures/seeds/lost-update-safe.mjs
Scenario: lost update (atomic increment)
Target:   127.0.0.1:5433/interleave_test   isolation: default
Strategy: iterative context bounding (0, 1, 2 ... preemptions), DFS
Oracles:  invariants, serial-equivalence

No violations found in 2 schedules (preemption bound 3, exhaustive within bound: yes)
Coverage: explored 2 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

#### Random mode
```
$ node dist/cli.js run test/fixtures/seeds/lost-update-safe.mjs --strategy random --seed 7 --runs 10
Scenario: lost update (atomic increment)
Target:   127.0.0.1:5433/interleave_test   isolation: default
Strategy: seeded random scheduling (seed 7)
Oracles:  invariants, serial-equivalence

No violations found in 10 schedules (random scheduling, seed 7, exhaustive within bound: no)
Coverage: explored 10 schedules (random, seed 7, 2 distinct), preemption bound n/a, exhaustive within bound: no, stopped by: complete
[exit code: 0]
```

#### Asserting tests (regex for the coverage line; forbidden phrases)
```
$ npx vitest run test/explore.test.ts -t 'AC2.4' --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/explore.test.ts > AC2.4 output wording > always prints the coverage statement and never claims there are no race conditions 1249ms
 ✓ test/explore.test.ts > AC2.4 output wording > a clean run says what was explored, not that the code is correct 122ms
      Tests  2 passed | 38 skipped (40)
[exit code: 0]
```

## AC2.5 Isolation matrix on write skew

#### Matrix (three outcomes in separate columns)
```
$ node dist/cli.js run test/fixtures/seeds/write-skew.mjs --isolation matrix
Isolation matrix: write skew (on-call doctors)
(what the explored schedules showed per level; the app's own BEGIN ISOLATION LEVEL overrides the session level)

level  admitted      aborted (retriable)   prevented by blocking/constraint
rc     yes (2)       -                     -
rr     yes (2)       -                     -
ser    no            40001                 -

rc: Coverage: explored 44 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
rr: Coverage: explored 44 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
ser: Coverage: explored 44 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

#### A real fix (SELECT ... FOR UPDATE) shows as prevented by blocking
```
$ node dist/cli.js run test/fixtures/seeds/write-skew-safe.mjs --isolation matrix
Isolation matrix: write skew (SELECT ... FOR UPDATE)
(what the explored schedules showed per level; the app's own BEGIN ISOLATION LEVEL overrides the session level)

level  admitted      aborted (retriable)   prevented by blocking/constraint
rc     no            -                     blocking
rr     no            40001                 blocking
ser    no            40001                 blocking

rc: Coverage: explored 24 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
rr: Coverage: explored 24 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
ser: Coverage: explored 24 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

## AC2.6 Serial-equivalence oracle with no hand-written invariant

#### Lost update, no invariants: caught as ANOMALY
```
$ node dist/cli.js run test/fixtures/seeds/lost-update-no-invariants.mjs | grep -E 'ANOMALY|CONFIRMED|Oracles|Coverage|first seen'
Oracles:  invariants, serial-equivalence
CONFIRMED (3/3) ANOMALY: serial-equivalence - the outcome matches no serial execution of the actors
  first seen at schedule #3 with 1 preemption; seen in 4 schedules in total
Coverage: explored 6 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

#### Benign nondeterminism (uuid + timestamp) is not flagged
```
$ node dist/cli.js run test/fixtures/seeds/benign-nondeterminism.mjs
Scenario: benign nondeterminism (uuid + timestamp)
Target:   127.0.0.1:5433/interleave_test   isolation: default
Strategy: iterative context bounding (0, 1, 2 ... preemptions), DFS
Oracles:  invariants, serial-equivalence

No violations found in 6 schedules (preemption bound 3, exhaustive within bound: yes)
Coverage: explored 6 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
[exit code: 0]
```

## AC2.7 Budgets

#### Schedule budget
```
$ node dist/cli.js run test/fixtures/seeds/explode.mjs --max-schedules 50
Scenario: state explosion
Target:   127.0.0.1:5433/interleave_test   isolation: default
Strategy: iterative context bounding (0, 1, 2 ... preemptions), DFS
Oracles:  invariants, serial-equivalence

No violations found in 50 schedules (preemption bound 3, exhaustive within bound: no)
The search stopped early (schedule-budget); it is not exhaustive.
Coverage: explored 50 schedules, preemption bound 3, exhaustive within bound: no, stopped by: schedule-budget
[exit code: 0]
```

#### Time budget (real clock)
```
$ node dist/cli.js run test/fixtures/seeds/explode.mjs --time-budget 500ms --max-schedules 100000 | tail -4

No violations found in 24 schedules (preemption bound 3, exhaustive within bound: no)
The search stopped early (time-budget); it is not exhaustive.
Coverage: explored 24 schedules, preemption bound 3, exhaustive within bound: no, stopped by: time-budget
[exit code: 0]
```

#### Budget logic is unit-tested with an injected clock
```
$ npx vitest run test/strategy.test.ts test/explore.test.ts -t 'time budget|budget' --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/explore.test.ts > AC2.7 budgets > stops on the schedule budget and says so (exit 0, not exhaustive) 1062ms
 ✓ test/explore.test.ts > AC2.7 budgets > stops on the time budget with the real clock 509ms
 ✓ test/explore.test.ts > AC2.7 budgets > time budget logic with an injected clock 151ms
 ✓ test/explore.test.ts > exitCodeFor semantics (0 vs 1 vs 4) > 0 when nothing was found, including after a budget stop (the wording says it was not exhaustive) 0ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > stops at maxSchedules with stoppedBy schedule-budget and exhaustive false 2ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > finishing exactly on the budget is "complete", not a budget stop 0ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > time budget uses the injected clock: stops before the run that starts past the budget 0ms
 ✓ test/strategy.test.ts > exploreBounded (iterative context bounding) > a time budget of 0 stops before the first schedule 0ms
 ✓ test/strategy.test.ts > exploreRandom (seeded fallback) > honours the time budget through the clock 0ms
      Tests  9 passed | 50 skipped (59)
[exit code: 0]
```

## Exit-code semantics

| Situation | Exit | Wording |
|---|---|---|
| At least one finding replayed 3 of 3 (any stop reason) | 1 | `CONFIRMED (3/3) ...` |
| Findings exist but none replayed 3 of 3 | 4 | `UNCONFIRMED (flaky) ...`, `Inconclusive: ...` |
| No finding, search complete within the bound | 0 | `No violations found in N schedules (preemption bound K, exhaustive within bound: yes)` |
| No finding, stopped by the schedule or time budget | 0 | same line with `exhaustive within bound: no`, plus `The search stopped early (...); it is not exhaustive.` |
| Tool or scenario error, bad option, bad report file, path outside the allowed directories | 2 | error on stderr |
| Unsafe target refused (S1, S2, connect-time checks) | 3 | `refusing target: ...` |
| `replay`: reproduced 3/3 / 0/3 / in between | 1 / 0 / 4 | `Reproduced k/3` |
| `--isolation matrix` | 0 | table only, unless the tool fails |

Spec 4.10 words code 4 as "budget exhausted with only unconfirmed findings"; a budget stop with nothing found is exit 0 with explicit non-exhaustive wording (see DECISIONS.md).

#### Tests covering every row (pure function and CLI)
```
$ npx vitest run test/explore.test.ts test/cli-explore.test.ts test/replay.test.ts -t 'exitCodeFor|exit' --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/explore.test.ts > safe controls never trip the tool > lost-update-safe.mjs: no finding, exhaustive within the bound, exit 0 152ms
 ✓ test/explore.test.ts > safe controls never trip the tool > check-then-insert-safe.mjs: no finding, exhaustive within the bound, exit 0 138ms
 ✓ test/explore.test.ts > safe controls never trip the tool > oversell-safe.mjs: no finding, exhaustive within the bound, exit 0 173ms
 ✓ test/explore.test.ts > safe controls never trip the tool > coupon-safe.mjs: no finding, exhaustive within the bound, exit 0 163ms
 ✓ test/explore.test.ts > safe controls never trip the tool > write-skew-safe.mjs: no finding, exhaustive within the bound, exit 0 925ms
 ✓ test/explore.test.ts > safe controls never trip the tool > deadlock-safe.mjs: no finding, exhaustive within the bound, exit 0 886ms
 ✓ test/explore.test.ts > safe controls never trip the tool > benign-nondeterminism.mjs: no finding, exhaustive within the bound, exit 0 186ms
 ✓ test/explore.test.ts > AC2.3 confirmation > a deliberately flaky scenario is UNCONFIRMED, exits 4 and never counts as a finding 153ms
 ✓ test/explore.test.ts > AC2.7 budgets > stops on the schedule budget and says so (exit 0, not exhaustive) 1163ms
 ✓ test/explore.test.ts > exitCodeFor semantics (0 vs 1 vs 4) > 1 when any finding is confirmed, whatever stopped the search 1ms
 ✓ test/explore.test.ts > exitCodeFor semantics (0 vs 1 vs 4) > 4 when there are findings but none is confirmed 0ms
 ✓ test/explore.test.ts > exitCodeFor semantics (0 vs 1 vs 4) > 0 when nothing was found, including after a budget stop (the wording says it was not exhaustive) 0ms
 ✓ test/cli-explore.test.ts > run without --schedule explores > finds, confirms and prints the lost update (exit 1) with the coverage statement 854ms
 ✓ test/cli-explore.test.ts > run without --schedule explores > a safe scenario exits 0 and says what was explored 642ms
 ✓ test/cli-explore.test.ts > run without --schedule explores > --max-schedules stops with schedule-budget, exit 0, honest wording 1040ms
 ✓ test/cli-explore.test.ts > run without --schedule explores > the flaky scenario exits 4 and is inconclusive 697ms
 ✓ test/cli-explore.test.ts > run without --schedule explores > --isolation ser on write skew: the anomaly is excluded (aborted by the database), exit 0 1182ms
 ✓ test/cli-explore.test.ts > option validation (exit 2) > rejects negative preemptions 493ms
 ✓ test/cli-explore.test.ts > option validation (exit 2) > rejects non-numeric schedules 482ms
 ✓ test/cli-explore.test.ts > option validation (exit 2) > rejects unknown strategy 469ms
 ✓ test/cli-explore.test.ts > option validation (exit 2) > rejects unknown isolation 470ms
 ✓ test/cli-explore.test.ts > option validation (exit 2) > rejects bad time budget 471ms
 ✓ test/cli-explore.test.ts > --json report > refuses to write outside the working directory (exit 2) 486ms
 ✓ test/cli-explore.test.ts > every connection goes through the guard (exit 3) > exploration 514ms
 ✓ test/cli-explore.test.ts > every connection goes through the guard (exit 3) > random fallback 497ms
 ✓ test/cli-explore.test.ts > every connection goes through the guard (exit 3) > isolation matrix 506ms
 ✓ test/cli-explore.test.ts > every connection goes through the guard (exit 3) > hostile query parameter, random fallback 533ms
 ✓ test/replay.test.ts > replay command > re-runs the saved schedule 3 times: reproduced 3/3, exit 1 1484ms
 ✓ test/replay.test.ts > replay command > --violation selects a finding; an unknown id is a usage error (exit 2) 1072ms
 ✓ test/replay.test.ts > replay command > after a fix the same schedule is not reproduced (exit 0), and the wording does not claim a proof 632ms
 ✓ test/replay.test.ts > replay command > refuses a scenario path that escapes the directory (exit 2) 1037ms
 ✓ test/replay.test.ts > replay command > rejects malformed and oversize files (exit 2) without running anything 1030ms
 ✓ test/replay.test.ts > replay command > replay goes through the guard too (exit 3) 581ms
      Tests  33 passed | 50 skipped (83)
[exit code: 0]
```

## Random fallback, replay, S10 and the guard on every new code path

#### Random strategy is deterministic for a seed (two CLI runs produce byte-identical output)
```
$ node dist/cli.js run test/fixtures/seeds/lost-update.mjs --strategy random --seed 3 --runs 25 > /tmp/r1.txt; node dist/cli.js run test/fixtures/seeds/lost-update.mjs --strategy random --seed 3 --runs 25 > /tmp/r2.txt; cmp /tmp/r1.txt /tmp/r2.txt && echo 'identical'; tail -3 /tmp/r1.txt
identical

2 confirmed findings in 25 schedules explored.
Coverage: explored 25 schedules (random, seed 3, 6 distinct), preemption bound n/a, exhaustive within bound: no, stopped by: complete
[exit code: 0]
```

#### Replay a saved schedule: reproduced; then against the fixed scenario: not reproduced
```
$ node dist/cli.js run test/fixtures/seeds/lost-update.mjs --json test/.tmp/saved.json > /dev/null; node dist/cli.js replay test/.tmp/saved.json; node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('test/.tmp/saved.json','utf8'));j.scenarioFile='test/fixtures/seeds/lost-update-safe.mjs';fs.writeFileSync('test/.tmp/saved-fixed.json',JSON.stringify(j))"; node dist/cli.js replay test/.tmp/saved-fixed.json
Replaying v1 (VIOLATION: both deposits applied) under the saved schedule B,A,A,B
Reproduced 3/3
Replaying v1 (VIOLATION: both deposits applied) under the saved schedule B,A,A,B
Reproduced 0/3
note: the statement sequence differs from the saved one (the code under test changed, or the scenario is nondeterministic)
Not reproduced under this schedule. That does not prove a fix: run the full exploration as well.
[exit code: 0]
```

#### S10: replay input is untrusted (schema, size cap, no prototype pollution, path checks) and S1/S2 apply to replay, random and matrix
```
$ npx vitest run test/replay.test.ts test/cli-explore.test.ts -t 'S10|guard|replay|json' --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/cli-explore.test.ts > --json report > writes the report inside the working directory 813ms
 ✓ test/cli-explore.test.ts > --json report > refuses to write outside the working directory (exit 2) 435ms
 ✓ test/cli-explore.test.ts > every connection goes through the guard (exit 3) > exploration 459ms
 ✓ test/cli-explore.test.ts > every connection goes through the guard (exit 3) > random fallback 463ms
 ✓ test/cli-explore.test.ts > every connection goes through the guard (exit 3) > isolation matrix 461ms
 ✓ test/cli-explore.test.ts > every connection goes through the guard (exit 3) > hostile query parameter, random fallback 476ms
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
 ✓ test/replay.test.ts > S10: path checks > resolves paths inside the working directory and refuses everything else 3ms
 ✓ test/replay.test.ts > replay command > re-runs the saved schedule 3 times: reproduced 3/3, exit 1 1432ms
 ✓ test/replay.test.ts > replay command > --violation selects a finding; an unknown id is a usage error (exit 2) 1061ms
 ✓ test/replay.test.ts > replay command > after a fix the same schedule is not reproduced (exit 0), and the wording does not claim a proof 669ms
 ✓ test/replay.test.ts > replay command > refuses a report outside the working directory unless --allow-dir names it 932ms
 ✓ test/replay.test.ts > replay command > refuses a scenario path that escapes the directory (exit 2) 932ms
 ✓ test/replay.test.ts > replay command > rejects malformed and oversize files (exit 2) without running anything 940ms
 ✓ test/replay.test.ts > replay command > replay goes through the guard too (exit 3) 492ms
      Tests  27 passed | 16 skipped (43)
[exit code: 0]
```

#### Hostile DSN with the random fallback
```
$ INTERLEAVE_DSN='postgres://u@localhost:5433/interleave_test?hostaddr=10.0.0.5' node dist/cli.js run test/fixtures/seeds/lost-update.mjs --strategy random --runs 5
refusing target: query parameter "hostaddr" is not allowed (allowed: host=<socket dir>, application_name, connect_timeout)
[exit code: 3]
```

## Controller determinism fix (the Phase 1 gap)

#### Fake-database unit test (slow wake-up of a blocked statement) and the victim-stability test, normal run
```
$ npx vitest run test/controller-determinism.test.ts --reporter=verbose 2>&1 | grep -E '^ +(✓|×)|Tests '
 ✓ test/controller-determinism.test.ts > runnable sets are a pure function of the schedule (blocked actors) > (i) while the blocker is paused at its gate the blocked actor stays not-runnable and the blocker is scheduled 104ms
 ✓ test/controller-determinism.test.ts > runnable sets are a pure function of the schedule (blocked actors) > (ii) once the blocker commits, the blocked actor is runnable at the very next decision, every time 1925ms
 ✓ test/controller-determinism.test.ts > runnable sets are a pure function of the schedule (blocked actors) > a deadlock does not stall the controller 365ms
 ✓ test/controller-determinism.test.ts > deadlock victim is stable > the first blocked actor is always the one Postgres aborts (40P01), run after run 12666ms
 ✓ test/controller-determinism.test.ts > controller unit test with a fake database (slow wake-up of a blocked statement) > waits for a blocked statement whose blocker has released, so the runnable set does not depend on wake-up speed 180ms
      Tests  5 passed (5)
[exit code: 0]
```

## Determinism proof

Everything above is deterministic by construction (the runnable set is a pure function of the choices; the PRNG is seeded; no wall-clock value enters a result), and this was measured, not assumed.

The tool is `packages/engine/scripts/determinism.mjs`. One iteration explores 17 scenarios with the built CLI (14 seed scenarios, the no-invariant lost update, the flaky one, and the exploding one with `--max-schedules 30`) and records two hashes: **summary** (exit code, schedules explored, stopped-by, serial reference runs, every finding with kind, status, confirmed, first-violating-schedule index, preemptions, occurrences and the replayable schedule) and **full** (the complete `--json` report, timelines and hints included).

| Run | Iterations | Summary hashes identical | Full-report hashes identical | Raw output |
|---|---|---|---|---|
| Local, normal | 20 | 20 of 20 (`5f987543e8a8`) | 20 of 20 (`3c739421396c`) | `docs/determinism-20x.txt` |
| Local, 12 busy-loop processes (one per core) running throughout | 20 | 20 of 20 (`5f987543e8a8`) | 20 of 20 (`3c739421396c`) | `docs/determinism-20x-stress.txt` |
| Exploration test suite (`explore`, `strategy`, `controller-determinism`, `oracles`: 74 tests, including the pinned per-seed counts) run 20 times | 20 | 74 passed, 0 failed, 0 skipped in each of the 20 runs; the set of test names and statuses hashes to the same value (`e31c4edd6d1a`) in all 20 | n/a | `docs/suite-20x.txt` |
| Linux CI, Node 20 and Node 22 | 5 each | 5 of 5 | 5 of 5 | CI run below |

Schedule counts per scenario (identical in every iteration): lost-update 6, check-then-insert 6, oversell 14, coupon 14, write-skew 44, deadlock 34, two-preemptions 6, lost-update-safe 2, check-then-insert-safe 2, oversell-safe 4, coupon-safe 4, write-skew-safe 24, deadlock-safe 24, benign-nondeterminism 6, lost-update-no-invariants 6, flaky 2, explode 30 (stopped by the schedule budget).

### Flakes found on the way, and what was done about them (none retried away)
1. **Runnable set depended on wake-up speed** (Phase 1 gap). Fixed by re-probing blocked actors at every decision. Unit test with a slow fake wake-up fails without the fix and passes with it.
2. **Deadlock victim flipped under CPU load.** The nondeterminism warning (statement sequence differs between the original run and a replay) fired, and an early determinism run showed the full-report hash differing in iteration 1 only (the deadlock finding carried that warning). A victim-stability test (40 forced runs) failed with 12 busy cores (B in 40 of 40 instead of A). Cause: Postgres aborts the waiter whose `deadlock_timeout` timer fires first once a cycle exists; with 50 ms, a second waiter that starts more than 50 ms late becomes the victim. Fix: `deadlock_timeout` 300 ms (DECISIONS.md). After the fix the same test passes under the same load, and all runs above are identical.
3. A first CI run failed on a Windows-only assumption in a test (`C:\Windows\win.ini` is a relative file name on Linux). The safety check itself was correct; the test was made platform-aware.

## CI (Linux, Node 20 and Node 22)

Latest green run before this report: https://github.com/Aditya-tec/interleave-pg/actions/runs/40507460030

| Job | Result | Tests | Determinism step |
|---|---|---|---|
| test (20) | success | 199 passed, 0 skipped, 0 failed | 5 of 5 identical (summary and full) |
| test (22) | success | 199 passed, 0 skipped, 0 failed | 5 of 5 identical (summary and full) |

The workflow now fails the job if any test is skipped, failed or todo (JSON results check), so an environment check that cannot run in CI fails instead of skipping.

## Result table

| AC | Result | Evidence |
|---|---|---|
| AC2.1 | PASS | All 7 buggy seeds found and confirmed 3/3, at the exact pinned first-violation index and schedule count (table above); all 7 safe controls clean and exhaustive within the bound; benign-nondeterminism control not flagged |
| AC2.2 | PASS | Each seed's minimal preemption count (derived by reasoning before the first run, commit a2d9ac7) equals the observed one; the synthetic bug needing exactly 2 is found at 2 and is invisible with `--max-preemptions 1`, which says so |
| AC2.3 | PASS | Every reported violation is `3/3`; the deliberately flaky scenario is UNCONFIRMED, never counted, exit 4 |
| AC2.4 | PASS | The coverage line is on every output (tests assert the regex on a buggy run, a clean run and a budget stop); "no race conditions" and similar phrases are asserted absent |
| AC2.5 | PASS | Write skew: admitted under rc and rr, not admitted under ser with 40001 aborts; three outcomes listed in separate columns; the `FOR UPDATE` fix shows as prevented by blocking |
| AC2.6 | PASS | Lost update with no hand-written invariant is caught as a CONFIRMED ANOMALY (serial-equivalence); the oracle can be switched off |
| AC2.7 | PASS | `--max-schedules 50` and `--time-budget 500ms` stop with the right `stopped by`, exit 0, "not exhaustive" wording; time-budget logic unit-tested with an injected clock |
| Determinism (hard requirement) | PASS | 20 of 20 identical normally, 20 of 20 under full CPU load, 20 of 20 test-suite runs, 5 of 5 on both Linux jobs |
| Guard on every new path | PASS | Hostile and remote DSNs are refused with exit 3 for exploration, the random fallback, the isolation matrix and replay (tests above); all connections still go through the Phase 1 guard |

## What was not done or not verified
- Phase 3 (the full corpus, recall and false-positive gates, p95 runtime) was not started. For reference, the slowest seed here (deadlock) takes about 7 s per CLI run because each deadlock schedule waits for `deadlock_timeout` (300 ms).
- Only the Postgres 17 service was exercised (spec expects 14 to 18).
- macOS was not run (the host-binding test uses 127.0.0.2).
- `--html` and `--strict` are deferred to Phase 4 as agreed.
- Hints are heuristics tested on the seeds only.
- Every limitation found is in `docs/LIMITATIONS.md` ("Found in Phase 2").
