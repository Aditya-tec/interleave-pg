# Competitors and prior art (checked 2026-10-27)

Searches run: GitHub repo search for "raceproof" and "postgres race condition interleaving"; npm lookups for `raceproof`, `isolab`, `crashlab`; a web search for "interleaving postgres race condition detector node.js deterministic transaction scheduling tool". This is a 15-30 minute check, not exhaustive. Re-run at Gate G1.

## Name collisions (this is why the working name `raceproof` was dropped; the project is now `interleave-pg`)
- npm: the old working name `raceproof` was free (404 on the registry). `isolab` is free on npm. `interleave-pg` (the chosen name) is free on npm and has no GitHub repo with that name (checked 2026-10-27).
- GitHub: several unrelated repos already use the old name "RaceProof" (third-party projects, listed here under their real names):
  - `Paramount50/RaceProof` (created 2026-10-24, Python): "reproduces, diagnoses, and repairs PostgreSQL concurrency bugs using LangGraph, deterministic transaction scheduling, and automated patch verification". Python apps, LLM agents, per-target adapters with hand-declared checkpoints. Closest in spirit; different stack and approach.
  - `hasnainkhatri87/raceproof` (TypeScript, MIT, 2026-07): bounded exploration of a **model** (JSON state + transitions you describe), not your real code or a real database.
  - `ulrichheringer/raceproof` (Python async), `Anupam0202/raceproof` (JVM), `zerodycoder/RaceProof` (Laravel/PHP).

## Added at Gate G1 (re-checked 2026-10-27)
- **zerodycoder/RaceProof** (Laravel/PHP, MIT, created 2026-07-25, 0 stars, last push 2026-10-24; v1.0.0-beta.1 with signed releases and checksums): starts real application **processes**, pauses them at explicit `race_point()` checkpoints that you add to application code, releases them as one cohort, then asserts on responses and database state. MySQL and PostgreSQL. Ships a broken/fixed oversell pair (broken ends at stock -2; the atomic fix ends at 0 with two 409s; its README reports the pair running 100/100 times, which I did not reproduce), a `doctor` command and fail-closed safety checks. It stages one chosen race on cue; it does not explore many orderings on its own.
- **mavilinklabs** audit tooling (`il-scan`, `cpython-concurrency-audit`; Python, MIT): a read-only **static** analyser for concurrency, idempotency and retry-safety hazards. Emits candidates, not verdicts, and does not execute the code. Targets Python.
- **Paramount50/RaceProof**, re-checked: unchanged since the first check (created 2026-10-24, last push the same day, 0 stars, no licence file). Python-only; two LLM agents (investigation, repair) plus a contract and adapter per target app with hand-declared checkpoints, invariants and verification schedules; its best outcome is `VERIFIED_CANDIDATE` after finite experiments, which it says is not a proof. Overlaps in goal (Postgres race, deterministic scheduling, patch verification), not in stack or method.

## Related tools
- **isolab** (PyPI): PostgreSQL isolation-anomaly lab; forces specific interleavings against a real server and checks a business invariant. Python, hand-specified interleavings. Source: pypi.org/project/isolab (seen in search results only; not reviewed in depth).
- **CrashLab** (npm `crashlab` 1.0.0): deterministic simulation testing for Node.js with virtual time and seeded I/O ordering. Simulates I/O; does not drive a real Postgres through its statement interleavings (based on its README intro only).
- Blog-style advice (e.g. Doppler "reliably testing race conditions"): patterns, not tools.
- Not checked in this pass: FetchSandbox, advice-only concurrency skills.

## Risk note for the kill criteria
The risk register says to stop or differentiate if a good tool already discovers interleavings in user code and proves fixes. `Paramount50/RaceProof` partially overlaps (Postgres, deterministic scheduling, patch verification) but is Python-only, 3 days old, 0 stars at check time, and needs per-app adapters. Not a kill trigger on this evidence; flagged for the human at G1. The name overlap was a branding problem independent of that; it is resolved by the rename to `interleave-pg`.

## How we differ
We target Node.js with the `pg` driver (raw, knex, Drizzle on pg) and ask developers to add no checkpoints and write no adapter: an in-process gate on `pg.Client.query` makes every real statement of the unmodified handlers a scheduling point, so we can explore many statement orderings (fewest context switches first) instead of staging one race, check invariants and a serial-equivalence oracle, replay a failure to confirm it, and then have a Claude Code skill patch the code and re-run the same orderings to prove the fix. The neighbours above need explicit checkpoints (zerodycoder, Laravel), a per-app Python contract plus LLM agents (Paramount50), an abstract model of the system (hasnainkhatri87), or only read the source (mavilinklabs). Be careful with this claim: Phase 1 demonstrates forced schedules only; many-ordering exploration (Phase 2) and the skill that proves fixes (Phase 5) are not built yet.
