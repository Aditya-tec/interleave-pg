import { eq } from 'drizzle-orm';
import { pgTable, serial, text } from 'drizzle-orm/pg-core';
import { makeDrizzle } from '../../_lib/lib-drizzle.mjs';

const accounts = pgTable('accounts', { id: serial('id').primaryKey(), username: text('username').notNull().unique() });

// Pre-check for a friendly message, INSERT, and a UNIQUE constraint as the backstop whose violation is handled.
export default {
  name: 'username claim (UNIQUE constraint, violation handled)',
  tables: ['accounts'],
  schema: 'schema.sql',
  setup: async ({ dsn }) => {
    const { db } = await makeDrizzle(dsn);
    return async (name) => {
      const taken = await db.select().from(accounts).where(eq(accounts.username, name));
      if (taken.length > 0) return 'taken';
      try {
        await db.insert(accounts).values({ username: name });
        return 'claimed';
      } catch (e) {
        if (e.code === '23505' || e.cause?.code === '23505') return 'taken';
        throw e;
      }
    };
  },
  actors: { A: (claim) => claim('river'), B: (claim) => claim('river') },
  invariants: [{ name: 'usernames are unique', sql: 'SELECT NOT EXISTS (SELECT 1 FROM accounts GROUP BY username HAVING count(*) > 1) AS ok' }],
};
