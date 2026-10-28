/*
 * SAFE: register-or-fetch inside a transaction, duplicate handled with SAVEPOINT / ROLLBACK TO.
 *
 * register(): BEGIN; SAVEPOINT reg; INSERT the user (unique email); on success RELEASE and return 'created'; on 23505
 * ROLLBACK TO SAVEPOINT reg, SELECT the existing row and return 'existing'; COMMIT. A concurrent second INSERT blocks on
 * the first, uncommitted insert (free switch) and, once the first commits, fails with 23505, which the code handles;
 * the transaction survives because of the savepoint. Results {created, existing} and one row in every schedule, as in
 * either serial order. The failing INSERT is an error statement inside a long transaction (ROLLBACK TO must be
 * handled by the transaction tracking).
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'register user: unique violation handled with a savepoint',
  tables: ['spd_users'],
  schema: 'schema.sql',
  seed: async () => {},
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return () =>
      inTxn(pool, async (c) => {
        await c.query('SAVEPOINT reg');
        try {
          await c.query("INSERT INTO spd_users (email) VALUES ('ann@example.com')");
          await c.query('RELEASE SAVEPOINT reg');
          return 'created';
        } catch (e) {
          if (e.code !== '23505') throw e;
          await c.query('ROLLBACK TO SAVEPOINT reg');
          const r = await c.query("SELECT id FROM spd_users WHERE email = 'ann@example.com'");
          return r.rows.length === 1 ? 'existing' : 'missing';
        }
      });
  },
  actors: { A: (register) => register(), B: (register) => register() },
  invariants: [{ name: 'exactly one user row', sql: "SELECT count(*) = 1 AS ok FROM spd_users WHERE email = 'ann@example.com'" }],
};
