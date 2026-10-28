/*
 * MINIMAL PREEMPTIONS: 1.   (session-level advisory lock released one statement too early)
 *
 * deposit(10): pg_advisory_lock(7001); SELECT balance; pg_advisory_unlock(7001); UPDATE balance = read + 10.
 * The unlock sits before the write, so the lock protects only the read. All on one checked-out client, autocommit.
 * Violation: A.lock, A.select, A.unlock | (preempt A, UPDATE pending) B lock, select, unlock, update (110) |
 * (B done, free) A.update writes 110. Lost update. If B asks for the lock while A holds it, B blocks (free switch),
 * which is why the preemption must happen after A's unlock. 0 is serial, so the minimum is 1.
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'advisory lock released before the write',
  tables: ['adv1_accounts'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO adv1_accounts (id, balance) VALUES (1, 100)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async () => {
      const c = await pool.connect();
      try {
        await c.query('SELECT pg_advisory_lock(7001)');
        const r = await c.query('SELECT balance FROM adv1_accounts WHERE id = 1');
        const next = r.rows[0].balance + 10;
        await c.query('SELECT pg_advisory_unlock(7001)'); // released too early
        await c.query('UPDATE adv1_accounts SET balance = $1 WHERE id = 1', [next]);
        return 'deposited';
      } finally {
        c.release();
      }
    };
  },
  actors: { A: (deposit) => deposit(), B: (deposit) => deposit() },
  invariants: [{ name: 'both deposits counted', sql: 'SELECT balance = 120 AS ok FROM adv1_accounts WHERE id = 1' }],
};
