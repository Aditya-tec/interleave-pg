import pg from 'pg';

/** Pool with `warm` idle clients so no connection is opened inside an actor. */
export async function makePool(dsn, warm = 2) {
  const pool = new pg.Pool({ connectionString: dsn, max: 4 });
  await Promise.all(Array.from({ length: warm }, () => pool.query('SELECT pg_sleep(0.05)')));
  return pool;
}

/** BEGIN ... COMMIT on one checked-out client; ROLLBACK on error. */
export async function inTxn(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
