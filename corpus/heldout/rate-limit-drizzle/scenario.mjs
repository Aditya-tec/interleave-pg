import { eq, sql } from 'drizzle-orm';
import { integer, pgTable, serial } from 'drizzle-orm/pg-core';
import { makeDrizzle } from '../../_lib/lib-drizzle.mjs';

const quota = pgTable('quota', { userId: integer('user_id').primaryKey(), used: integer('used').notNull(), maxRequests: integer('max_requests').notNull() });
const allowed = pgTable('allowed', { id: serial('id').primaryKey(), userId: integer('user_id').notNull() });

// A per-user request quota: read the counter, allow if below the limit, bump the counter, log the request.
export default {
  name: 'rate limiter (read counter, allow, bump)',
  tables: ['allowed', 'quota'],
  schema: 'schema.sql',
  seed: async (db) => { await db.query('INSERT INTO quota VALUES (7, 0, 1)'); },
  setup: async ({ dsn }) => {
    const { db } = await makeDrizzle(dsn);
    return async () => {
      const [q] = await db.select().from(quota).where(eq(quota.userId, 7));
      if (q.used >= q.maxRequests) return 'rate limited';
      await db.update(quota).set({ used: sql`${quota.used} + 1` }).where(eq(quota.userId, 7));
      await db.insert(allowed).values({ userId: 7 });
      return 'allowed';
    };
  },
  actors: { A: (request) => request(), B: (request) => request() },
  invariants: [{ name: 'allowed requests never exceed the quota', sql: 'SELECT (SELECT count(*) FROM allowed) <= (SELECT max_requests FROM quota WHERE user_id = 7) AS ok' }],
};
