# Limitations (kept up to date as discovered)

- Not a proof of correctness: results only cover the explored schedules.
- Local throwaway Postgres only (host must be loopback/unix socket, DB name `interleave_*`, marker table present).
- Phase 1 supports forced schedules only; no exploration yet.
- Out of scope in v1: Prisma, `pg-native`, MySQL/SQLite/Mongo, multi-process apps, Redis locks, external side effects, parallel statements inside one actor, LISTEN/NOTIFY.
- `.ts` scenarios need Node >= 22.18 (native type stripping); use `.mjs` otherwise.
- Unix-socket DSNs must be written as `postgres:///db?host=/dir` or `postgres://user@%2Fdir/db`; `postgres://user@/db?host=...` is not parseable by WHATWG URL and is refused (safe direction).
- Statement results are shown on the step where the statement was released, even if it completed later (a blocked statement shows its final result after the blocker committed). The `[BLOCKED]` marker flags these.
- Block detection polls `pg_blocking_pids` every 10 ms and needs 2 consecutive hits, so a blocked statement is classified about 20-30 ms after release. A statement waiting on something that is not a Postgres lock (e.g. `pg_sleep`) is just "in flight" until `statement_timeout` (5 s).
- Actors must be quiescent between statements. Non-database waits (timers, HTTP) trigger a stall error after 3 s; stub them.
- The engine ends every client it saw when a session closes. Pools owned by the app are left with dead clients afterwards.
- Statements issued outside any actor (e.g. in `setup`) pass through ungated; in `run` they are reported as warnings. Connections made during `setup` are only gated from their first in-actor statement.
- `to_regclass('public.interleave_marker')` is the one read-only catalog probe sent before the guard accepts a target; every earlier refusal sends nothing (no connection is opened).
- The marker table proves `init-db` was run on that database, not who ran it. Anyone can create a table with that name.
- Verified only on Windows 11 + Docker Desktop (Postgres 17.11) and Node 22.16 in this session. Linux/macOS and Node 20 were not run. CI has not run (no remote), so "CI green" is unverified.
- `.ts` scenarios could not be exercised here: Node 22.16 is below 22.18, so only the clear-error path was tested.
- Windows: the engine behaved correctly natively with Docker Desktop; no WSL2 workaround was needed in this session.
- Custom-stream detection is structural: a pristine `net.Socket` that the user constructed and passed as `stream` looks the same as pg's own and is allowed. It still connects to the already-checked host and port, so it cannot redirect traffic. Any other stream type, subclass, pre-connected socket or instance-patched `connect` is refused.
- The host-binding test uses `127.0.0.2`; on macOS (where only `127.0.0.1` is configured by default) it is skipped with a message instead of run.
- `pg-native` is out of scope and not guarded.
- The engine's target DSN never uses `PG*` environment fallbacks (host defaults to `localhost`, port to 5432); only app clients are checked against the environment-resolved values.

## Found in Phase 2
- Exploration is stateless replay: every schedule re-runs the scenario from scratch. A scenario that is not deterministic given the same schedule (random parameters, `Date.now()`, external calls) can make a saved schedule diverge; the tool prints "nondeterministic scenario" when the statement sequence or the choices differ on replay, but it cannot repair it.
- Actor return values are part of the outcome the serial oracle compares. An actor that returns a fresh uuid or timestamp will look non-serializable; return stable values or set `serialOracle: false`.
- The serial oracle treats a non-retriable application or constraint error as part of the outcome. Code that correctly relies on a unique constraint (the second writer gets `23505`) can therefore be reported as an ANOMALY, because the serial order would not have raised it. Use `ON CONFLICT` in the code under test, or switch the oracle off, or write invariants instead.
- Serial reference outcomes cover all orders of the actors (at most 24), run once per distinct subset of actors when some are aborted (40001/40P01). They cost wall-clock time and are counted against the time budget.
- Identity and serial columns are excluded from snapshots, so a bug that only shows up in generated ids is invisible to the serial oracle. Rows are compared as a sorted multiset.
- Bounded exploration only covers schedules with at most K preemptions (default 3). "Exhaustive within bound: yes" never means "all interleavings"; the coverage statement always says which bound applied.
- Confirmation runs once per distinct (kind, invariant). An unconfirmed (flaky) finding is not retried on later occurrences.
- Random mode (`--strategy random`) can repeat schedules (the report gives distinct count) and is never exhaustive.
- Isolation override sets `SET SESSION CHARACTERISTICS` on each new connection; an app that issues `BEGIN ISOLATION LEVEL ...` itself overrides it. The matrix therefore only describes apps that use the session default.
- `deadlock_timeout` is 300 ms on the test database (see DECISIONS.md). A deadlock schedule costs at least that long, and the victim is only stable while the second waiter starts waiting within that window; extreme CPU starvation can still flip it. The nondeterminism warning would then appear.
- Block detection (two probes 10 ms apart, then a re-probe at every decision) adds about 20-30 ms per blocking statement.
- Hints are regex heuristics over statement text, not a SQL parser; they miss queries with CTEs, subselects in the FROM list, or ORM-generated aliases, and they never replace the invariant that failed.
- `replay` re-checks one finding under its saved schedule only. "Not reproduced" does not prove a fix; run the full exploration too.
- The CI determinism step compares counts, findings, schedules and full JSON reports across 5 runs on one machine, not across machines.
