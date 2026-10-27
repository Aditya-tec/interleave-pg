# Competitors and prior art (checked 2026-10-27)

Searches run: GitHub repo search for "raceproof" and "postgres race condition interleaving"; npm lookups for `raceproof`, `isolab`, `crashlab`; a web search for "interleaving postgres race condition detector node.js deterministic transaction scheduling tool". This is a 15-30 minute check, not exhaustive. Re-run at Gate G1.

## Name collisions (important)
- npm: `raceproof` is **free** (404 on the registry). `isolab` is free on npm.
- GitHub: several unrelated repos already use the name "RaceProof":
  - `Paramount50/RaceProof` (created 2026-10-24, Python): "reproduces, diagnoses, and repairs PostgreSQL concurrency bugs using LangGraph, deterministic transaction scheduling, and automated patch verification". Python apps, LLM agents, per-target adapters with hand-declared checkpoints. Closest in spirit; different stack and approach.
  - `hasnainkhatri87/raceproof` (TypeScript, MIT, 2026-07): bounded exploration of a **model** (JSON state + transitions you describe), not your real code or a real database.
  - `ulrichheringer/raceproof` (Python async), `Anupam0202/raceproof` (JVM), `zerodycoder/RaceProof` (Laravel/PHP).

## Related tools
- **isolab** (PyPI): PostgreSQL isolation-anomaly lab; forces specific interleavings against a real server and checks a business invariant. Python, hand-specified interleavings. Source: pypi.org/project/isolab (seen in search results only; not reviewed in depth).
- **CrashLab** (npm `crashlab` 1.0.0): deterministic simulation testing for Node.js with virtual time and seeded I/O ordering. Simulates I/O; does not drive a real Postgres through its statement interleavings (based on its README intro only).
- Blog-style advice (e.g. Doppler "reliably testing race conditions"): patterns, not tools.
- Not checked in this pass: FetchSandbox, advice-only concurrency skills.

## How raceproof differs (intended)
raceproof runs the app's **real** Node handlers against a **real** local Postgres and gates every statement, so it explores actual statement interleavings (smallest number of context switches first), checks invariants plus a serial-equivalence oracle, replays failures to confirm, and re-runs the same schedules to prove a fix. It targets Node + `pg` (raw, knex, Drizzle-on-pg). The model-checkers above explore abstract models; the Python projects do not cover Node.

## Risk note for the kill criteria
The risk register says to stop or differentiate if a good tool already discovers interleavings in user code and proves fixes. `Paramount50/RaceProof` partially overlaps (Postgres, deterministic scheduling, patch verification) but is Python-only, 3 days old, 0 stars at check time, and needs per-app adapters. Not a kill trigger on this evidence; flagged for the human at G1. The name overlap is a branding problem independent of that.
