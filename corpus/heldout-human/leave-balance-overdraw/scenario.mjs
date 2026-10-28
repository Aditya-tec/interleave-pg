import { defineScenario } from 'interleave-pg';
export default defineScenario({
  name: 'leave balance overdraw',
  tables: ['leave_balances', 'leave_requests'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO leave_balances (employee_id, days_left) VALUES (1, 5)'); },
  setup: async ({ dsn }) => { process.env.DATABASE_URL = dsn; const app = await import('./app.mjs'); return { app }; },
  actors: {
    A: ({ app }) => app.requestLeave(1, 3),
    B: ({ app }) => app.requestLeave(1, 3),
  },
  invariants: [
    { name: 'approved leave never exceeds the balance',
      sql: 'SELECT coalesce(sum(days),0) <= 5 AS ok FROM leave_requests WHERE employee_id = 1' },
    { name: 'balance plus approved leave equals the starting balance',
      sql: 'SELECT (SELECT days_left FROM leave_balances WHERE employee_id = 1) + (SELECT coalesce(sum(days),0) FROM leave_requests WHERE employee_id = 1) = 5 AS ok' },
  ],
  options: { maxPreemptions: 3, serialOracle: true },
});
