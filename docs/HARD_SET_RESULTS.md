# Hard set (Phase 3b): an adversarial dev set

**Label: adversarial dev set.** It is neither held-out nor independent of an agent. It was written to find what the engine gets wrong, from the documentation only. The earlier held-out sets (`corpus/heldout`, `corpus/heldout-human`) are public and count as development data from now on (HELDOUT.md); any future headline claim needs a new held-out set.

## Authoring, honestly

* **Who wrote it.** A fresh subagent in its own context, given a prompt that allowed it to read only `corpus/heldout-human/README.md` (with `_template/` and `_example-retried-job/`), `corpus/hard/README.md`, anything under `docs/`, the three tiny helper modules in `corpus/_lib/`, and the public API docs of pg, knex and drizzle-orm. It was forbidden from reading `packages/engine/{src,test,dist,scripts}`, `eval/`, `corpus/dev`, `corpus/heldout`, and any other human scenario, and from running any exploration, `run`, replay or metrics. The only engine-related command it was allowed to run was the serial single-user check (`corpus-unit.test.ts -t "hard/"`).
* **What I could not enforce.** The subagent had the same file tools as I do, so the prohibition rests on its own report, not on a sandbox. Its report lists every file it read and states it touched none of the prohibited paths. Two things it disclosed that are worth knowing: a `corpus/_lib/*.mjs` glob also printed the first ~2 KB of `corpus/_lib/families.mjs` (the dev corpus's code; it says it did not use it), and `docs/DECISIONS.md`, `docs/LIMITATIONS.md` and `docs/phase-1/2-report.md` excerpts told it some of the tool's documented wording and behaviour (allowed: they are documentation).
* **Not independent at the orchestration level.** I (the agent that wrote the engine) wrote `corpus/hard/README.md` and the harness changes below. I did not read or alter the scenarios' logic, but I read their `expected.json` files before the run to check they were complete.
* **Harness changes made after the scenarios were written and before the first run** (all in `eval/engine-metrics.ts`, tested in `metrics.test.ts`): `judgeLimit` judges the honest-limit fields `message`, `notice`, `warning`, `stoppedBy`; the report shows the author's derived minimal preemption count next to the observed one; and, after reading the authored `limit-state-explosion/expected.json` (which uses `message` for the wording "exhaustive within bound: no", which is printed report text, not an error), `message` may also match the printed report text when the run ends without an error. The scenario files and every `expected.json` are unchanged by me.
* **Serial sanity check** (the only run on these files before the freeze): 28 of 28 in-scope scenarios passed (A then B and B then A, every invariant holding); the 4 honest-limit scenarios are skipped by that check.

## The set

32 scenarios: 14 buggy and 14 safe in scope, plus 4 honest limits (`scope: out`). Each directory has `scenario.mjs` (starting with a comment that derives the minimal preemption count or the safety argument), `schema.sql` and `expected.json`. Tree hash of `corpus/hard/` (scenario directories plus the three helper modules; 99 files), `node eval/hash-heldout.mjs --set hard`:

`e22311635d40c8716df7c1a27cc0f985e295e88be6cc0157fcba0040b8a6d21b`

Committed and pushed before the first engine run (commit id recorded below, after the freeze).
