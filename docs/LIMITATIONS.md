# Limitations (kept up to date as discovered)

- Not a proof of correctness: results only cover the explored schedules.
- Local throwaway Postgres only (host must be loopback/unix socket, DB name `raceproof_*`, marker table present).
- Phase 1 supports forced schedules only; no exploration yet.
- Out of scope in v1: Prisma, `pg-native`, MySQL/SQLite/Mongo, multi-process apps, Redis locks, external side effects, parallel statements inside one actor, LISTEN/NOTIFY.
- `.ts` scenarios need Node >= 22.18 (native type stripping); use `.mjs` otherwise.
- Unix-socket DSNs must be written as `postgres:///db?host=/dir` or `postgres://user@%2Fdir/db`; `postgres://user@/db?host=...` is not parseable by WHATWG URL and is refused (safe direction).
- Statement results are shown on the step where the statement was released, even if it completed later (a blocked statement shows its final result after the blocker committed). The `[BLOCKED]` marker flags these.
- Block detection polls `pg_blocking_pids` every 10 ms and needs 2 consecutive hits, so a blocked statement is classified about 20-30 ms after release. A statement waiting on something that is not a Postgres lock (e.g. `pg_sleep`) is just "in flight" until `statement_timeout` (5 s).
- Actors must be quiescent between statements. Non-database waits (timers, HTTP) trigger a stall error after 3 s; stub them.
- The engine ends every client it saw when a session closes. Pools owned by the app are left with dead clients afterwards.
- Statements issued outside any actor (e.g. in `setup`) pass through ungated; in `run` they are reported as warnings. Connections made during `setup` are only gated from their first in-actor statement.
- `to_regclass('public.raceproof_marker')` is the one read-only catalog probe sent before the guard accepts a target; every earlier refusal sends nothing (no connection is opened).
- The marker table proves `init-db` was run on that database, not who ran it. Anyone can create a table with that name.
- Verified only on Windows 11 + Docker Desktop (Postgres 17.11) and Node 22.16 in this session. Linux/macOS and Node 20 were not run. CI has not run (no remote), so "CI green" is unverified.
- `.ts` scenarios could not be exercised here: Node 22.16 is below 22.18, so only the clear-error path was tested.
- Windows: the engine behaved correctly natively with Docker Desktop; no WSL2 workaround was needed in this session.
