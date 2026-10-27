import pg from 'pg';
import knexFactory from 'knex';

const SELECT = 'SELECT balance FROM accounts WHERE id = 1';
const UPDATE = 'UPDATE accounts SET balance = $1 WHERE id = 1';
const q = (client, sql, values) =>
  new Promise((resolve, reject) => client.query(sql, values, (err, res) => (err ? reject(err) : resolve(res))));

/** style: pool | client (pool.connect + BEGIN/COMMIT) | callback (dedicated clients, callback API) | knex */
export function makeScenario(style) {
  return {
    name: `lost update (${style})`,
    tables: ['accounts'],
    schema: 'sql/accounts.sql',
    seed: async (db) => { await db.query('INSERT INTO accounts VALUES (1, 100)'); },
    setup: async ({ dsn }) => {
      if (style === 'pool') {
        const pool = new pg.Pool({ connectionString: dsn, max: 4 });
        await pool.query('SELECT 1');
        const deposit = async (n) => {
          const r = await pool.query(SELECT);
          await pool.query(UPDATE, [r.rows[0].balance + n]);
        };
        return { A: () => deposit(10), B: () => deposit(10) };
      }
      if (style === 'client') {
        const pool = new pg.Pool({ connectionString: dsn, max: 4 });
        await pool.query('SELECT 1');
        const deposit = async (n) => {
          const c = await pool.connect();
          try {
            await c.query('BEGIN');
            const r = await c.query(SELECT);
            await c.query(UPDATE, [r.rows[0].balance + n]);
            await c.query('COMMIT');
          } catch (e) {
            await c.query('ROLLBACK').catch(() => {});
            throw e;
          } finally {
            c.release();
          }
        };
        return { A: () => deposit(10), B: () => deposit(10) };
      }
      if (style === 'callback') {
        const mk = async () => { const c = new pg.Client({ connectionString: dsn }); await c.connect(); return c; };
        const ca = await mk();
        const cb = await mk();
        const deposit = (c) => async (n) => {
          const r = await q(c, SELECT);
          await q(c, UPDATE, [r.rows[0].balance + n]);
        };
        return { A: () => deposit(ca)(10), B: () => deposit(cb)(10) };
      }
      if (style === 'knex') {
        const knex = knexFactory({ client: 'pg', connection: dsn, pool: { min: 0, max: 4 } });
        await knex.raw('select 1');
        const deposit = async (n) => {
          const row = await knex('accounts').where({ id: 1 }).first('balance');
          await knex('accounts').where({ id: 1 }).update({ balance: row.balance + n });
        };
        return { A: () => deposit(10), B: () => deposit(10) };
      }
      throw new Error('unknown style ' + style);
    },
    actors: { A: (ctx) => ctx.A(), B: (ctx) => ctx.B() },
    invariants: [{ name: 'both deposits applied', sql: 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1' }],
  };
}
