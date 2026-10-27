import { makePool, inTxn } from './lib.mjs';

/** A moves 1 -> 2 and B moves 2 -> 1. Unsafe: each locks its source first. Safe: always lock the lower id first. */
export function build({ safe = false } = {}) {
  return {
    name: safe ? 'transfer (consistent lock order)' : 'transfer (opposite lock order)',
    tables: ['accounts'],
    schema: 'sql/accounts.sql',
    seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100), (2, 100)'); },
    setup: async ({ dsn }) => {
      const pool = await makePool(dsn);
      return (from, to) =>
        inTxn(pool, async (c) => {
          const [first, second] = safe ? [Math.min(from, to), Math.max(from, to)] : [from, to];
          await c.query('UPDATE accounts SET balance = balance + $2 WHERE id = $1', [first, first === from ? -1 : 1]);
          await c.query('UPDATE accounts SET balance = balance + $2 WHERE id = $1', [second, second === from ? -1 : 1]);
        });
    },
    actors: { A: (transfer) => transfer(1, 2), B: (transfer) => transfer(2, 1) },
    invariants: [
      { name: 'no actor aborted by a deadlock', js: ({ results }) => ({ ok: !results.some((r) => r.error?.code === '40P01') }) },
      { name: 'money conserved', sql: 'SELECT sum(balance) = 200 AS ok FROM accounts' },
    ],
  };
}
export default build();
