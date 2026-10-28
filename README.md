# interleave-pg

Find, reproduce and re-check concurrency bugs in Node.js + Postgres code. interleave-pg runs your code's database
statements through many different orderings (interleavings) against a **local throwaway database**, and shows you the
exact ordering that breaks an invariant.

It does not prove your code is correct. "No violations found" means none in the schedules it explored, within the stated
bound (the coverage line says exactly which). See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Quickstart (5 commands, needs Node 20+ and Docker)

```bash
git clone https://github.com/Aditya-tec/interleave-pg.git && cd interleave-pg
npm ci && npm run build
docker compose up -d --wait
INTERLEAVE_DSN=postgres://postgres:interleave-pg@127.0.0.1:5433/postgres npx interleave-pg init-db
INTERLEAVE_DSN=postgres://postgres:interleave-pg@127.0.0.1:5433/interleave_dev npx interleave-pg run examples/gift-card/scenario.mjs
```

The first two commands install and build, the third starts a throwaway Postgres on `127.0.0.1:5433` (data lives in
memory and disappears when the container stops), the fourth creates the database `interleave_dev` in it, and the fifth
runs the example. On Windows PowerShell set the variable first (`$env:INTERLEAVE_DSN = "..."`) and run the command
without the prefix.

The example is a gift card holding 100 that two customers redeem 60 from at the same moment
([examples/gift-card/](examples/gift-card/)). You give interleave-pg no schedule: it finds the failing one itself.
Real output:

```text
Scenario: gift card: two concurrent redemptions
Target:   127.0.0.1:5433/interleave_dev   isolation: default
Strategy: iterative context bounding (0, 1, 2 ... preemptions), DFS
Oracles:  invariants, serial-equivalence

CONFIRMED (3/3) VIOLATION: never redeem more than the card holds - 120 redeemed from a card holding 100
  first seen at schedule #3 with 1 preemption; seen in 4 schedules in total
  schedule: B,A,A,B
   #  Actor Txn  SQL                                              Params          Result
   1  B     -    SELECT balance FROM gift_cards WHERE code = $1   ["GC-1"]        1 row {"balance":100}
   2  A     -    SELECT balance FROM gift_cards WHERE code = $1   ["GC-1"]        1 row {"balance":100}
   3  A     -    UPDATE gift_cards SET balance = $1 WHERE code... [40,"GC-1"]     UPDATE 1
   4  B     -    UPDATE gift_cards SET balance = $1 WHERE code... [40,"GC-1"]     UPDATE 1
  notice: This run cannot see locks held outside the database. If such a lock serializes these actors in production, this race may not occur there.
  hint (heuristic): read-modify-write: B read "gift_cards" (step 1), A wrote it (step 3), then B wrote it from the stale read (step 4). Typical fix: do the update in one statement (UPDATE t SET n = n + $1), or SELECT ... FOR UPDATE inside a transaction

CONFIRMED (3/3) ANOMALY: serial-equivalence - the outcome matches no serial execution of the actors
  ...

2 confirmed findings in 6 schedules explored.
Coverage: explored 6 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
```

The exit code is 1 (a confirmed violation). Now run the fixed version of the same code:

```bash
INTERLEAVE_DSN=postgres://postgres:interleave-pg@127.0.0.1:5433/interleave_dev npx interleave-pg run examples/gift-card/scenario-fixed.mjs
```

```text
No violations found in 2 schedules (preemption bound 3, exhaustive within bound: yes)
Bugs that need more than 3 preemptions were not searched for. To look deeper use --max-preemptions 4; schedules at each preemption level so far: 0: 2.
Coverage: explored 2 schedules, preemption bound 3, exhaustive within bound: yes, stopped by: complete
```

If something does not work, `npx interleave-pg doctor` checks the setup and prints what to do about each problem.

## Commands

| Command | What it does |
| --- | --- |
| `init-db [--name N] [--compose] [--deadlock-timeout 300ms]` | Creates the throwaway database (with the marker table the safety guard requires). `--compose` prints a docker-compose file. |
| `run <scenario> [options]` | Explores interleavings. `--max-preemptions K`, `--max-schedules N`, `--time-budget 120s`, `--strategy dfs\|random --seed N --runs M`, `--isolation default\|rc\|rr\|ser\|matrix`, `--json out.json`, `--html out.html`, `--strict`, `--allow-dir DIR`, `--schedule A,B,A,B` (one forced schedule). |
| `replay <report.json> [--violation v1]` | Re-runs a saved failing schedule 3 times. A schedule that no longer fails does not prove a fix: run the full exploration again. |
| `doctor [scenario]` | Diagnoses the setup; with a scenario it checks that scenario too. |

Exit codes: `0` nothing found in the explored schedules, `1` a confirmed violation, `2` tool or scenario error,
`3` unsafe target refused, `4` findings that did not reproduce 3 of 3 times.

`--strict` turns what interleave-pg cannot gate (`COPY`, `LISTEN`, cursors, statements issued outside any actor) from a
warning into an error. Ctrl-C rolls back open transactions, closes every connection and releases the lock before exiting.

## Writing a scenario

A scenario is a `.mjs` file whose default export names the tables, the concurrent actors and the invariants. Start from
[examples/gift-card/scenario.mjs](examples/gift-card/scenario.mjs). `tables` are truncated and reseeded before every
schedule; if you give a `schema` file, only the listed tables are dropped and recreated first. Your own code must create
its `pg` connections before the actors start (in `setup`), and the scenario must resolve the same `pg` the code under
test uses.

## Safety

interleave-pg only talks to a local Postgres (`localhost`, `127.0.0.1`, `::1` or a unix socket), only to a database whose
name starts with `interleave_` and that contains the marker table created by `init-db`, never when `NODE_ENV` is
`production`, and only with a DSN from `--dsn` or `INTERLEAVE_DSN` (never `DATABASE_URL`). Passwords are redacted from
everything it prints or writes. Report files are written only inside the working directory (or a directory named with
`--allow-dir`), and report files given to `replay` are treated as untrusted input.

## Status

Pre-release, not published to npm. Tested on Postgres 15-18 and Node 20 and 22. Design notes: [docs/DECISIONS.md](docs/DECISIONS.md),
[docs/LIMITATIONS.md](docs/LIMITATIONS.md); measurement protocol: [docs/METRICS.md](docs/METRICS.md).

MIT licence.
