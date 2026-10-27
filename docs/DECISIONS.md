# Decisions

| Date | Decision | Reason | Alternatives rejected |
|---|---|---|---|
| 2026-10-27 | License MIT | Human decision | Apache-2.0 |
| 2026-10-27 | No TS loader dependency. Scenarios/examples are `.mjs`; `.ts` only on Node >= 22.18 | Human decision. Verified at nodejs.org: type stripping enabled by default from v22.18.0 (added v22.6.0 behind a flag) | `tsx` runtime/dev dependency |
| 2026-10-27 | Working name `raceproof` kept; npm name is free, but GitHub has several unrelated "RaceProof" repos | Human said not to rename on my own. Alternatives are in the session report | Renaming unilaterally |
| 2026-10-27 | Dev deps only: typescript, vitest, @types/node, @types/pg, pg, knex. Runtime deps: none; `pg` is a peer dependency; CLI parsing via `node:util.parseArgs` | Human-approved list | commander/yargs |
| 2026-10-27 | Postgres 17 in docker-compose on 127.0.0.1:5433 (tmpfs data) | Within supported majors 14-18 (postgresql.org/support/versioning, checked today; 14 is EOL 2026-11-12) | Binding 0.0.0.0, persistent volume |
| 2026-10-27 | Source layout is flat files in `packages/engine/src/` (not one folder per component) | Phase 1 components are small; folders can come later without API change | Folder per component |
| 2026-10-27 | `run` applies the scenario's `schema` file at start; `init-db` creates the DB, marker table and `deadlock_timeout` only | Spec CLI gives `init-db` no scenario argument, and changing the CLI needs approval | Adding a scenario argument to `init-db` |
| 2026-10-27 | `init-db --compose` prints the compose file to stdout rather than writing it | No surprise file writes | Writing docker-compose.yml |
| 2026-10-27 | `run` requires `--schedule` in Phase 1 | Exploration is Phase 2 | Silent default policy |
| 2026-10-27 | Loopback host aliases (`localhost`, `127.0.0.1`, `::1`) are treated as equal for the S2 client-vs-target check; port and database must match exactly | All are the same machine; port/db are what distinguish databases | Exact string match |
| 2026-10-27 | At teardown the engine ends every client it saw | Lets a library caller exit without the scenario exposing a close hook (no new public API) | A `close` convention on the setup result |
| 2026-10-27 | CI actions pinned by commit SHA (checkout v7.0.1, setup-node v7.1.0 via GitHub API) | S7 | Tag pins |
