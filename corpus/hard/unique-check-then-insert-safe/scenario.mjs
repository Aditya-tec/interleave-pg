/*
 * SAFE (database-enforced): the code is racy, a UNIQUE constraint is the backstop.
 *
 * book(who): SELECT whether seat 7 is booked; if not, INSERT it (autocommit). Both can pass the SELECT, but the second
 * INSERT fails with SQLSTATE 23505 (unique_violation, constraint seat6_one_booking) and the actor rejects with that
 * error: the user would see an error, not a double booking. Invariant (one booking per seat) always holds.
 * Per DECISIONS (2026-10-28, Phase 3 answer 1) 23505 is a database rejection: the rejected actor is left out of the
 * serial comparison and an informational note is printed, so the tool SHOULD report this as clean (with a note).
 * If it reports an ANOMALY, that is the documented weak spot turned into a false positive.
 */
import { makePool } from '../../_lib/lib.mjs';

export default {
  name: 'seat booking: check-then-insert backed by UNIQUE',
  tables: ['seat6_bookings'],
  schema: 'schema.sql',
  seed: async () => {},
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 2);
    return async (who) => {
      const r = await pool.query('SELECT 1 FROM seat6_bookings WHERE seat = 7');
      if (r.rows.length > 0) return 'taken';
      await pool.query('INSERT INTO seat6_bookings (seat, who) VALUES (7, $1)', [who]);
      return 'booked';
    };
  },
  actors: { A: (book) => book('ann'), B: (book) => book('bob') },
  invariants: [{ name: 'one booking per seat', sql: 'SELECT count(*) <= 1 AS ok FROM seat6_bookings WHERE seat = 7' }],
};
