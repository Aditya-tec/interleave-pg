/*
 * SAFE: the dedupe record is inserted FIRST and decides whether the effect runs.
 *
 * handle(evt): BEGIN; INSERT INTO wh2_events (event_id) ON CONFLICT DO NOTHING RETURNING event_id; if no row came back
 * return 'duplicate'; INSERT the ledger credit; COMMIT. If both deliveries overlap, the second INSERT waits for the
 * first transaction to finish (speculative insertion on the same key), then does nothing and returns 0 rows. Exactly one
 * credit, results {processed, duplicate}: identical to a serial order.
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'webhook: dedupe record first, then the effect',
  tables: ['wh2_events', 'wh2_ledger'],
  schema: 'schema.sql',
  seed: async () => {},
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return (eventId) =>
      inTxn(pool, async (c) => {
        const first = await c.query('INSERT INTO wh2_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [eventId]);
        if (first.rowCount === 0) return 'duplicate';
        await c.query('INSERT INTO wh2_ledger (event_id, amount) VALUES ($1, 50)', [eventId]);
        return 'processed';
      });
  },
  actors: { A: (handle) => handle('evt_200'), B: (handle) => handle('evt_200') },
  invariants: [{ name: 'the payment is credited once', sql: "SELECT count(*) = 1 AS ok FROM wh2_ledger WHERE event_id = 'evt_200'" }],
};
