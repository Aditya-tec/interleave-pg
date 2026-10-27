# Limitations (kept up to date as discovered)

- Not a proof of correctness: results only cover the explored schedules.
- Local throwaway Postgres only (host must be loopback/unix socket, DB name `raceproof_*`, marker table present).
- Phase 1 supports forced schedules only; no exploration yet.
- Out of scope in v1: Prisma, `pg-native`, MySQL/SQLite/Mongo, multi-process apps, Redis locks, external side effects, parallel statements inside one actor, LISTEN/NOTIFY.
- `.ts` scenarios need Node >= 22.18 (native type stripping); use `.mjs` otherwise.
