/*
 * HONEST LIMIT (scope: out): a REAL race, but the statements carry random ids and Date.now() values.
 *
 * deposit(10): SELECT balance; INSERT an audit row whose id is a fresh random UUID and whose timestamp is Date.now();
 * UPDATE balance = read + 10. The lost update is real (derived minimum would be 1 preemption: A.SELECT | B full |
 * A rest), but every execution sends different parameters, so a saved schedule re-run in replay produces a different
 * statement fingerprint. Exploration is stateless replay (LIMITATIONS, Phase 2): the tool must print the
 * "nondeterministic scenario" warning (spec 4.7), and may not be able to confirm the finding (3 of 3 replays) or may
 * report it as unconfirmed. The serial oracle also sees different audit ids in every run, so nothing is "serial".
 * Expected: the nondeterminism warning on the run or on a finding; it must not be a silently clean report.
 */
import { randomUUID } from 'node:crypto';
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'lost update with random ids and timestamps in the statements',
  tables: ['lim3_wallet', 'lim3_audit'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO lim3_wallet (id, balance) VALUES (1, 100)');
  },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async () => {
      const r = await pool.query('SELECT balance FROM lim3_wallet WHERE id = 1');
      await pool.query('INSERT INTO lim3_audit (id, at_ms, note) VALUES ($1, $2, $3)', [randomUUID(), Date.now(), 'deposit']);
      await pool.query('UPDATE lim3_wallet SET balance = $1 WHERE id = 1', [r.rows[0].balance + 10]);
      return 'deposited';
    };
  },
  actors: { A: (deposit) => deposit(), B: (deposit) => deposit() },
  invariants: [{ name: 'both deposits counted', sql: 'SELECT balance = 120 AS ok FROM lim3_wallet WHERE id = 1' }],
};
