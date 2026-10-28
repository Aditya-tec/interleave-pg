import { defineScenario } from 'interleave-pg';
export default defineScenario({
  name: 'webhook credit before dedupe',
  tables: ['accounts', 'webhook_events'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO accounts (id, credits) VALUES (1, 0)'); },
  setup: async ({ dsn }) => { process.env.DATABASE_URL = dsn; const app = await import('./app.mjs'); return { app }; },
  actors: {
    A: ({ app }) => app.handleWebhook('evt_1', 1, 10),
    B: ({ app }) => app.handleWebhook('evt_1', 1, 10),
  },
  invariants: [
    { name: 'a webhook event credits the account exactly once', sql: 'SELECT credits = 10 AS ok FROM accounts WHERE id = 1' },
  ],
  options: { maxPreemptions: 3, serialOracle: true },
});
