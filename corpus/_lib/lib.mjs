import pg from 'pg';

/** Pool with `warm` idle clients so no connection is opened inside an actor. */
export async function makePool(dsn, warm = 2) {
  const pool = new pg.Pool({ connectionString: dsn, max: 4 });
  await Promise.all(Array.from({ length: warm }, () => pool.query('SELECT pg_sleep(0.05)')));
  return pool;
}

/** BEGIN ... COMMIT on one checked-out client; ROLLBACK on error. `isolation` is an optional SQL isolation level. */
export async function inTxn(pool, fn, isolation) {
  const c = await pool.connect();
  try {
    await c.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : 'BEGIN');
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

/** Retry wrapper: re-run the transaction when the database aborts it with 40001 (serialization failure). */
export async function retrySerializable(pool, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await inTxn(pool, fn, 'SERIALIZABLE');
    } catch (e) {
      if (e.code !== '40001' || i >= attempts) throw e;
    }
  }
}
