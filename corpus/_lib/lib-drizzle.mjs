import { drizzle } from 'drizzle-orm/node-postgres';
import { makePool } from './lib.mjs';

export async function makeDrizzle(dsn) {
  const pool = await makePool(dsn);
  return { pool, db: drizzle(pool) };
}
