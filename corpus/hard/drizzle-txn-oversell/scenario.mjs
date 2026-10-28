/*
 * MINIMAL PREEMPTIONS: 1.   (Drizzle db.transaction, check-then-insert on a capacity)
 *
 * book(who) in db.transaction: read the slot capacity, count the bookings, insert one if count < capacity.
 * Statements per actor: begin, select slot, select count, insert, commit. Capacity is 1.
 * Serial: first books, second gets 'full'. Violation: A.begin, A.slot, A.count (0) | (preempt A, insert pending)
 * B runs completely (books) | (B done, free) A.insert, A.commit: two bookings for capacity 1.
 * 0 preemptions = serial = fine, so the minimum is 1.
 */
import { eq, sql } from 'drizzle-orm';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { makeDrizzle } from '../../_lib/lib-drizzle.mjs';

const slots = pgTable('dz1_slots', { id: integer('id').primaryKey(), capacity: integer('capacity').notNull() });
const bookings = pgTable('dz1_bookings', {
  id: serial('id').primaryKey(),
  slotId: integer('slot_id').notNull(),
  who: text('who').notNull(),
});

export default {
  name: 'drizzle transaction: book a slot with a capacity check',
  tables: ['dz1_slots', 'dz1_bookings'],
  schema: 'schema.sql',
  seed: async (db) => {
    await db.query('INSERT INTO dz1_slots (id, capacity) VALUES (1, 1)');
  },
  setup: async ({ dsn }) => {
    const { db } = await makeDrizzle(dsn);
    return (who) =>
      db.transaction(async (tx) => {
        const [slot] = await tx.select().from(slots).where(eq(slots.id, 1));
        const [{ n }] = await tx.select({ n: sql`count(*)::int` }).from(bookings).where(eq(bookings.slotId, 1));
        if (n >= slot.capacity) return 'full';
        await tx.insert(bookings).values({ slotId: 1, who });
        return 'booked';
      });
  },
  actors: { A: (book) => book('ann'), B: (book) => book('bob') },
  invariants: [
    {
      name: 'bookings never exceed capacity',
      sql: 'SELECT (SELECT count(*) FROM dz1_bookings WHERE slot_id = 1) <= (SELECT capacity FROM dz1_slots WHERE id = 1) AS ok',
    },
  ],
};
