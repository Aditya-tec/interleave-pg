import { inTxn, makePool } from '../../_lib/lib.mjs';

// Transfer between two wallets: lock the sender row, then the receiver row, then move the money.
export default {
  name: 'wallet transfer (locks sender then receiver)',
  tables: ['wallets'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query("INSERT INTO wallets VALUES ('alice', 1000), ('bob', 1000)"); },
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn);
    return (from, to, cents) =>
      inTxn(pool, async (c) => {
        const a = await c.query('SELECT cents FROM wallets WHERE owner = $1 FOR UPDATE', [from]);
        await c.query('SELECT cents FROM wallets WHERE owner = $1 FOR UPDATE', [to]);
        if (a.rows[0].cents < cents) return 'insufficient funds';
        await c.query('UPDATE wallets SET cents = cents - $2 WHERE owner = $1', [from, cents]);
        await c.query('UPDATE wallets SET cents = cents + $2 WHERE owner = $1', [to, cents]);
        return 'sent';
      });
  },
  actors: { A: (send) => send('alice', 'bob', 100), B: (send) => send('bob', 'alice', 100) },
  invariants: [
    { name: 'no actor aborted by a deadlock', js: ({ results }) => ({ ok: !results.some((r) => r.error?.code === '40P01') }) },
    { name: 'money is conserved', sql: 'SELECT sum(cents) = 2000 AS ok FROM wallets' },
  ],
};
