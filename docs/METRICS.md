# How the engine is measured (Phase 3)

This file is written and committed before the first measurement and is not edited afterwards. If a definition turns out to be wrong, the fix is a new file (`METRICS_v2.md`) that says what changed and why; the original stays.

## Scenarios

Each scenario is a directory `corpus/<set>/<id>/` with `scenario.mjs` (the code under test and its actors and invariants), `schema.sql` and `expected.json`. The sets are:

| Set | Purpose | May the engine be tuned against it? |
|---|---|---|
| `dev` | development corpus | yes |
| `heldout` | written and committed (with a recorded hash, `docs/HELDOUT.md`) before the final run; run once | no |
| `heldout-human` | scenarios added by the project owner, picked up with no code change | no |

`expected.json` fields: `expect` (`buggy`, `safe`, `unsupported`), `scope` (`in` or `out`), `class`, `driver` (`pg`, `knex`, `drizzle`, `stub`), for buggy `invariant` (the exact name the finding must carry; `serial-equivalence` for scenarios that rely on the generic oracle), for safe `fix`, for out-of-scope the message or notice that must appear (`message` regex on the tool output, `notice` regex on findings). It is written before the scenario is ever run and is never edited after a result has been seen.

## What is measured, and on what

Every scenario is explored once with the **default options** (preemption bound 3, 2000 schedules, 120 s budget, serial oracle on, 3 confirmation replays), in process through the built engine, against a throwaway database, one scenario at a time. A scenario is **in scope** unless `scope` is `out`.

## Definitions

* **Finding.** One entry of `report.violations`: a distinct (kind, invariant) pair seen in at least one explored schedule.
* **Confirmed finding.** A finding whose first schedule reproduced it in 3 of 3 replays (`status: CONFIRMED`). **Unconfirmed** findings are never counted as detections or as false positives; they are counted under *confirmation rate* and listed.
* **Detected (a hit).** A buggy in-scope scenario with at least one confirmed finding whose invariant equals `expected.invariant` (kind VIOLATION or ANOMALY, the name decides).
* **Mismatch.** A buggy in-scope scenario with confirmed findings, none of which matches `expected.invariant`. A mismatch is **not** a hit; it is reported separately with the finding names.
* **Miss.** A buggy in-scope scenario that is neither a hit nor a mismatch: no confirmed finding, or the run ended in an error (exit code 2 or 3). Mismatches and errors count against recall too.
* **False positive.** A safe in-scope scenario with at least one confirmed finding of any kind.
* **Error.** A scenario whose run ended with a tool error (exit 2 or 3) or exceeded the harness limit of 300 s. An error on a buggy scenario is a miss; an error on a safe scenario is reported on its own line (it is neither a false positive nor a clean pass).

## Metrics (each reported per set, never merged across sets)

| Metric | Definition | Gate |
|---|---|---|
| Recall | hits / (in-scope buggy scenarios) | at least 90% |
| False-positive rate | false positives / (in-scope safe scenarios) | exactly 0 |
| Confirmation rate | confirmed findings / (confirmed + unconfirmed findings), over every scenario in the set | 100% |
| Schedules explored | per scenario `coverage.explored`; median and p95 over the set | reported |
| Runtime | per scenario wall time of `explore` (engine only, excluding node start-up); median and p95 over the set | median at most 10 s, p95 at most 60 s |
| Mismatches, errors | counts and names | reported, each analysed |

Percentiles use the nearest-rank method on the sorted per-scenario values.

## Out-of-scope items

Scenarios with `scope: out` (a driver the hook cannot see, parallel statements inside one actor, a lock held outside the database) are excluded from every rate above and from the runtime percentiles. They are reported in a separate "honest limits" table: for each, whether the tool produced the explicit message or notice its `expected.json` requires (pass/fail on that requirement only).

## Where the runtime gate is judged

The official runtime numbers come from one designated CI job (Postgres 17, Node 22), median and p95 over 3 CI runs of the same commit, on a standard 4-vCPU runner. Local numbers (12 cores, Windows, Docker Desktop) are reported separately and are not the gate.

## Held-out discipline

The held-out numbers come from exactly one local run on Postgres 17, made after `docs/HELDOUT.md` records the hash of the committed held-out set and after the project owner confirms `corpus/heldout-human/` is complete. A later CI run of the same set on other Postgres versions is a separate report of version differences. No engine change is made in response to held-out results; failures are reported as misses.
