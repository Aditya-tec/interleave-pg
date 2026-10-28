import { makePool } from '../../_lib/lib.mjs';

// Three people book the same room for overlapping hours: look for an overlap, then insert.
export default {
  name: 'meeting room booking, three actors',
  tables: ['reservations'],
  schema: 'schema.sql',
  setup: async ({ dsn }) => {
    const pool = await makePool(dsn, 3);
    return async (who, starts, ends) => {
      const clash = await pool.query('SELECT count(*)::int AS n FROM reservations WHERE room_id = 4 AND starts < $2 AND ends > $1', [starts, ends]);
      if (clash.rows[0].n > 0) return 'room busy';
      await pool.query('INSERT INTO reservations (room_id, starts, ends, who) VALUES (4, $1, $2, $3)', [starts, ends, who]);
      return 'booked';
    };
  },
  actors: { A: (book) => book('ann', 9, 11), B: (book) => book('bob', 10, 12), C: (book) => book('cy', 10, 11) },
  invariants: [
    {
      name: 'no two reservations overlap',
      sql: 'SELECT NOT EXISTS (SELECT 1 FROM reservations a JOIN reservations b ON a.room_id = b.room_id AND a.id < b.id AND a.starts < b.ends AND a.ends > b.starts) AS ok',
    },
  ],
};
