# Phase 4 report: CLI, reports, DX

Status: Phase 4 complete and pushed to `main` (code head `8b43d7a`). **CI run 40654596871: all 9 jobs green** (full Node 20/22 x Postgres 15-18 matrix plus the README quickstart job). Phase 4b has not been started and Phase 5 has not been started; both wait for your confirmation.

CI: https://github.com/Aditya-tec/interleave-pg/actions/runs/40654596871

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Quickstart in at most 5 commands and under 5 minutes, tested in CI from a clean checkout | The README block is 5 lines. CI job `README quickstart` extracts that block from README.md and runs it verbatim in an empty directory on Node 22 with no service container (it starts its own Postgres with `docker compose up -d --wait`), on pushes to main and manual dispatch only. Run 40654596871: the whole job took **25 s** (install 3 s, container healthy about 3 s after start); the final command exited 1 with `CONFIRMED (3/3) VIOLATION: never redeem more than the card holds - 120 redeemed from a card holding 100` and the coverage line; the job fails above 300 s or if that output is missing. Locally, a clean clone + `npm ci` + build took 15 s |
| `examples/gift-card/`: `run` with no `--schedule` finds the bug unaided | `test/examples.test.ts`; the real output is in README.md (6 schedules, found at schedule #3 with 1 preemption). The fixed version explores 2 schedules and reports none |
| S4: HTML report escapes everything | `test/html-report.test.ts` (8 tests): hostile payloads in every field (scenario name, file, host, db, invariant, detail, SQL, params, results, hints, warnings, notes) render as text; every tag in the page is checked against an allowlist of static tags; CSP meta `default-src 'none'`; no script/link/iframe/object/embed; a real hostile scenario run through the CLI is inert; `--html` needs `.html`, refuses to overwrite a file without the report marker, obeys the path rules |
| S5: passwords redacted | `test/redaction.test.ts` (16 tests): URL (including raw `@`/`/` in the password, no user, upper-case scheme), `?password=`, keyword/value (quoted too); refused target, malformed DSN, refused parameter, wrong password, `--dsn`, init-db, doctor, replay, and report.json/report.html contain none |
| S10 | Existing tests plus `--html`: same path rules, `.html` extension, marker check before overwrite. `report.json` has `schemaVersion: 1`; `replay` rejects a missing or unknown version; `run --json` validates against `packages/engine/schema/report.schema.json` before writing (`test/report-schema.test.ts`) |
| `--strict` | `test/strict.test.ts`: LISTEN and statements outside any actor are warnings normally and exit 2 (`UnsupportedError`, naming the statement and the flag) with `--strict`; a clean scenario is unaffected |
| Helpful errors | `test/helpful-errors.test.ts` (8): database not running, database missing, wrong password, no DSN, missing file, unknown option, unknown command (with suggestion), invalid scenario: one sentence of what and one of what to do, no stack, no password |
| Ctrl-C cleanup | `test/interrupt.test.ts`: in-process (cleanup once, 130/143, second signal exits at once, grace period); real signal: spawns the CLI mid-transaction, sends SIGINT, expects exit 130, no leftover session in the database, advisory lock free, uncommitted update rolled back. **It runs on Linux CI (443 passed, 0 skipped on every job)**; locally on Windows it is skipped with a printed reason, and I also ran it in a Linux container |
| `doctor` diagnoses 5 seeded misconfigurations | `test/doctor.test.ts` seeds 9 cases: no DSN, remote host, nothing listening, no marker table, pg not resolvable from the scenario directory, scenario that does not load, listed table missing with no schema, production NODE_ENV, plus the healthy case. Every `[FAIL]` line is followed by a `fix:` line (asserted). Exit 0 / 3 (refused by the guard) / 2 |

## Additions from Phase 3/3b

1. **Schema isolation** (landed in `af96478`, regression tests in `test/schema-isolation.test.ts`, 14 tests): tables are dropped only when the scenario supplies a `schema`; with none they are truncated and reseeded, never dropped; guard refusals and the unlisted-table warning kept; the five human scenarios exactly as supplied run back to back after clashing dev scenarios.
2. **Nondeterminism**: the serial schedule runs twice; differing outcomes mark the oracle UNRELIABLE (`oracle` in report.json), ANOMALY suppressed, invariant findings kept; a 0-preemption anomaly is never reported as a race (`test/nondeterminism.test.ts`, 6).
3. **Retriable aborts** 40001/40P01 print a note, never a finding, including ser-no-retry (`test/notes-and-hints.test.ts`).
4. **Metrics**: counts instead of percentages for sets under 20 scenarios, observed preemption counts recorded (`test/metrics.test.ts`, 15). See the tables below.
5. **Bound message**: how to raise the bound, schedules per preemption level, growth factor, a hint for 3 or more actors, how to raise the budget.
6. **Phase 3 gates still pass** (see the regression table). DECISIONS.md has an entry for each item.

## Test evidence

- Local (Windows, Postgres 17.11): 30 files, **442 passed, 1 skipped** (the real-signal test, by design on Windows).
- CI: every job `443 passed, 0 skipped, 0 failed, 0 todo`; determinism step: 5 iterations, summary and full-report hashes identical 5/5 (local run: `eval/results/post-phase4-after-stale-fix-2026-10-28/determinism.txt`).
- New runtime dependencies: none.

## A bug the regression check found (please read)

The first post-Phase-4 run of the hard set (`eval/results/post-phase4-2026-10-28/hard.md`) **missed** `queue-claim-select-update` with `UnsupportedError: parallel statements within one actor ("A")`; the other 31 scenarios and all other sets were unchanged. Two reruns of the same set hit it (14/14), 40 stress runs of the scenario alone under full CPU load never failed, so it was intermittent: **1 of 3 full hard-set runs**.

Cause (reproduced deterministically before fixing, `test/stale-actor.test.ts`): the preceding stall scenario (`limit-timer-wait`) is abandoned after 3 s but its actor sleeps 8 s; it woke up 2.8 s later and issued its UPDATE as actor "A" into whichever scenario was running. Run ids also restarted at 1 in every session, so the engine could not tell the statement was stale. This flaw existed in Phase 3 and 3b; the earlier hard-set 14/14 had the stray statement land harmlessly. Fix: run ids are unique per process and the hook rejects a statement from an earlier run (`StaleRunError`) without executing it. The Phase 3b result stands as recorded; it was lucky timing, not a different engine.

## Post-Phase-4 regression check (development data, **not held-out claims**)

Local, Postgres 17.11, after the fix, `eval/results/post-phase4-after-stale-fix-2026-10-28/`. Set hashes verified unchanged against HELDOUT.md and HARD_SET_RESULTS.md before running. These sets have all been seen and used for fixes; this is a regression check only.

| Set | Scenarios | Buggy hit | Safe flagged | Confirmation | Gates |
| --- | --- | --- | --- | --- | --- |
| dev | 54 | 29 of 29 in-scope | 0 of 22 | 59 confirmed, 0 unconfirmed | PASS |
| heldout (agent-written, now development data) | 15 | 9 of 9 | 0 of 6 | 17 / 0 | PASS |
| heldout-human (now development data) | 5 | 3 of 3 | 0 of 2 | 7 / 0 | PASS |
| hard (adversarial, now development data) | 32 | 14 of 14 | 0 of 14; 4 of 4 honest limits correct | 27 / 0 | PASS |

(First run before the fix: hard 13 of 14, the miss above; the rest identical.) A new held-out set is needed for any future headline claim.

## Limitations and things not done

- The quickstart clones the default branch from GitHub, so a manual dispatch from another branch tests `main`. Nothing is published to npm (Phase 8, needs your approval).
- The real-signal Ctrl-C test does not run on Windows; on Windows only the in-process tests run.
- An abandoned actor cannot be stopped; its late statements are now rejected only if they go through the patched `pg` client.
- `--strict` sees only the patched `pg` client, like everything else.
- The oracle self-check costs two serial runs per scenario.
- `examples.test.ts` was written after the example (the example was created first, then the test); all other new behaviour had its failing test first.
- Spec section 6 and Appendix B updated; `docs/LIMITATIONS.md` and `docs/DECISIONS.md` have the Phase 4 entries.

## Waiting for you

Phase 4b (real-world trial) starts only when you confirm. First step then: the list of candidate open-source apps with licences and commit SHAs, and the path to your own checkout or rewards repo if it uses Postgres. Everything stays outside this repository, with the scrubbed-environment and `--ignore-scripts` rules you set.
