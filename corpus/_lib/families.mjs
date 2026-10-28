// The code under test for the DEV corpus. Each variant is a small, realistic data-access routine in one of three
// styles (raw pg, knex, Drizzle on pg) with or without a fix. A scenario directory only names its variant:
//   export default build('lost-update-pg-rmw');
// Held-out scenarios (corpus/heldout) are written separately, in different domains, and do NOT use this file.
import { and, eq, gte, sql } from 'drizzle-orm';
import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { makeDrizzle } from './lib-drizzle.mjs';
import { makeKnex } from './lib-knex.mjs';
import { inTxn, makePool, retrySerializable } from './lib.mjs';

const both = (f) => ({ A: (ctx) => f(ctx, 'A'), B: (ctx) => f(ctx, 'B') });
const sqlInv = (name, text) => ({ name, sql: text });

// ---------------------------------------------------------------------------------------------------------------
// 1. Lost update: read the balance, write balance + n
// ---------------------------------------------------------------------------------------------------------------
const accountsT = pgTable('accounts', { id: integer('id').primaryKey(), balance: integer('balance').notNull() });

function lostUpdate({ driver, fix }) {
  return {
    name: `lost update (${driver}, ${fix})`,
    tables: ['accounts'],
    schemaSql: 'CREATE TABLE accounts (id int PRIMARY KEY, balance int NOT NULL);',
    seed: "INSERT INTO accounts VALUES (1, 100)",
    setup: async ({ dsn }) => {
      if (driver === 'pg') {
        const pool = await makePool(dsn);
        if (fix === 'rmw') {
          return async () => {
            const r = await pool.query('SELECT balance FROM accounts WHERE id = 1');
            await pool.query('UPDATE accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + 10]);
          };
        }
        if (fix === 'txn') {
          return () =>
            inTxn(pool, async (c) => {
              const r = await c.query('SELECT balance FROM accounts WHERE id = 1');
              await c.query('UPDATE accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + 10]);
            });
        }
        if (fix === 'atomic') return () => pool.query('UPDATE accounts SET balance = balance + $1 WHERE id = 1', [10]);
        if (fix === 'forupdate') {
          return () =>
            inTxn(pool, async (c) => {
              const r = await c.query('SELECT balance FROM accounts WHERE id = 1 FOR UPDATE');
              await c.query('UPDATE accounts SET balance = $1 WHERE id = 1', [r.rows[0].balance + 10]);
            });
        }
      }
      if (driver === 'knex') {
        const knex = await makeKnex(dsn);
        if (fix === 'rmw') {
          return async () => {
            const row = await knex('accounts').where({ id: 1 }).first('balance');
            await knex('accounts').where({ id: 1 }).update({ balance: row.balance + 10 });
          };
        }
        if (fix === 'increment') return () => knex('accounts').where({ id: 1 }).increment('balance', 10);
      }
      if (driver === 'drizzle') {
        const { db } = await makeDrizzle(dsn);
        if (fix === 'rmw') {
          return async () => {
            const [row] = await db.select().from(accountsT).where(eq(accountsT.id, 1));
            await db.update(accountsT).set({ balance: row.balance + 10 }).where(eq(accountsT.id, 1));
          };
        }
        if (fix === 'increment') {
          return () => db.update(accountsT).set({ balance: sql`${accountsT.balance} + ${10}` }).where(eq(accountsT.id, 1));
        }
      }
      throw new Error(`unknown variant ${driver}/${fix}`);
    },
    actors: both((deposit) => deposit()),
    invariants: [sqlInv('both deposits applied', 'SELECT balance = 120 AS ok FROM accounts WHERE id = 1')],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Check-then-insert: "is this e-mail taken?" then INSERT
// ---------------------------------------------------------------------------------------------------------------
const membersT = pgTable('members', { id: serial('id').primaryKey(), email: text('email').notNull() });
const EMAIL = 'a@example.com';

function checkThenInsert({ driver, fix }) {
  const unique = fix === 'onconflict' || fix === 'handled';
  return {
    name: `check-then-insert (${driver}, ${fix})`,
    tables: ['members'],
    schemaSql: `CREATE TABLE members (id serial PRIMARY KEY, email text NOT NULL${unique ? ' UNIQUE' : ''});`,
    setup: async ({ dsn }) => {
      if (driver === 'pg') {
        const pool = await makePool(dsn);
        const exists = async (q) => (await q.query('SELECT count(*)::int AS n FROM members WHERE email = $1', [EMAIL])).rows[0].n > 0;
        if (fix === 'none') {
          return async () => {
            if (!(await exists(pool))) await pool.query('INSERT INTO members (email) VALUES ($1)', [EMAIL]);
          };
        }
        if (fix === 'txn') {
          return () =>
            inTxn(pool, async (c) => {
              if (!(await exists(c))) await c.query('INSERT INTO members (email) VALUES ($1)', [EMAIL]);
            });
        }
        if (fix === 'onconflict') return () => pool.query('INSERT INTO members (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [EMAIL]);
        if (fix === 'handled') {
          return async () => {
            if (await exists(pool)) return 'exists';
            try {
              await pool.query('INSERT INTO members (email) VALUES ($1)', [EMAIL]);
              return 'created';
            } catch (e) {
              if (e.code === '23505') return 'exists';
              throw e;
            }
          };
        }
      }
      if (driver === 'knex') {
        const knex = await makeKnex(dsn);
        if (fix === 'none') {
          return async () => {
            const row = await knex('members').where({ email: EMAIL }).first();
            if (!row) await knex('members').insert({ email: EMAIL });
          };
        }
        if (fix === 'onconflict') return () => knex('members').insert({ email: EMAIL }).onConflict('email').ignore();
      }
      if (driver === 'drizzle') {
        const { db } = await makeDrizzle(dsn);
        if (fix === 'none') {
          return async () => {
            const rows = await db.select().from(membersT).where(eq(membersT.email, EMAIL));
            if (rows.length === 0) await db.insert(membersT).values({ email: EMAIL });
          };
        }
        if (fix === 'onconflict') return () => db.insert(membersT).values({ email: EMAIL }).onConflictDoNothing();
      }
      throw new Error(`unknown variant ${driver}/${fix}`);
    },
    actors: both((join) => join()),
    invariants: [sqlInv('at most one member per email', `SELECT count(*) <= 1 AS ok FROM members WHERE email = '${EMAIL}'`)],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Oversell: stock check, then decrement, then record the order
// ---------------------------------------------------------------------------------------------------------------
const productsT = pgTable('products', { id: integer('id').primaryKey(), stock: integer('stock').notNull() });
const ordersT = pgTable('orders', { id: serial('id').primaryKey(), productId: integer('product_id').notNull() });

function oversell({ driver, fix }) {
  return {
    name: `oversell (${driver}, ${fix})`,
    tables: ['orders', 'products'],
    schemaSql:
      'CREATE TABLE products (id int PRIMARY KEY, stock int NOT NULL);\nCREATE TABLE orders (id serial PRIMARY KEY, product_id int NOT NULL);',
    seed: 'INSERT INTO products VALUES (1, 1)',
    setup: async ({ dsn }) => {
      if (driver === 'pg') {
        const pool = await makePool(dsn);
        if (fix === 'relative' || fix === 'absolute') {
          return async () => {
            const r = await pool.query('SELECT stock FROM products WHERE id = 1');
            const stock = r.rows[0].stock;
            if (stock >= 1) {
              if (fix === 'relative') await pool.query('UPDATE products SET stock = stock - 1 WHERE id = 1');
              else await pool.query('UPDATE products SET stock = $1 WHERE id = 1', [stock - 1]);
              await pool.query('INSERT INTO orders (product_id) VALUES (1)');
            }
          };
        }
        if (fix === 'atomic') {
          return async () => {
            const u = await pool.query('UPDATE products SET stock = stock - 1 WHERE id = 1 AND stock >= 1');
            if (u.rowCount === 1) await pool.query('INSERT INTO orders (product_id) VALUES (1)');
          };
        }
      }
      if (driver === 'knex') {
        const knex = await makeKnex(dsn);
        if (fix === 'relative') {
          return async () => {
            const row = await knex('products').where({ id: 1 }).first('stock');
            if (row.stock >= 1) {
              await knex('products').where({ id: 1 }).decrement('stock', 1);
              await knex('orders').insert({ product_id: 1 });
            }
          };
        }
        if (fix === 'atomic') {
          return async () => {
            const n = await knex('products').where('id', 1).andWhere('stock', '>=', 1).decrement('stock', 1);
            if (n === 1) await knex('orders').insert({ product_id: 1 });
          };
        }
      }
      if (driver === 'drizzle') {
        const { db } = await makeDrizzle(dsn);
        if (fix === 'relative') {
          return async () => {
            const [row] = await db.select().from(productsT).where(eq(productsT.id, 1));
            if (row.stock >= 1) {
              await db.update(productsT).set({ stock: sql`${productsT.stock} - 1` }).where(eq(productsT.id, 1));
              await db.insert(ordersT).values({ productId: 1 });
            }
          };
        }
        if (fix === 'atomic') {
          return async () => {
            const rows = await db
              .update(productsT)
              .set({ stock: sql`${productsT.stock} - 1` })
              .where(and(eq(productsT.id, 1), gte(productsT.stock, 1)))
              .returning({ id: productsT.id });
            if (rows.length === 1) await db.insert(ordersT).values({ productId: 1 });
          };
        }
      }
      throw new Error(`unknown variant ${driver}/${fix}`);
    },
    actors: both((buy) => buy()),
    invariants: [
      sqlInv('stock never negative', 'SELECT stock >= 0 AS ok FROM products WHERE id = 1'),
      sqlInv('orders never exceed initial stock', 'SELECT count(*) <= 1 AS ok FROM orders'),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Coupon double redeem: read the flag, set the flag, record the redemption
// ---------------------------------------------------------------------------------------------------------------
const couponsT = pgTable('coupons', { code: text('code').primaryKey(), used: boolean('used').notNull().default(false) });
const redemptionsT = pgTable('redemptions', { id: serial('id').primaryKey(), code: text('code').notNull() });

function coupon({ driver, fix }) {
  return {
    name: `coupon redeem (${driver}, ${fix})`,
    tables: ['redemptions', 'coupons'],
    schemaSql:
      'CREATE TABLE coupons (code text PRIMARY KEY, used boolean NOT NULL DEFAULT false);\nCREATE TABLE redemptions (id serial PRIMARY KEY, code text NOT NULL);',
    seed: "INSERT INTO coupons (code) VALUES ('SAVE10')",
    setup: async ({ dsn }) => {
      if (driver === 'pg') {
        const pool = await makePool(dsn);
        if (fix === 'none') {
          return async () => {
            const r = await pool.query("SELECT used FROM coupons WHERE code = 'SAVE10'");
            if (!r.rows[0].used) {
              await pool.query("UPDATE coupons SET used = true WHERE code = 'SAVE10'");
              await pool.query("INSERT INTO redemptions (code) VALUES ('SAVE10')");
            }
          };
        }
        if (fix === 'atomic') {
          return async () => {
            const u = await pool.query("UPDATE coupons SET used = true WHERE code = 'SAVE10' AND used = false");
            if (u.rowCount === 1) await pool.query("INSERT INTO redemptions (code) VALUES ('SAVE10')");
          };
        }
      }
      if (driver === 'knex' && fix === 'none') {
        const knex = await makeKnex(dsn);
        return async () => {
          const row = await knex('coupons').where({ code: 'SAVE10' }).first();
          if (!row.used) {
            await knex('coupons').where({ code: 'SAVE10' }).update({ used: true });
            await knex('redemptions').insert({ code: 'SAVE10' });
          }
        };
      }
      if (driver === 'drizzle' && fix === 'none') {
        const { db } = await makeDrizzle(dsn);
        return async () => {
          const [row] = await db.select().from(couponsT).where(eq(couponsT.code, 'SAVE10'));
          if (!row.used) {
            await db.update(couponsT).set({ used: true }).where(eq(couponsT.code, 'SAVE10'));
            await db.insert(redemptionsT).values({ code: 'SAVE10' });
          }
        };
      }
      throw new Error(`unknown variant ${driver}/${fix}`);
    },
    actors: both((redeem) => redeem()),
    invariants: [sqlInv('coupon redeemed at most once', 'SELECT count(*) <= 1 AS ok FROM redemptions')],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Idempotency key: look the key up, process, store the key
// ---------------------------------------------------------------------------------------------------------------
const paymentsT = pgTable('payments', { id: serial('id').primaryKey(), amount: integer('amount').notNull() });
const idemT = pgTable('idem_keys', { key: text('key').primaryKey() });

function idempotency({ driver, fix }) {
  return {
    name: `idempotency key (${driver}, ${fix})`,
    tables: ['payments', 'idem_keys'],
    schemaSql: 'CREATE TABLE idem_keys (key text PRIMARY KEY);\nCREATE TABLE payments (id serial PRIMARY KEY, amount int NOT NULL);',
    setup: async ({ dsn }) => {
      if (driver === 'pg' && fix === 'none') {
        const pool = await makePool(dsn);
        return async () => {
          const seen = await pool.query("SELECT 1 FROM idem_keys WHERE key = 'req-1'");
          if (seen.rowCount === 0) {
            await pool.query('INSERT INTO payments (amount) VALUES (25)');
            await pool.query("INSERT INTO idem_keys (key) VALUES ('req-1')");
          }
        };
      }
      if (driver === 'pg' && fix === 'insertfirst') {
        const pool = await makePool(dsn);
        return () =>
          inTxn(pool, async (c) => {
            const claimed = await c.query("INSERT INTO idem_keys (key) VALUES ('req-1') ON CONFLICT (key) DO NOTHING RETURNING key");
            if (claimed.rowCount === 1) await c.query('INSERT INTO payments (amount) VALUES (25)');
          });
      }
      if (driver === 'drizzle' && fix === 'none') {
        const { db } = await makeDrizzle(dsn);
        return async () => {
          const seen = await db.select().from(idemT).where(eq(idemT.key, 'req-1'));
          if (seen.length === 0) {
            await db.insert(paymentsT).values({ amount: 25 });
            await db.insert(idemT).values({ key: 'req-1' });
          }
        };
      }
      throw new Error(`unknown variant ${driver}/${fix}`);
    },
    actors: both((pay) => pay()),
    invariants: [sqlInv('one payment per idempotency key', 'SELECT count(*) <= 1 AS ok FROM payments')],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Webhook delivered twice: the "processed" marker is written after the side effect
// ---------------------------------------------------------------------------------------------------------------
function webhook({ driver, fix }) {
  return {
    name: `duplicate webhook (${driver}, ${fix})`,
    tables: ['deliveries', 'processed_events'],
    schemaSql:
      'CREATE TABLE processed_events (event_id text PRIMARY KEY);\nCREATE TABLE deliveries (id serial PRIMARY KEY, event_id text NOT NULL, note text);',
    setup: async ({ dsn }) => {
      if (driver === 'pg' && fix === 'none') {
        const pool = await makePool(dsn);
        return async () => {
          const done = await pool.query("SELECT 1 FROM processed_events WHERE event_id = 'evt_42'");
          if (done.rowCount === 0) {
            await pool.query("INSERT INTO deliveries (event_id, note) VALUES ('evt_42', 'receipt e-mail sent')");
            await pool.query("INSERT INTO processed_events (event_id) VALUES ('evt_42')");
          }
        };
      }
      if (driver === 'pg' && fix === 'insertfirst') {
        const pool = await makePool(dsn);
        return () =>
          inTxn(pool, async (c) => {
            const first = await c.query("INSERT INTO processed_events (event_id) VALUES ('evt_42') ON CONFLICT (event_id) DO NOTHING RETURNING event_id");
            if (first.rowCount === 1) await c.query("INSERT INTO deliveries (event_id, note) VALUES ('evt_42', 'receipt e-mail sent')");
          });
      }
      if (driver === 'knex' && fix === 'none') {
        const knex = await makeKnex(dsn);
        return async () => {
          const done = await knex('processed_events').where({ event_id: 'evt_42' }).first();
          if (!done) {
            await knex('deliveries').insert({ event_id: 'evt_42', note: 'receipt e-mail sent' });
            await knex('processed_events').insert({ event_id: 'evt_42' });
          }
        };
      }
      throw new Error(`unknown variant ${driver}/${fix}`);
    },
    actors: both((handle) => handle()),
    invariants: [sqlInv('event handled once', "SELECT count(*) <= 1 AS ok FROM deliveries WHERE event_id = 'evt_42'")],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Write skew
// ---------------------------------------------------------------------------------------------------------------
const doctorsT = pgTable('doctors', { id: integer('id').primaryKey(), onCall: boolean('on_call').notNull() });

function writeSkew({ driver, variant, fix }) {
  if (variant === 'funds') {
    return {
      name: `write skew, two accounts (${driver}, ${fix})`,
      tables: ['acct'],
      schemaSql: 'CREATE TABLE acct (id int PRIMARY KEY, balance int NOT NULL);',
      seed: 'INSERT INTO acct VALUES (1, 100), (2, 100)',
      setup: async ({ dsn }) => {
        const pool = await makePool(dsn);
        return (me) =>
          inTxn(pool, async (c) => {
            const r = await c.query('SELECT sum(balance)::int AS total FROM acct');
            if (r.rows[0].total >= 150) await c.query('UPDATE acct SET balance = balance - 150 WHERE id = $1', [me]);
          });
      },
      actors: { A: (w) => w(1), B: (w) => w(2) },
      invariants: [sqlInv('total balance never negative', 'SELECT sum(balance) >= 0 AS ok FROM acct')],
    };
  }
  return {
    name: `write skew, on-call doctors (${driver}, ${fix})`,
    tables: ['doctors'],
    schemaSql: 'CREATE TABLE doctors (id int PRIMARY KEY, on_call boolean NOT NULL);',
    seed: 'INSERT INTO doctors VALUES (1, true), (2, true)',
    setup: async ({ dsn }) => {
      if (driver === 'drizzle') {
        const { db } = await makeDrizzle(dsn);
        return (me) =>
          db.transaction(async (tx) => {
            const rows = await tx.select().from(doctorsT).where(eq(doctorsT.onCall, true));
            if (rows.length >= 2) await tx.update(doctorsT).set({ onCall: false }).where(eq(doctorsT.id, me));
          });
      }
      const pool = await makePool(dsn);
      if (fix === 'none') {
        return (me) =>
          inTxn(pool, async (c) => {
            const r = await c.query('SELECT id FROM doctors WHERE on_call');
            if (r.rows.length >= 2) await c.query('UPDATE doctors SET on_call = false WHERE id = $1', [me]);
          });
      }
      if (fix === 'forupdate') {
        return (me) =>
          inTxn(pool, async (c) => {
            const r = await c.query('SELECT id FROM doctors WHERE on_call FOR UPDATE');
            if (r.rows.length >= 2) await c.query('UPDATE doctors SET on_call = false WHERE id = $1', [me]);
          });
      }
      if (fix === 'serializable-retry') {
        return (me) =>
          retrySerializable(pool, async (c) => {
            const r = await c.query('SELECT id FROM doctors WHERE on_call');
            if (r.rows.length >= 2) await c.query('UPDATE doctors SET on_call = false WHERE id = $1', [me]);
          });
      }
      throw new Error(`unknown variant ${driver}/${fix}`);
    },
    actors: { A: (w) => w(1), B: (w) => w(2) },
    invariants: [sqlInv('at least one doctor on call', 'SELECT count(*) >= 1 AS ok FROM doctors WHERE on_call')],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Overlapping bookings (phantom): count overlapping bookings, then insert
// ---------------------------------------------------------------------------------------------------------------
function booking({ driver, fix }) {
  return {
    name: `overlapping booking (${driver}, ${fix})`,
    tables: ['bookings'],
    schemaSql: 'CREATE TABLE bookings (id serial PRIMARY KEY, room int NOT NULL, start_h int NOT NULL, end_h int NOT NULL);',
    setup: async ({ dsn }) => {
      if (driver === 'pg' && fix === 'none') {
        const pool = await makePool(dsn);
        return async (s, e) => {
          const r = await pool.query('SELECT count(*)::int AS n FROM bookings WHERE room = 1 AND start_h < $2 AND end_h > $1', [s, e]);
          if (r.rows[0].n === 0) await pool.query('INSERT INTO bookings (room, start_h, end_h) VALUES (1, $1, $2)', [s, e]);
        };
      }
      if (driver === 'pg' && fix === 'advisory') {
        const pool = await makePool(dsn);
        return (s, e) =>
          inTxn(pool, async (c) => {
            await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['room-1']);
            const r = await c.query('SELECT count(*)::int AS n FROM bookings WHERE room = 1 AND start_h < $2 AND end_h > $1', [s, e]);
            if (r.rows[0].n === 0) await c.query('INSERT INTO bookings (room, start_h, end_h) VALUES (1, $1, $2)', [s, e]);
          });
      }
      if (driver === 'knex' && fix === 'none') {
        const knex = await makeKnex(dsn);
        return async (s, e) => {
          const [{ n }] = await knex('bookings').where('room', 1).andWhere('start_h', '<', e).andWhere('end_h', '>', s).count({ n: '*' });
          if (Number(n) === 0) await knex('bookings').insert({ room: 1, start_h: s, end_h: e });
        };
      }
      throw new Error(`unknown variant ${driver}/${fix}`);
    },
    actors: { A: (book) => book(9, 11), B: (book) => book(10, 12) },
    invariants: [
      sqlInv(
        'no two bookings overlap',
        'SELECT NOT EXISTS (SELECT 1 FROM bookings a JOIN bookings b ON a.room = b.room AND a.id < b.id AND a.start_h < b.end_h AND a.end_h > b.start_h) AS ok',
      ),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Transfer deadlock: opposite lock order
// ---------------------------------------------------------------------------------------------------------------
function deadlock({ driver, fix }) {
  const noDeadlock = { name: 'no actor aborted by a deadlock', js: ({ results }) => ({ ok: !results.some((r) => r.error?.code === '40P01') }) };
  return {
    name: `transfer between two accounts (${driver}, ${fix})`,
    tables: ['accounts'],
    schemaSql: 'CREATE TABLE accounts (id int PRIMARY KEY, balance int NOT NULL);',
    seed: 'INSERT INTO accounts VALUES (1, 100), (2, 100)',
    setup: async ({ dsn }) => {
      if (driver === 'knex') {
        const knex = await makeKnex(dsn);
        return (from, to) =>
          knex.transaction(async (trx) => {
            await trx('accounts').where({ id: from }).decrement('balance', 1);
            await trx('accounts').where({ id: to }).increment('balance', 1);
          });
      }
      const pool = await makePool(dsn);
      return (from, to) =>
        inTxn(pool, async (c) => {
          const [first, second] = fix === 'lockorder' ? [Math.min(from, to), Math.max(from, to)] : [from, to];
          await c.query('UPDATE accounts SET balance = balance + $2 WHERE id = $1', [first, first === from ? -1 : 1]);
          await c.query('UPDATE accounts SET balance = balance + $2 WHERE id = $1', [second, second === from ? -1 : 1]);
        });
    },
    actors: { A: (transfer) => transfer(1, 2), B: (transfer) => transfer(2, 1) },
    invariants: [noDeadlock, sqlInv('money conserved', 'SELECT sum(balance) = 200 AS ok FROM accounts')],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 10. Job queue: two workers claim the next pending job
// ---------------------------------------------------------------------------------------------------------------
function queue({ fix }) {
  return {
    name: `queue claim (pg, ${fix})`,
    tables: ['claims', 'jobs'],
    schemaSql:
      'CREATE TABLE jobs (id int PRIMARY KEY, status text NOT NULL);\nCREATE TABLE claims (id serial PRIMARY KEY, job_id int NOT NULL, worker text NOT NULL);',
    seed: "INSERT INTO jobs VALUES (1, 'pending')",
    setup: async ({ dsn }) => {
      const pool = await makePool(dsn);
      if (fix === 'none') {
        return async (worker) => {
          const r = await pool.query("SELECT id FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1");
          if (r.rowCount === 1) {
            await pool.query("UPDATE jobs SET status = 'running' WHERE id = $1", [r.rows[0].id]);
            await pool.query('INSERT INTO claims (job_id, worker) VALUES ($1, $2)', [r.rows[0].id, worker]);
          }
        };
      }
      return (worker) =>
        inTxn(pool, async (c) => {
          const r = await c.query("SELECT id FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
          if (r.rowCount === 1) {
            await c.query("UPDATE jobs SET status = 'running' WHERE id = $1", [r.rows[0].id]);
            await c.query('INSERT INTO claims (job_id, worker) VALUES ($1, $2)', [r.rows[0].id, worker]);
          }
        });
    },
    actors: { A: (claim) => claim('worker-a'), B: (claim) => claim('worker-b') },
    invariants: [sqlInv('a job is claimed by at most one worker', 'SELECT count(*) <= 1 AS ok FROM claims')],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Controls that must NOT trip the tool
// ---------------------------------------------------------------------------------------------------------------
function benign({ driver }) {
  return {
    name: `benign nondeterminism: uuid and timestamp (${driver})`,
    tables: ['events', 'counters'],
    schemaSql:
      'CREATE TABLE counters (id int PRIMARY KEY, n int NOT NULL);\nCREATE TABLE events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());',
    seed: 'INSERT INTO counters VALUES (1, 0)',
    setup: async ({ dsn }) => {
      if (driver === 'knex') {
        const knex = await makeKnex(dsn);
        return async (who) => {
          await knex('counters').where({ id: 1 }).increment('n', 1);
          await knex('events').insert({ actor: who, created_at: knex.fn.now() });
        };
      }
      const pool = await makePool(dsn);
      return async (who) => {
        await pool.query('UPDATE counters SET n = n + 1 WHERE id = 1');
        await pool.query('INSERT INTO events (actor, created_at) VALUES ($1, now())', [who]);
      };
    },
    actors: { A: (record) => record('A'), B: (record) => record('B') },
    invariants: [sqlInv('both increments counted', 'SELECT n = 2 AS ok FROM counters WHERE id = 1')],
    options: { ignoreColumns: ['id', 'created_at'] },
  };
}

function counterRetry() {
  return {
    name: 'counter under SERIALIZABLE with a retry wrapper (pg)',
    tables: ['counters'],
    schemaSql: 'CREATE TABLE counters (id int PRIMARY KEY, n int NOT NULL);',
    seed: 'INSERT INTO counters VALUES (1, 0)',
    setup: async ({ dsn }) => {
      const pool = await makePool(dsn);
      return () =>
        retrySerializable(pool, async (c) => {
          const r = await c.query('SELECT n FROM counters WHERE id = 1');
          await c.query('UPDATE counters SET n = $1 WHERE id = 1', [r.rows[0].n + 1]);
        });
    },
    actors: both((bump) => bump()),
    invariants: [sqlInv('both increments counted', 'SELECT n = 2 AS ok FROM counters WHERE id = 1')],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Registry: the id is the directory name under corpus/dev
// ---------------------------------------------------------------------------------------------------------------
export const VARIANTS = {
  // lost update
  'lost-update-pg-rmw': { make: () => lostUpdate({ driver: 'pg', fix: 'rmw' }), expect: 'buggy', klass: 'lost-update', driver: 'pg', invariant: 'both deposits applied' },
  'lost-update-pg-txn': { make: () => lostUpdate({ driver: 'pg', fix: 'txn' }), expect: 'buggy', klass: 'lost-update', driver: 'pg', invariant: 'both deposits applied' },
  'lost-update-knex-rmw': { make: () => lostUpdate({ driver: 'knex', fix: 'rmw' }), expect: 'buggy', klass: 'lost-update', driver: 'knex', invariant: 'both deposits applied' },
  'lost-update-drizzle-rmw': { make: () => lostUpdate({ driver: 'drizzle', fix: 'rmw' }), expect: 'buggy', klass: 'lost-update', driver: 'drizzle', invariant: 'both deposits applied' },
  'lost-update-pg-atomic': { make: () => lostUpdate({ driver: 'pg', fix: 'atomic' }), expect: 'safe', klass: 'lost-update', driver: 'pg', fixPattern: 'atomic-update' },
  'lost-update-pg-forupdate': { make: () => lostUpdate({ driver: 'pg', fix: 'forupdate' }), expect: 'safe', klass: 'lost-update', driver: 'pg', fixPattern: 'for-update' },
  'lost-update-knex-increment': { make: () => lostUpdate({ driver: 'knex', fix: 'increment' }), expect: 'safe', klass: 'lost-update', driver: 'knex', fixPattern: 'atomic-update' },
  'lost-update-drizzle-increment': { make: () => lostUpdate({ driver: 'drizzle', fix: 'increment' }), expect: 'safe', klass: 'lost-update', driver: 'drizzle', fixPattern: 'atomic-update' },
  // check-then-insert
  'cti-pg-none': { make: () => checkThenInsert({ driver: 'pg', fix: 'none' }), expect: 'buggy', klass: 'check-then-insert', driver: 'pg', invariant: 'at most one member per email' },
  'cti-pg-txn': { make: () => checkThenInsert({ driver: 'pg', fix: 'txn' }), expect: 'buggy', klass: 'check-then-insert', driver: 'pg', invariant: 'at most one member per email' },
  'cti-knex-none': { make: () => checkThenInsert({ driver: 'knex', fix: 'none' }), expect: 'buggy', klass: 'check-then-insert', driver: 'knex', invariant: 'at most one member per email' },
  'cti-drizzle-none': { make: () => checkThenInsert({ driver: 'drizzle', fix: 'none' }), expect: 'buggy', klass: 'check-then-insert', driver: 'drizzle', invariant: 'at most one member per email' },
  'cti-pg-onconflict': { make: () => checkThenInsert({ driver: 'pg', fix: 'onconflict' }), expect: 'safe', klass: 'check-then-insert', driver: 'pg', fixPattern: 'unique-on-conflict' },
  'cti-pg-unique-handled': { make: () => checkThenInsert({ driver: 'pg', fix: 'handled' }), expect: 'safe', klass: 'check-then-insert', driver: 'pg', fixPattern: 'unique-with-error-handling' },
  'cti-knex-onconflict': { make: () => checkThenInsert({ driver: 'knex', fix: 'onconflict' }), expect: 'safe', klass: 'check-then-insert', driver: 'knex', fixPattern: 'unique-on-conflict' },
  'cti-drizzle-onconflict': { make: () => checkThenInsert({ driver: 'drizzle', fix: 'onconflict' }), expect: 'safe', klass: 'check-then-insert', driver: 'drizzle', fixPattern: 'unique-on-conflict' },
  // oversell
  'oversell-pg-relative': { make: () => oversell({ driver: 'pg', fix: 'relative' }), expect: 'buggy', klass: 'oversell', driver: 'pg', invariant: 'stock never negative' },
  'oversell-pg-absolute': { make: () => oversell({ driver: 'pg', fix: 'absolute' }), expect: 'buggy', klass: 'oversell', driver: 'pg', invariant: 'orders never exceed initial stock' },
  'oversell-knex-relative': { make: () => oversell({ driver: 'knex', fix: 'relative' }), expect: 'buggy', klass: 'oversell', driver: 'knex', invariant: 'stock never negative' },
  'oversell-drizzle-relative': { make: () => oversell({ driver: 'drizzle', fix: 'relative' }), expect: 'buggy', klass: 'oversell', driver: 'drizzle', invariant: 'stock never negative' },
  'oversell-pg-atomic': { make: () => oversell({ driver: 'pg', fix: 'atomic' }), expect: 'safe', klass: 'oversell', driver: 'pg', fixPattern: 'atomic-update' },
  'oversell-knex-atomic': { make: () => oversell({ driver: 'knex', fix: 'atomic' }), expect: 'safe', klass: 'oversell', driver: 'knex', fixPattern: 'atomic-update' },
  'oversell-drizzle-atomic': { make: () => oversell({ driver: 'drizzle', fix: 'atomic' }), expect: 'safe', klass: 'oversell', driver: 'drizzle', fixPattern: 'atomic-update' },
  // coupon
  'coupon-pg-none': { make: () => coupon({ driver: 'pg', fix: 'none' }), expect: 'buggy', klass: 'coupon', driver: 'pg', invariant: 'coupon redeemed at most once' },
  'coupon-knex-none': { make: () => coupon({ driver: 'knex', fix: 'none' }), expect: 'buggy', klass: 'coupon', driver: 'knex', invariant: 'coupon redeemed at most once' },
  'coupon-drizzle-none': { make: () => coupon({ driver: 'drizzle', fix: 'none' }), expect: 'buggy', klass: 'coupon', driver: 'drizzle', invariant: 'coupon redeemed at most once' },
  'coupon-pg-atomic': { make: () => coupon({ driver: 'pg', fix: 'atomic' }), expect: 'safe', klass: 'coupon', driver: 'pg', fixPattern: 'atomic-update' },
  // idempotency key
  'idem-pg-none': { make: () => idempotency({ driver: 'pg', fix: 'none' }), expect: 'buggy', klass: 'idempotency-key', driver: 'pg', invariant: 'one payment per idempotency key' },
  'idem-drizzle-none': { make: () => idempotency({ driver: 'drizzle', fix: 'none' }), expect: 'buggy', klass: 'idempotency-key', driver: 'drizzle', invariant: 'one payment per idempotency key' },
  'idem-pg-insertfirst': { make: () => idempotency({ driver: 'pg', fix: 'insertfirst' }), expect: 'safe', klass: 'idempotency-key', driver: 'pg', fixPattern: 'unique-on-conflict' },
  // webhook
  'webhook-pg-none': { make: () => webhook({ driver: 'pg', fix: 'none' }), expect: 'buggy', klass: 'webhook-duplicate', driver: 'pg', invariant: 'event handled once' },
  'webhook-knex-none': { make: () => webhook({ driver: 'knex', fix: 'none' }), expect: 'buggy', klass: 'webhook-duplicate', driver: 'knex', invariant: 'event handled once' },
  'webhook-pg-insertfirst': { make: () => webhook({ driver: 'pg', fix: 'insertfirst' }), expect: 'safe', klass: 'webhook-duplicate', driver: 'pg', fixPattern: 'unique-on-conflict' },
  // write skew
  'writeskew-pg-doctors': { make: () => writeSkew({ driver: 'pg', variant: 'doctors', fix: 'none' }), expect: 'buggy', klass: 'write-skew', driver: 'pg', invariant: 'at least one doctor on call' },
  'writeskew-pg-funds': { make: () => writeSkew({ driver: 'pg', variant: 'funds', fix: 'none' }), expect: 'buggy', klass: 'write-skew', driver: 'pg', invariant: 'total balance never negative' },
  'writeskew-drizzle-doctors': { make: () => writeSkew({ driver: 'drizzle', variant: 'doctors', fix: 'none' }), expect: 'buggy', klass: 'write-skew', driver: 'drizzle', invariant: 'at least one doctor on call' },
  'writeskew-pg-forupdate': { make: () => writeSkew({ driver: 'pg', variant: 'doctors', fix: 'forupdate' }), expect: 'safe', klass: 'write-skew', driver: 'pg', fixPattern: 'for-update' },
  'writeskew-pg-serializable-retry': { make: () => writeSkew({ driver: 'pg', variant: 'doctors', fix: 'serializable-retry' }), expect: 'safe', klass: 'write-skew', driver: 'pg', fixPattern: 'serializable-retry' },
  // booking
  'booking-pg-none': { make: () => booking({ driver: 'pg', fix: 'none' }), expect: 'buggy', klass: 'phantom-booking', driver: 'pg', invariant: 'no two bookings overlap' },
  'booking-knex-none': { make: () => booking({ driver: 'knex', fix: 'none' }), expect: 'buggy', klass: 'phantom-booking', driver: 'knex', invariant: 'no two bookings overlap' },
  'booking-pg-advisory': { make: () => booking({ driver: 'pg', fix: 'advisory' }), expect: 'safe', klass: 'phantom-booking', driver: 'pg', fixPattern: 'advisory-lock' },
  // deadlock
  'deadlock-pg-none': { make: () => deadlock({ driver: 'pg', fix: 'none' }), expect: 'buggy', klass: 'deadlock', driver: 'pg', invariant: 'no actor aborted by a deadlock' },
  'deadlock-knex-none': { make: () => deadlock({ driver: 'knex', fix: 'none' }), expect: 'buggy', klass: 'deadlock', driver: 'knex', invariant: 'no actor aborted by a deadlock' },
  'deadlock-pg-lockorder': { make: () => deadlock({ driver: 'pg', fix: 'lockorder' }), expect: 'safe', klass: 'deadlock', driver: 'pg', fixPattern: 'lock-ordering' },
  // queue
  'queue-pg-none': { make: () => queue({ fix: 'none' }), expect: 'buggy', klass: 'queue-claim', driver: 'pg', invariant: 'a job is claimed by at most one worker' },
  'queue-pg-skiplocked': { make: () => queue({ fix: 'skiplocked' }), expect: 'safe', klass: 'queue-claim', driver: 'pg', fixPattern: 'skip-locked' },
  // controls
  'benign-pg': { make: () => benign({ driver: 'pg' }), expect: 'safe', klass: 'benign-control', driver: 'pg', fixPattern: 'none-needed' },
  'benign-knex': { make: () => benign({ driver: 'knex' }), expect: 'safe', klass: 'benign-control', driver: 'knex', fixPattern: 'none-needed' },
  'counter-pg-serializable-retry': { make: () => counterRetry(), expect: 'safe', klass: 'retry-wrapper-control', driver: 'pg', fixPattern: 'serializable-retry' },
};

/** The scenario object (what `export default` of a scenario file must be). */
export function build(id) {
  const v = VARIANTS[id];
  if (!v) throw new Error(`unknown corpus variant ${id}`);
  const { schemaSql, seed, ...scenario } = v.make();
  return { ...scenario, ...(seed ? { seed: async (db) => { await db.query(seed); } } : {}), schema: 'schema.sql' };
}

/** schema.sql text for the variant (idempotent: drops its tables first). */
export function schemaFor(id) {
  const { schemaSql, tables } = VARIANTS[id].make();
  return `${tables.map((t) => `DROP TABLE IF EXISTS ${t} CASCADE;`).join('\n')}\n${schemaSql}\n`;
}
