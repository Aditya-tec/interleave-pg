# corpus/heldout-human: scenarios written by the project owner

Scenarios you drop in here are measured as the **human held-out set**: separately from `dev` and `heldout`, never used to tune the engine, and picked up by the metrics script with **no code change**.

## Add a scenario

1. Copy `_template/` to `corpus/heldout-human/<your-id>/`. The name must **not** start with `_` or `.`: directories that do are ignored on purpose, which is why `_template/` and `_example-retried-job/` are not measured.
2. Fill in `scenario.mjs`, `schema.sql` and `expected.json` (below). Write `expected.json` **before** you run anything and do not edit it after you have seen a result.
3. Check that it behaves for one user: `npm test -w interleave-pg -- corpus-unit` runs every scenario serially (A then B, and B then A); every invariant must hold there.
4. Look at it with the CLI: `INTERLEAVE_DSN=postgres://... node packages/engine/dist/cli.js run corpus/heldout-human/<your-id>/scenario.mjs`.
5. Measure the set: `INTERLEAVE_DSN=postgres://... npm run metrics -- --set heldout-human`.

## The three files

* `schema.sql`: DDL. Drop-then-create every table, so it can run again.
* `scenario.mjs`: `export default { name, tables, schema: 'schema.sql', seed, setup, actors, invariants }`. `setup({ dsn })` runs once and returns what the actors need (build pools there, warm them up, stub anything that is not the database). `actors` are 2 to 4 functions of that value. Invariants state the business rule (SQL returning a boolean `ok`, or a function). The API is in spec section 6.
* `expected.json`:

```json
{
  "id": "my-scenario",
  "expect": "buggy | safe | unsupported",
  "scope": "in | out",
  "class": "free text, e.g. lost-update",
  "driver": "pg | knex | drizzle | stub",
  "invariant": "exact name of the invariant a CONFIRMED finding must carry (buggy only; use serial-equivalence for a bug only the generic oracle can see)",
  "fix": "free text, safe only"
}
```

For `scope: out` items use `"message"` (a regex the tool output must match) or `"notice"` (text every confirmed finding must carry) instead. Definitions of hit, mismatch, miss and false positive are in `docs/METRICS.md`.

## Worked example

`_example-retried-job/`: a queue (BullMQ-style) re-delivers a job that looked stalled, so the handler runs twice concurrently and the welcome e-mail goes out twice. Plain `pg`; the e-mail is stubbed as a row. Run it with:

```
INTERLEAVE_DSN=postgres://... node packages/engine/dist/cli.js run corpus/heldout-human/_example-retried-job/scenario.mjs
```

## Rules

* Only the database is scheduled. Timers, HTTP, Redis and SMTP must be stubbed in `setup`; an actor that waits on anything else is reported as stalled.
* Use a local throwaway database created by `interleave-pg init-db`; the engine refuses anything else.
* Do not change the engine in response to a held-out result. A failure is reported as a miss.
