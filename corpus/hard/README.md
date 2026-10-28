# corpus/hard: the adversarial dev set (Phase 3b)

**Label:** adversarial dev set. It is **not** held-out and **not** independent of an agent: it was written by an AI agent working from the documentation only, on purpose to find what the engine gets wrong. The earlier held-out sets (`corpus/heldout`, `corpus/heldout-human`) are public and count as development data from this point on.

Format: exactly the one in `corpus/heldout-human/README.md` (a directory per scenario with `scenario.mjs`, `schema.sql`, `expected.json`; names must not start with `_` or `.`), plus the following rules and fields.

## Rules

* Each `expected.json` is written **before** any engine run and is never edited afterwards. Each `scenario.mjs` starts with a comment that states, with reasoning, the **minimal number of preemptions** a bug needs (a preemption is a switch away from an actor that is still runnable; switches forced by an actor finishing or being blocked are free), or why a safe scenario cannot go wrong. The same number goes into `expected.json` as `minPreemptions`.
* The metrics script reports the derived and the observed preemption count side by side. It is not a gate.
* The set is committed, with its tree hash recorded, before the first engine run.

## `expected.json` fields

```
id, expect ("buggy" | "safe" | "unsupported"), scope ("in" | "out"), class, driver, minPreemptions, notes
buggy:  invariant   exact name of the invariant a CONFIRMED finding must carry ("serial-equivalence" if only the generic oracle can see it)
safe:   fix         free text
scope "out" (honest limits): at least one of
        message     regex the tool's error text must match (or, when the run ends normally, its printed report text)
        notice      text every CONFIRMED finding must carry
        warning     regex that must match a warning (run level, or on any finding)
        stoppedBy   "schedule-budget" | "time-budget" | [both]: the search must have stopped for that reason and must not claim to be exhaustive
```

Definitions of hit, mismatch, miss and false positive: `docs/METRICS.md`.
