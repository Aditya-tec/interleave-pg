/*
 * MINIMAL PREEMPTIONS: 1.   (webhook delivered twice, handler in a transaction)
 *
 * handle(evt): BEGIN; SELECT 1 FROM wh1_events (seen?); if seen return 'duplicate'; INSERT the ledger credit (the
 * effect); INSERT wh1_events ... ON CONFLICT DO NOTHING (the dedupe record, written AFTER the effect); COMMIT.
 * The ON CONFLICT hides the clash, so the second delivery silently credits again.
 * Serial: first 'processed', second 'duplicate'. Violation: A.BEGIN, A.SELECT (not seen) | (preempt A) B runs
 * completely (credits, records) | (B done, free) A.INSERT ledger (second credit), A.INSERT events (conflict, ignored),
 * A.COMMIT. Min 1 (0 is serial).
 */
import { inTxn, makePool } from '../../_lib/lib.mjs';

export default {
  name: 'webhook: effect before the dedupe record',
  tables: ['wh1_events', 'wh1_ledger'],
  schema: 'schema.sql',
  seed: async () => {},
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return (eventId) =>
      inTxn(pool, async (c) => {
        const seen = await c.query('SELECT 1 FROM wh1_events WHERE event_id = $1', [eventId]);
        if (seen.rows.length > 0) return 'duplicate';
        await c.query('INSERT INTO wh1_ledger (event_id, amount) VALUES ($1, 50)', [eventId]);
        await c.query('INSERT INTO wh1_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [eventId]);
        return 'processed';
      });
  },
  actors: { A: (handle) => handle('evt_100'), B: (handle) => handle('evt_100') },
  invariants: [{ name: 'the payment is credited once', sql: "SELECT count(*) <= 1 AS ok FROM wh1_ledger WHERE event_id = 'evt_100'" }],
};
