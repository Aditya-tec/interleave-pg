import { defineScenario } from 'interleave-pg';
export default defineScenario({
  name: 'retried job double send',
  tables: ['jobs', 'outbox'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO jobs (id, status) VALUES (7, 'pending')"); },
  setup: async ({ dsn }) => { process.env.DATABASE_URL = dsn; const app = await import('./app.mjs'); return { app }; },
  actors: {
    A: ({ app }) => app.runJob(7),
    B: ({ app }) => app.runJob(7),
  },
  invariants: [
    { name: 'a job is sent at most once', sql: 'SELECT count(*) <= 1 AS ok FROM outbox WHERE job_id = 7' },
  ],
  options: { maxPreemptions: 3, serialOracle: true },
});
