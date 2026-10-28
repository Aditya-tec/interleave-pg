import { defineScenario } from 'interleave-pg';
export default defineScenario({
  name: 'wallet optimistic version',
  tables: ['wallets'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO wallets (id, balance, version) VALUES (1, 100, 0)'); },
  setup: async ({ dsn }) => { process.env.DATABASE_URL = dsn; const app = await import('./app.mjs'); return { app }; },
  actors: {
    A: ({ app }) => app.debit(1, 60),
    B: ({ app }) => app.debit(1, 60),
  },
  invariants: [
    { name: 'balance never negative', sql: 'SELECT balance >= 0 AS ok FROM wallets WHERE id = 1' },
    { name: 'money is conserved',
      js: async ({ results, db }) => {
        const { rows } = await db.query('SELECT balance FROM wallets WHERE id = 1');
        const debited = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length * 60;
        return { ok: rows[0].balance + debited === 100, detail: `balance ${rows[0].balance}, debited ${debited}` };
      } },
  ],
  options: { maxPreemptions: 3, serialOracle: true },
});
