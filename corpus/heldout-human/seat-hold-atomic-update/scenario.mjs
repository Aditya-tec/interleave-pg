import { defineScenario } from 'interleave-pg';
export default defineScenario({
  name: 'seat hold atomic update',
  tables: ['seats'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO seats (id, holder) VALUES (12, NULL)'); },
  setup: async ({ dsn }) => { process.env.DATABASE_URL = dsn; const app = await import('./app.mjs'); return { app }; },
  actors: {
    A: ({ app }) => app.bookSeat(12, 'asha'),
    B: ({ app }) => app.bookSeat(12, 'ravi'),
  },
  invariants: [
    { name: 'the seat has exactly one holder', sql: 'SELECT holder IS NOT NULL AS ok FROM seats WHERE id = 12' },
    { name: 'exactly one booking succeeds',
      js: ({ results }) => ({ ok: results.filter((r) => r.status === 'fulfilled' && r.value.booked).length === 1 }) },
  ],
  options: { maxPreemptions: 3, serialOracle: true },
});
