/*
 * SAFE: the capacity check and the increment are one atomic UPDATE.
 *
 * book(who) in db.transaction: UPDATE slots SET taken = taken + 1 WHERE id = 1 AND taken < capacity RETURNING id; if no
 * row came back return 'full', else INSERT the booking. Capacity 1. The UPDATE takes the row lock, so a second UPDATE
 * blocks until the first transaction commits and then re-checks `taken < capacity` on the new row version (READ
 * COMMITTED re-evaluation) and matches nothing. Every interleaving equals a serial order: one 'booked', one 'full'.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { makeDrizzle } from '../../_lib/lib-drizzle.mjs';

const slots = pgTable('dz2_slots', {
  id: integer('id').primaryKey(),
  capacity: integer('capacity').notNull(),
  taken: integer('taken').notNull(),
});
const bookings = pgTable('dz2_bookings', {
  id: serial('id').primaryKey(),
  slotId: integer('slot_id').notNull(),
  who: text('who').notNull(),
});

export default {
  name: 'drizzle transaction: atomic conditional UPDATE reserves the slot',
  tables: ['dz2_slots', 'dz2_bookings'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO dz2_slots (id, capacity, taken) VALUES (1, 1, 0)');
  },
  setup: async ({ dsn }) => {
    const { db } = await makeDrizzle(dsn);
    return (who) =>
      db.transaction(async (tx) => {
        const got = await tx
          .update(slots)
          .set({ taken: sql`${slots.taken} + 1` })
          .where(and(eq(slots.id, 1), lt(slots.taken, slots.capacity)))
          .returning({ id: slots.id });
        if (got.length === 0) return 'full';
        await tx.insert(bookings).values({ slotId: 1, who });
        return 'booked';
      });
  },
  actors: { A: (book) => book('ann'), B: (book) => book('bob') },
  invariants: [
    {
      name: 'bookings never exceed capacity',
      sql: 'SELECT (SELECT count(*) FROM dz2_bookings WHERE slot_id = 1) <= (SELECT capacity FROM dz2_slots WHERE id = 1) AS ok',
    },
    {
      name: 'taken matches the bookings',
      sql: 'SELECT (SELECT taken FROM dz2_slots WHERE id = 1) = (SELECT count(*) FROM dz2_bookings WHERE slot_id = 1) AS ok',
    },
  ],
};
